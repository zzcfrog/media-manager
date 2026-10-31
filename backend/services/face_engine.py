"""Offline SCRFD + ArcFace inference using external ONNX pairs; no downloads.

Only numpy/Pillow and the existing ONNX runtime are needed. Model spaces include
the exact weights and preprocessing revision. Results are observations, not names.
"""
import hashlib
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
    'raccoon_s': ('det_10g_wo.onnx', 'w600k_mbf.onnx'),
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


def model_info(directory,profile='buffalo_l'):
    if profile not in PROFILES:raise ValueError('不支持的人脸模型组合')
    if not str(directory).strip():raise FileNotFoundError('请先选择外部人脸模型目录')
    root=Path(directory).expanduser().resolve()
    paths=[root/name for name in PROFILES[profile]]
    if not all(p.is_file() and p.stat().st_size for p in paths):
        raise FileNotFoundError('缺少匹配的人脸检测和识别 ONNX 文件')
    signature=tuple((str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in paths)
    with _lock:
        prior=_cache.get(('info',str(root),profile))
        if prior and prior['signature']==signature:return prior
    digest=hashlib.sha256(('scrfd-arcface-rgb-pillow-v1:'+profile).encode())
    for path in paths:
        with path.open('rb') as source:
            for block in iter(lambda:source.read(8<<20),b''):digest.update(block)
    info={'key':digest.hexdigest(),'profile':profile,'paths':paths,'signature':signature,
          'bytes':sum(p.stat().st_size for p in paths)}
    if signature!=tuple((str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in paths):
        raise FileNotFoundError('模型加载期间发生变化，请重试')
    with _lock:_cache[('info',str(root),profile)]=info
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
        if len(self.detector.get_outputs())!=9:raise ValueError('需要带五点关键点的 SCRFD 检测器')
        if self.recognizer.get_inputs()[0].shape[-2:]!=[112,112]:raise ValueError('人脸识别器输入尺寸不兼容')
        self.info=info

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

    def observe(self,image,frame_time=None,cancelled=lambda:False,feature_cache=None):
        results=[];width,height=image.size
        for face in self.detect(image):
            if cancelled():raise InterruptedError('人物整理已暂停')
            x,y,x2,y2=face['box'];w=x2-x;h=y2-y
            matrix=np.vstack([alignment_matrix(face['points']),[0,0,1]])
            inverse=np.linalg.inv(matrix)
            crop=image.convert('RGB').transform((112,112),Image.Transform.AFFINE,
                       tuple(inverse[:2].reshape(-1)),resample=Image.Resampling.BILINEAR)
            gray=np.asarray(crop.convert('L'),dtype=np.float32)
            sharpness=float(np.var(np.diff(gray,axis=0))+np.var(np.diff(gray,axis=1)))
            quality=min(1.,min(w,h)/64)*min(1.,sharpness/50)*face['score']
            vector=None
            if min(w,h)>=24 and sharpness>=8:
                key=hashlib.sha256(crop.tobytes()).hexdigest()
                vector=feature_cache.get(key) if feature_cache is not None else None
                if vector is None:
                    pixels=(np.asarray(crop,dtype=np.float32)-127.5)/127.5
                    vector=normalized(self.recognizer.run(None,{self.recognizer.get_inputs()[0].name:pixels.transpose(2,0,1)[None]})[0])
                    if feature_cache is not None:
                        if len(feature_cache)>=256:feature_cache.pop(next(iter(feature_cache)))
                        feature_cache[key]=vector
                if len(vector)!=512:raise ValueError('人脸特征维度不兼容')
            bbox=[float(x/width),float(y/height),float(w/width),float(h/height)]
            results.append({'frame_time':frame_time,'bbox':bbox,'score':face['score'],
                            'quality':float(quality),'feature':vector,'crop':crop})
        return results


def load_engine(directory,profile='buffalo_l'):
    info=model_info(directory,profile)
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
        for tag in ('JpgFromRaw','PreviewImage','ThumbnailImage'):
            result=subprocess.run(['exiftool','-b','-'+tag,str(path)],capture_output=True,timeout=15)
            if result.returncode==0 and len(result.stdout)>100:
                with Image.open(io.BytesIO(result.stdout)) as source:
                    source.draft('RGB',(1600,1600))
                    image=ImageOps.exif_transpose(source).convert('RGB');image.thumbnail((1600,1600))
                    return image
        raise FileNotFoundError('RAW 没有可用内嵌预览')
    with Image.open(path) as source:
        source.draft('RGB',(1600,1600))
        image=ImageOps.exif_transpose(source).convert('RGB');image.thumbnail((1600,1600))
        return image


def read_frames(row,cache_root,cancelled,max_frames=24,revision=''):
    if cancelled():raise InterruptedError('人物整理已暂停')
    root=Path(cache_root);source=Path(row['file_path'])
    if row['media_type']=='image':
        preview=None
        if row.get('thumbnail_path'):
            path=(THUMB_DIR/row['thumbnail_path']).resolve()
            if path.is_relative_to(THUMB_DIR.resolve()) and path.is_file():
                try:preview=_read_image(path)
                except (OSError,ValueError):pass
        if preview is not None and max(preview.size)>=800:return [(None,preview)],'image_preview'
        if source.is_file():
            try:
                image=_read_image(source)
                return [(None,image)],'image_preview' if max(image.size)>=800 else 'image_preview_lowres'
            except (OSError,ValueError,subprocess.SubprocessError):
                if preview is None:raise FileNotFoundError('图片解码失败，等待可用预览')
        if preview is not None:return [(None,preview)],'image_preview_lowres'
        raise FileNotFoundError('原文件离线且没有可用图片预览')
    if row['media_type']!='video':raise ValueError('人物整理仅支持照片与视频')
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
