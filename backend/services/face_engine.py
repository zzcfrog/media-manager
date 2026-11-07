"""Offline SCRFD + ArcFace inference using independently selected external ONNX files.

Only numpy/Pillow and the existing ONNX runtime are needed. Model spaces include
the exact weights and preprocessing revision. Results are observations, not names.
"""
import hashlib
import base64
import io
import json
import math
from pathlib import Path
import subprocess
import threading

import numpy as np
from PIL import Image, ImageOps

from ..config import THUMB_DIR, RAW_EXTS, HEIF_EXTS

PROFILES = {
    'buffalo_l': ('det_10g.onnx', 'w600k_r50.onnx'),
    'buffalo_m': ('det_2.5g.onnx', 'w600k_r50.onnx'),
    'buffalo_s': ('det_500m.onnx', 'w600k_mbf.onnx'),
    'buffalo_sc': ('det_500m.onnx', 'w600k_mbf.onnx'),
    'raccoon_s': ('det_10g_wo.onnx', 'w600k_mbf.onnx'),
    'raccoon_l': ('det_10g_wo.onnx', 'w600k_r50.onnx'),
}
_DEST = np.array([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],
                  [41.5493,92.3655],[70.7299,92.2041]], dtype=np.float64)
_cache = {}
_lock = threading.Lock()


def normalized(vector):
    value=np.asarray(vector,dtype=np.float32).reshape(-1)
    norm=float(np.linalg.norm(value))
    if not value.size or not np.isfinite(value).all() or norm<1e-12:
        raise ValueError('无效的人脸特征')
    return value/norm


def alignment_matrix(points):
    points=np.asarray(points,dtype=np.float64)
    if points.shape!=(5,2) or not np.isfinite(points).all():raise ValueError('人脸关键点无效')
    source=points-points.mean(0);target=_DEST-_DEST.mean(0)
    variance=float(np.mean(np.sum(source*source,axis=1)))
    if variance<1e-8:raise ValueError('人脸关键点退化')
    u,s,v=np.linalg.svd(target.T@source/5)
    correction=np.ones(2)
    if np.linalg.det(u@v)<0:correction[-1]=-1
    rotation=u@np.diag(correction)@v
    scale=float((s*correction).sum()/variance)
    if scale<=0:raise ValueError('人脸对齐失败')
    return np.column_stack([scale*rotation,_DEST.mean(0)-scale*rotation@points.mean(0)])


def nms(boxes,scores,threshold=.4):
    boxes=np.asarray(boxes);order=np.argsort(-np.asarray(scores),kind='stable');keep=[]
    areas=np.maximum(0,boxes[:,2]-boxes[:,0])*np.maximum(0,boxes[:,3]-boxes[:,1])
    while len(order):
        i=int(order[0]);keep.append(i);rest=order[1:]
        overlap=np.maximum(0,np.minimum(boxes[i,2:],boxes[rest,2:])-np.maximum(boxes[i,:2],boxes[rest,:2]))
        intersection=overlap[:,0]*overlap[:,1]
        iou=intersection/np.maximum(1e-12,areas[i]+areas[rest]-intersection)
        order=rest[iou<=threshold]
    return keep


def model_paths(directory,profile='buffalo_l',detector_path='',recognizer_path='',verifier_path='',verify_enabled=False):
    if profile=='custom':
        if not detector_path or not recognizer_path:raise FileNotFoundError('请选择检测与特征识别模型文件')
        paths=[Path(detector_path).expanduser().resolve(),Path(recognizer_path).expanduser().resolve()]
    else:
        if profile not in PROFILES:raise ValueError('不支持的人脸模型组合')
        if not str(directory).strip() and not (detector_path and recognizer_path):
            raise FileNotFoundError('请分别选择人脸检测与身份特征模型')
        root=Path(directory).expanduser().resolve() if str(directory).strip() else None
        paths=[Path(path).expanduser().resolve() if path else root/name
               for path,name in zip((detector_path,recognizer_path),PROFILES[profile])]
    if verify_enabled:
        if verifier_path:paths.append(Path(verifier_path).expanduser().resolve())
        elif profile.startswith('raccoon_') and root:paths.append(root/'face_verifier_mnv2.onnx')
        else:raise FileNotFoundError('已开启人脸复核，请选择复核模型文件')
    return paths


def validate_session(model,stage,trial=False):
    """Validate the supported adapter contract, never infer training identity from a filename."""
    inputs=model.get_inputs();outputs=model.get_outputs()
    if len(inputs)!=1:raise ValueError('模型需为单输入的 RGB NCHW 格式')
    meta=inputs[0];shape=meta.shape
    if len(shape)!=4 or shape[1]!=3 or (isinstance(shape[0],int) and shape[0]!=1):
        raise ValueError('模型需为单张 RGB NCHW 输入')
    if stage=='detector':
        size=640;expected=9
    elif stage=='recognizer':size=112;expected=1
    elif stage=='verifier':
        size=shape[2];expected=1
        if not isinstance(size,int) or size<=0 or size>1024 or shape[3]!=size:
            raise ValueError('人脸复核模型需为固定方形输入')
    else:raise ValueError('模型阶段无效')
    if len(outputs)!=expected or any(isinstance(n,int) and n!=size for n in shape[2:]):
        raise ValueError({'detector':'需兼容 SCRFD 640×640 九路输出与五点关键点',
                          'recognizer':'需兼容 ArcFace 112×112、512维身份特征',
                          'verifier':'需兼容 FaceVerifier 单人脸概率输出'}[stage])
    if stage=='recognizer' and shape[2:]!=[112,112]:raise ValueError('身份特征输入尺寸需为112×112')
    types=('tensor(uint8)','tensor(float)') if stage=='verifier' else ('tensor(float)',)
    if meta.type not in types:raise ValueError('模型输入数据类型不兼容')
    if trial:
        pixels=np.zeros((1,3,size,size),dtype=np.uint8 if meta.type=='tensor(uint8)' else np.float32)
        result=model.run(None,{meta.name:pixels})
        if not all(np.isfinite(value).all() for value in result):raise ValueError('模型输出含无效数值')
        if stage=='detector':
            for i,stride in enumerate((8,16,32)):
                count=(640//stride)**2*2
                for offset,width in ((0,1),(3,4),(6,10)):
                    if np.asarray(result[i+offset]).shape not in ((count,width),(1,count,width)):
                        raise ValueError('SCRFD 输出布局与五点关键点不兼容')
        elif stage=='recognizer':
            vector=normalized(result[0])
            if len(vector)!=512:raise ValueError('身份特征需为512维')
        else:
            value=np.asarray(result[0]).reshape(-1)
            if len(value)!=1 or not 0<=value[0]<=1:raise ValueError('复核模型需输出单个人脸概率')
    return {'input_shape':list(shape),'input_type':meta.type,'outputs':len(outputs)}


def probe_model(path,stage):
    """CPU-only synthetic input probe. Compatibility does not attest accuracy or provenance."""
    import onnxruntime as ort
    if stage not in ('detector','recognizer','verifier'):raise ValueError('模型阶段无效')
    if not isinstance(path,str) or not path or not Path(path).expanduser().is_absolute():
        raise ValueError('请选择 ONNX 模型的绝对路径')
    file=Path(path).expanduser().resolve()
    if file.suffix.lower()!='.onnx' or not file.is_file() or not 0<file.stat().st_size<=2<<30:
        raise ValueError('请选择有效的 ONNX 模型文件（最大2GB）')
    signature=(stage,str(file),file.stat().st_size,file.stat().st_mtime_ns)
    with _lock:
        cached=_cache.get(('probe',signature))
        if cached:return dict(cached)
    try:
        options=ort.SessionOptions();options.intra_op_num_threads=2;options.log_severity_level=3
        model=ort.InferenceSession(str(file),sess_options=options,providers=['CPUExecutionProvider'])
        result=validate_session(model,stage,trial=True)
    except Exception as exc:
        raise ValueError('模型接口核验失败：'+str(exc)[:500]) from exc
    digest=hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda:source.read(8<<20),b''):digest.update(block)
    if signature!=(stage,str(file),file.stat().st_size,file.stat().st_mtime_ns):raise ValueError('模型文件发生变化，请重新核验')
    result.update(compatible=True,stage=stage,fingerprint=digest.hexdigest(),path=str(file))
    with _lock:
        # Probe caching is bounded independently from the currently active engine.
        if sum(k[0]=='probe' for k in _cache if isinstance(k,tuple))>=64:
            for key in list(_cache):
                if isinstance(key,tuple) and key[0]=='probe':del _cache[key]
        _cache[('probe',signature)]=dict(result)
    return result


def model_info(directory,profile='buffalo_l',**options):
    paths=model_paths(directory,profile,**options)
    if not all(p.is_file() and p.stat().st_size for p in paths):
        raise FileNotFoundError('缺少已选择的人脸模型文件：'+', '.join(p.name for p in paths if not p.is_file() or not p.stat().st_size))
    signature=tuple((str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in paths)
    with _lock:
        prior=_cache.get(('info',profile,tuple(map(str,paths))))
        if prior and prior['signature']==signature:return prior
    digest=hashlib.sha256(('scrfd-arcface-rgb-pillow-v1:'+profile).encode())
    for path in paths:
        with path.open('rb') as source:
            for block in iter(lambda:source.read(8<<20),b''):digest.update(block)
    info={'key':digest.hexdigest(),'profile':profile,'paths':paths,'signature':signature,
          'bytes':sum(p.stat().st_size for p in paths)}
    if signature!=tuple((str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in paths):
        raise FileNotFoundError('模型加载期间发生变化，请重试')
    with _lock:_cache[('info',profile,tuple(map(str,paths)))]=info
    return info


class FaceEngine:
    def __init__(self,info):
        import onnxruntime as ort
        ort.disable_telemetry_events()
        options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
        options.log_severity_level=3
        providers=['CPUExecutionProvider']
        if 'CoreMLExecutionProvider' in ort.get_available_providers():
            providers.insert(0,('CoreMLExecutionProvider',{'MLComputeUnits':'ALL','RequireStaticInputShapes':'1'}))
        def session(path):
            try:return ort.InferenceSession(str(path),sess_options=options,providers=providers)
            except Exception:
                if len(providers)==1:raise
                # CoreML may be installed but unable to compile on this device.
                # Corrupt/incompatible ONNX still fails on the CPU retry.
                return ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
        self.detector=session(info['paths'][0])
        self.recognizer=session(info['paths'][1])
        self.verifier=session(info['paths'][2]) if len(info['paths'])>2 else None
        validate_session(self.detector,'detector')
        validate_session(self.recognizer,'recognizer')
        if self.verifier:validate_session(self.verifier,'verifier')
        self.info=info

    def verify(self,image,box):
        """Raccoon FaceVerifier scores face/non-face crops, not identity or liveness."""
        model=getattr(self,'verifier',None)
        if model is None:return True
        return self.verify_crop(self.verification_crop(image,box))

    def verification_crop(self,image,box):
        model=self.verifier
        meta=model.get_inputs()[0];size=meta.shape[-1]
        x,y,x2,y2=map(float,box);side=max(2.,x2-x,y2-y)*1.3
        cx,cy=(x+x2)/2,(y+y2)/2
        return image.convert('RGB').transform((size,size),Image.Transform.AFFINE,
             (side/size,0,cx-side/2,0,side/size,cy-side/2),resample=Image.Resampling.BILINEAR)

    def verify_crop(self,crop):
        model=self.verifier;meta=model.get_inputs()[0]
        pixels=np.asarray(crop,dtype=np.uint8).transpose(2,0,1)[None]
        if meta.type=='tensor(float)':pixels=pixels.astype(np.float32)
        score=np.asarray(model.run(None,{meta.name:pixels})[0]).reshape(-1)
        if len(score)!=1 or not np.isfinite(score).all() or not 0<=score[0]<=1:raise ValueError('人脸复核模型输出应为单个人脸概率')
        return bool(score[0]>=.5)

    def detect(self,image):
        image=image.convert('RGB');width,height=image.size
        scale=640/max(width,height);size=(max(1,int(width*scale)),max(1,int(height*scale)))
        canvas=Image.new('RGB',(640,640));canvas.paste(image.resize(size,Image.Resampling.BILINEAR),(0,0))
        pixels=(np.asarray(canvas,dtype=np.float32)-127.5)/128.
        outputs=self.detector.run(None,{self.detector.get_inputs()[0].name:pixels.transpose(2,0,1)[None]})
        boxes=[];points=[];scores=[]
        for level,stride in enumerate((8,16,32)):
            side=640//stride
            centers=np.stack(np.meshgrid(np.arange(side),np.arange(side)),axis=-1).reshape(-1,2)*stride
            centers=np.repeat(centers,2,axis=0)
            confidence=np.asarray(outputs[level]).reshape(-1)
            distances=np.asarray(outputs[level+3]).reshape(-1,4)*stride
            offsets=np.asarray(outputs[level+6]).reshape(-1,5,2)*stride
            if len(confidence)!=len(centers):raise ValueError('人脸检测器输出布局不兼容')
            selected=np.flatnonzero(confidence>=.5)
            if not len(selected):continue
            c=centers[selected];d=distances[selected]
            boxes.extend(np.column_stack([c-d[:,:2],c+d[:,2:]])/scale)
            points.extend((offsets[selected]+c[:,None,:])/scale)
            scores.extend(confidence[selected])
        if not boxes:return []
        boxes=np.asarray(boxes);boxes[:,[0,2]]=boxes[:,[0,2]].clip(0,width);boxes[:,[1,3]]=boxes[:,[1,3]].clip(0,height)
        return [{'box':boxes[i],'points':points[i],'score':float(scores[i])} for i in nms(boxes,np.asarray(scores))[:100]
                if boxes[i,2]>boxes[i,0] and boxes[i,3]>boxes[i,1]]

    def prepare_face(self,image,face,frame_time=None,include_verifier=False,include_portrait=False):
        """Align and score without invoking either identity or verification networks."""
        width,height=image.size;x,y,x2,y2=face['box'];w=x2-x;h=y2-y
        matrix=np.vstack([alignment_matrix(face['points']),[0,0,1]])
        inverse=np.linalg.inv(matrix)
        crop=image.convert('RGB').transform((112,112),Image.Transform.AFFINE,
                   tuple(inverse[:2].reshape(-1)),resample=Image.Resampling.BILINEAR)
        gray=np.asarray(crop.convert('L'),dtype=np.float32)
        sharpness=float(np.var(np.diff(gray,axis=0))+np.var(np.diff(gray,axis=1)))
        quality=min(1.,min(w,h)/64)*min(1.,sharpness/50)*face['score']
        prepared={'frame_time':frame_time,'bbox':[float(x/width),float(y/height),float(w/width),float(h/height)],
                  'score':face['score'],'quality':float(quality),'crop':crop,'_eligible':min(w,h)>=24 and sharpness>=8}
        if include_portrait:
            side=min(384,max(112,round(min(w,h))))
            portrait_transform=inverse[:2].copy();portrait_transform[:,:2]*=112/side
            prepared['portrait']=image.convert('RGB').transform((side,side),Image.Transform.AFFINE,
                 tuple(portrait_transform.reshape(-1)),resample=Image.Resampling.BICUBIC)
        if include_verifier and getattr(self,'verifier',None) is not None:
            prepared['_verification_crop']=self.verification_crop(image,face['box'])
        return prepared

    def embed_face(self,prepared,feature_cache=None,verified=False):
        if not verified and getattr(self,'verifier',None) is not None:
            if not self.verify_crop(prepared['_verification_crop']):return None
        result={key:value for key,value in prepared.items() if not key.startswith('_')};vector=None
        if prepared['_eligible']:
            crop=prepared['crop'];key=hashlib.sha256(crop.tobytes()).hexdigest()
            vector=feature_cache.get(key) if feature_cache is not None else None
            if vector is None:
                pixels=(np.asarray(crop,dtype=np.float32)-127.5)/127.5
                vector=normalized(self.recognizer.run(None,{self.recognizer.get_inputs()[0].name:pixels.transpose(2,0,1)[None]})[0])
                if feature_cache is not None:
                    if len(feature_cache)>=256:feature_cache.pop(next(iter(feature_cache)))
                    feature_cache[key]=vector
            if len(vector)!=512:raise ValueError('人脸特征维度不兼容')
        result['feature']=vector
        return result

    def observe(self,image,frame_time=None,cancelled=lambda:False,feature_cache=None):
        results=[]
        for face in self.detect(image):
            if cancelled():raise InterruptedError('人物整理已暂停')
            if not self.verify(image,face['box']):continue
            results.append(self.embed_face(self.prepare_face(image,face,frame_time,include_portrait=True),feature_cache,verified=True))
        return results


def load_engine(directory,profile='buffalo_l',**options):
    info=model_info(directory,profile,**options)
    with _lock:
        current=_cache.get('engine')
        if current and current.info['key']==info['key']:return current
        current=FaceEngine(info);_cache['engine']=current
        return current


def sample_times(duration,max_frames=24):
    duration=float(duration)
    if not math.isfinite(duration) or duration<=0:raise ValueError('视频时长无效，等待重新读取元信息')
    if duration<1:return [0.]
    count=min(max(1,int(max_frames)),max(3,math.ceil(duration/2)))
    # Keep a finite decode budget even for hours-long clips. These are observations,
    # never fabricated continuous appearance intervals.
    return sorted(set(round(float(t),3) for t in np.linspace(0,max(0,duration-min(1,duration/3)),count)))


def adaptive_times(times,frames,budget):
    """Retain scouts and spend remaining observations around visible changes."""
    if len(times)<2 or len(times)>=budget:return list(times)
    previews=[np.asarray(image.convert('RGB').resize((48,32)),dtype=np.float32) for image in frames]
    weights=np.array([1+5*float(np.mean(np.abs(a-b)))/255 for a,b in zip(previews,previews[1:])])
    allocations=np.zeros(len(weights),dtype=int)
    for _ in range(budget-len(times)):
        interval=int(np.argmax(weights/(allocations+1)))
        allocations[interval]+=1
    result=list(times)
    for i,count in enumerate(allocations):
        result.extend(round(times[i]+(times[i+1]-times[i])*j/(count+1),6) for j in range(1,count+1))
    return sorted(set(result))


def _read_image(path):
    path=Path(path)
    if path.suffix.lower() in HEIF_EXTS:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    if path.suffix.lower() in RAW_EXTS:
        from .raw_preview import read_preview
        return read_preview(path)
    with Image.open(path) as source:
        source.draft('RGB',(1600,1600))
        image=ImageOps.exif_transpose(source).convert('RGB');image.thumbnail((1600,1600))
        return image


def read_frames(row,cache_root,cancelled,max_frames=24,revision='',video_settings=None):
    if cancelled():raise InterruptedError('人物整理已暂停')
    root=Path(cache_root);source=Path(row['file_path'])
    if row['media_type']=='image':
        raw=source.suffix.lower() in RAW_EXTS
        if raw:
            from .raw_preview import cached_preview
            cached=cached_preview(row)
            if cached is not None:
                try:
                    with Image.open(cached) as image:return [(None,image.convert('RGB'))],'image_preview'
                except (OSError,ValueError):pass
        preview=None
        if row.get('thumbnail_path'):
            path=(THUMB_DIR/row['thumbnail_path']).resolve()
            if path.is_relative_to(THUMB_DIR.resolve()) and path.is_file():
                try:preview=_read_image(path)
                except (OSError,ValueError):pass
        if preview is not None and max(preview.size)>=(1600 if raw else 800):return [(None,preview)],'image_preview'
        if source.is_file():
            try:
                image=_read_image(source)
                return [(None,image)],'image_preview' if max(image.size)>=800 else 'image_preview_lowres'
            except (OSError,ValueError,subprocess.SubprocessError):
                if raw:raise FileNotFoundError('RAW 高清预览不可用，请连接原片后重新识别')
                raise FileNotFoundError('图片解码失败，等待原片或高清预览')
        if raw:raise FileNotFoundError('RAW 原片离线且没有高清预览，请连接原片后重新识别')
        raise FileNotFoundError('原文件离线且没有高清预览，请连接原片后重新识别')
    if row['media_type']!='video':raise ValueError('人物整理仅支持照片与视频')
    if video_settings is not None:
        from ..analyzer import iter_video_frames
        from contextlib import closing
        def sampled():
            with closing(iter_video_frames(source,fps=video_settings['fps'],max_frames=video_settings['max_frames'],
                         frame_res=video_settings['res'],cancelled=cancelled)) as windows:
                for frames,_ in windows:
                    for timestamp,encoded in frames:
                        if cancelled():raise InterruptedError('人物整理已暂停')
                        with Image.open(io.BytesIO(base64.b64decode(encoded.split(',',1)[1]))) as decoded:
                            image=decoded.convert('RGB')
                        yield timestamp,image
        if not source.is_file():raise FileNotFoundError('视频离线，等待原文件')
        return sampled(),'sampled_video'
    duration=row.get('duration') or 0
    budget=len(sample_times(duration,max_frames))
    rate=None
    try:
        fps=str(row.get('fps') or '').split('/')
        value=float(fps[0])/(float(fps[1]) if len(fps)==2 else 1)
        if math.isfinite(value) and 0<value<=1000:rate=value
    except (ValueError,ZeroDivisionError):pass
    def snap(values):
        # Keep exact frame-index/rate values. Rounding seconds before a second
        # floor can move fractional-FPS scouts to the previous frame.
        return sorted(set(math.floor(t*rate+1e-7)/rate for t in values)) if rate else list(values)
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    directory=root/'frames';directory.mkdir(mode=0o700,exist_ok=True)
    plan_key=hashlib.sha256(json.dumps([row['id'],revision,budget,rate,'content-adaptive-v1']).encode()).hexdigest()
    plan_path=directory/(plan_key+'.json')
    def frame(timestamp):
        if cancelled():raise InterruptedError('人物整理已暂停')
        key=hashlib.sha256(json.dumps([row['id'],revision,timestamp,'1600-v1']).encode()).hexdigest()
        cached=directory/(key+'.jpg')
        if not cached.is_file():
            if not source.is_file():raise FileNotFoundError('视频离线，等待原文件或已缓存的采样帧')
            result=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(timestamp),'-i',str(source),
                '-frames:v','1','-vf',"scale='min(1600,iw)':-2",'-f','image2pipe','-vcodec','mjpeg','pipe:1'],
                capture_output=True,timeout=20)
            if result.returncode or not result.stdout:raise FileNotFoundError('视频采样失败，等待可解码原文件')
            with Image.open(io.BytesIO(result.stdout)) as decoded:decoded.load()
            temporary=cached.with_suffix('.tmp');temporary.write_bytes(result.stdout);temporary.replace(cached)
        try:return _read_image(cached)
        except OSError:raise FileNotFoundError('视频采样缓存不可读，请重试')
    times=None
    if plan_path.is_file():
        try:
            candidate=json.loads(plan_path.read_text())
            if (isinstance(candidate,list) and 0<len(candidate)<=budget and candidate==sorted(set(candidate)) and
                    all(type(t) in (float,int) and math.isfinite(t) and 0<=t<float(duration) for t in candidate)):
                times=candidate
        except (OSError,ValueError,TypeError):pass
    scouts={}
    if times is None:
        initial=snap(sample_times(duration,min(6,budget)))
        scouts={t:frame(t) for t in initial}
        proposed=adaptive_times(initial,list(scouts.values()),budget)
        times=sorted(set(initial)|set(snap([t for t in proposed if t not in scouts])))
        temporary=plan_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(times));temporary.replace(plan_path)
    return [(t,scouts[t] if t in scouts else frame(t)) for t in times],'sampled_video'
