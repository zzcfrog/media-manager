"""Opt-in local proxy-video experiment; no production writes or original-media edits.

Uses prior cached previews to generate a controlled 4K HEVC input. Proxies keep
all frames unless explicitly selecting 3fps/2fps/1fps. Total latency includes proxy creation.
"""
from support import _ROOT
import argparse
from contextlib import closing
import json
from pathlib import Path
import random
import statistics
import subprocess
import tempfile
import time

from backend.services.face_engine import load_engine
from backend.services.video_people import VideoFacePipeline,iter_frames


def command(args):
    started=time.perf_counter()
    result=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-v','error','-y',*args],capture_output=True,timeout=240)
    if result.returncode:raise RuntimeError(result.stderr.decode(errors='replace')[-1200:])
    return time.perf_counter()-started


def probe(path):
    result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries',
        'stream=width,height,codec_name,pix_fmt,r_frame_rate,nb_frames:format=duration','-of','json',str(path)],capture_output=True,check=True)
    data=json.loads(result.stdout);return {**data['streams'][0],'duration':float(data['format']['duration']),'bytes':path.stat().st_size}


def iou(first,second):
    x,y,w,h=first;xx,yy,ww,hh=second
    intersection=max(0,min(x+w,xx+ww)-max(x,xx))*max(0,min(y+h,yy+hh)-max(y,yy))
    return intersection/max(1e-9,w*h+ww*hh-intersection)


def compare(reference,candidate):
    baseline_total=sum(len(items) for items in reference.values());candidate_total=0;matched=0;values=[];usable_lost=0
    for instant,anchors in reference.items():
        others=candidate.get(instant,[]);candidate_total+=len(others);used=set()
        for anchor in anchors:
            options=[(iou(anchor['bbox'],item['bbox']),index,item) for index,item in enumerate(others) if index not in used]
            if not options:
                usable_lost+=int(anchor['feature'] is not None);continue
            overlap,index,item=max(options,key=lambda value:value[0])
            if overlap<.5:
                usable_lost+=int(anchor['feature'] is not None);continue
            matched+=1;used.add(index)
            if anchor['feature'] is not None and item['feature'] is not None:values.append(float(anchor['feature']@item['feature']))
            elif anchor['feature'] is not None:usable_lost+=1
    return {'reference_faces':baseline_total,'candidate_faces':candidate_total,'matched_faces':matched,
            'relative_face_retention':matched/baseline_total if baseline_total else None,
            'missing_usable_faces':usable_lost,'compared_embeddings':len(values),
            'cosine_median':statistics.median(values) if values else None,'cosine_min':min(values) if values else None,
            'embeddings_below_existing_point6_threshold':sum(value<.6 for value in values)}


def anchor_observations(model,path,times):
    anchors={};pending=iter(times);wanted=next(pending,None)
    with closing(iter_frames(path,480,lambda:False)) as frames:
        for timestamp,image in frames:
            if wanted is None:break
            if timestamp>=wanted-1e-5:
                rows=model.observe(image,timestamp)
                anchors[str(wanted)]=[{key:value for key,value in item.items() if key in ('bbox','feature','quality','score')} for item in rows]
                wanted=next(pending,None)
    return anchors


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--benchmark-cache',required=True,type=Path)
    parser.add_argument('--models-dir',type=Path,default=Path.home()/'models')
    parser.add_argument('--repeats',type=int,default=3);parser.add_argument('--seconds-per-scene',type=float,default=2)
    parser.add_argument('--profiles',nargs='+',choices=('buffalo_l','raccoon_s'),default=['buffalo_l','raccoon_s'])
    parser.add_argument('--proxies',nargs='+',choices=('proxy720','proxy480','proxy320','proxy480_3fps','proxy480_2fps','proxy480_1fps'),default=['proxy720','proxy480','proxy320'])
    parser.add_argument('--skip-direct-timing',action='store_true',help='Keep direct input as quality reference without repeating its recognition timing')
    parser.add_argument('--output',type=Path,default=Path('build/people-video-compression'))
    args=parser.parse_args()
    if not 1<=args.repeats<=5 or not 1<=args.seconds_per_scene<=20:parser.error('Use 1–5 rounds and 1–20 seconds per scene')
    root=args.benchmark_cache.resolve();models=args.models_dir.expanduser().resolve()
    faces=json.loads((root/'results/faces.json').read_text());sources=[];seen=set()
    for face in faces:
        if face['photo_id'] in seen:continue
        seen.add(face['photo_id']);path=root/'samples'/face['photo_id']/'preview.jpg'
        if path.is_file():sources.append(path)
        if len(sources)==3:break
    assert len(sources)==3
    files=sources+[file for profile in args.profiles for file in (models/profile).glob('*.onnx')]
    before={file:(file.stat().st_size,file.stat().st_mtime_ns) for file in files}
    result={'date':'2026-11-01','input_scope':'Three prior cached 1600px previews, generated 4K HEVC camera-motion video with three scenes',
            'real_original_video_available':False,'real_accuracy_measured':False,'source_fps':30,
            'inference_resolution':480,'repeats':args.repeats,'seconds_per_scene':args.seconds_per_scene,
            'direct_timing_measured':not args.skip_direct_timing,'preparation':{},'variants':{},'models':{},
            'limits':['Upscaled preview-generated video, not a real camera original','Relative consistency versus direct input, not human-labeled recognition accuracy',
                      'Local warm filesystem cache; no external-drive I/O comparison','Processing times exclude model load and analysis-only quality probes']}
    output=args.output;output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='video-compression-',dir=_ROOT) as temporary:
        temporary=Path(temporary);original=temporary/'4k-hevc.mp4';inputs=[];filters=[]
        for index,source in enumerate(sources):
            inputs+=['-loop','1','-i',str(source)]
            filters.append(f"[{index}:v]scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='1.025+0.001*sin(on/8)':x='iw/2-iw/zoom/2+4*sin(on/10)':y='ih/2-ih/zoom/2':d=1:s=3840x2160:fps=30,trim=duration={args.seconds_per_scene},setpts=PTS-STARTPTS[s{index}]")
        filters.append('[s0][s1][s2]concat=n=3:v=1:a=0[out]')
        result['preparation']['source_generation_seconds']=command([*inputs,'-filter_complex',';'.join(filters),'-map','[out]',
            '-c:v','libx265','-preset','ultrafast','-crf','18','-x265-params','pools=2:frame-threads=2:log-level=error',
            '-pix_fmt','yuv420p10le','-tag:v','hvc1',str(original)])
        print('generated_4k_hevc',json.dumps(probe(original)),flush=True)
        paths={'direct':original}
        result['variants']['direct']={'label':'原输入直接识别','compression_seconds':[0.]*args.repeats,'input':probe(original),'recipe':None}
        for name,width,height,crf,preset in [('proxy720',1280,720,23,'veryfast'),('proxy480',852,480,28,'ultrafast'),('proxy320',568,320,28,'ultrafast'),('proxy480_3fps',852,480,28,'ultrafast'),('proxy480_2fps',852,480,28,'ultrafast'),('proxy480_1fps',852,480,28,'ultrafast')]:
            if name not in args.proxies:continue
            path=temporary/(name+'.mp4');paths[name]=path;elapsed=[]
            target_fps={'proxy480_1fps':1,'proxy480_2fps':2,'proxy480_3fps':3}.get(name,30)
            video_filter=(f'fps={target_fps},' if target_fps!=30 else '')+f'scale={width}:{height}'
            for _ in range(args.repeats):elapsed.append(command(['-hwaccel','videotoolbox','-i',str(original),'-map','0:v:0','-an','-sn',
                '-vf',video_filter,'-fps_mode','passthrough','-c:v','libx264','-crf',str(crf),'-preset',preset,'-pix_fmt','yuv420p',str(path)]))
            result['variants'][name]={'label':name,'compression_seconds':elapsed,'input':probe(path),
                'recipe':{'encoder':'libx264','crf':crf,'preset':preset,'width':width,'height':height,'preserve_fps':target_fps==30,
                          'target_fps':target_fps,'video_filter':video_filter}}
            print('compressed',name,'median_seconds',round(statistics.median(elapsed),3),'bytes',path.stat().st_size,flush=True)
        for name,path in paths.items():
            started=time.perf_counter();count=0;size=None;previous=None;gaps=[]
            for timestamp,image in iter_frames(path,480,lambda:False):
                count+=1;size=image.size
                if previous is not None:gaps.append(timestamp-previous)
                previous=timestamp
            result['variants'][name].update(decode_only_seconds=time.perf_counter()-started,decoded_frames=count,inference_frame_size=size,
                timestamp_gap_min=min(gaps,default=0),timestamp_gap_max=max(gaps,default=0),
                timestamp_gaps_over_half_second=sum(gap>.5 for gap in gaps))
        source_count=result['variants']['direct']['decoded_frames'];assert source_count>0
        for name,item in result['variants'].items():
            target_fps=item['recipe']['target_fps'] if item['recipe'] else 30
            expected=(source_count*target_fps+15)//30
            assert item['decoded_frames']==expected,(name,item['decoded_frames'],expected)
        times=[index*args.seconds_per_scene+args.seconds_per_scene*fraction for index in range(3) for fraction in (.25,.5,.75)]
        timed_names=[name for name in paths if name!='direct' or not args.skip_direct_timing]
        for profile in args.profiles:
            started=time.perf_counter();model=load_engine(models/profile,profile,verify_enabled=profile=='raccoon_s')
            record={'model_initialization_seconds':time.perf_counter()-started,'runs':{name:[] for name in timed_names},'quality':{}}
            # Warm both networks before timing, then compare against the same source frames.
            reference=anchor_observations(model,original,times);assert sum(len(items) for items in reference.values())>0
            for name,path in paths.items():record['quality'][name]=compare(reference,anchor_observations(model,path,times))
            original_recognizer=model.recognizer;calls={'identity':0}
            class CountedRecognizer:
                def get_inputs(self):return original_recognizer.get_inputs()
                def run(self,*a,**kw):calls['identity']+=1;return original_recognizer.run(*a,**kw)
            model.recognizer=CountedRecognizer()
            try:
                for repeat in range(args.repeats):
                    names=list(timed_names);random.Random(20261101+repeat).shuffle(names)
                    for name in names:
                        calls['identity']=0;pipeline=VideoFacePipeline(model);started=time.perf_counter()
                        print('starting',profile,repeat+1,name,flush=True)
                        def progress_frames():
                            with closing(iter_frames(paths[name],480,lambda:False)) as frames:
                                for index,frame in enumerate(frames,1):
                                    if index%300==0:print('progress',name,index,'frames',round(time.perf_counter()-started,1),'seconds',flush=True)
                                    yield frame
                        observations=list(pipeline.run(progress_frames(),lambda:False))
                        elapsed=time.perf_counter()-started
                        item={'recognition_seconds':elapsed,'compression_seconds':result['variants'][name]['compression_seconds'][repeat],
                              'total_seconds':elapsed+result['variants'][name]['compression_seconds'][repeat],
                              'observations':len(observations),'usable':sum(o['feature'] is not None for o in observations),
                              'actual_identity_calls':calls['identity'],**pipeline.stats}
                        assert item['decoded_frames']==result['variants'][name]['decoded_frames']
                        record['runs'][name].append(item)
                        print(profile,repeat+1,name,'recognition',round(elapsed,3),'total',round(item['total_seconds'],3),
                              'tracks',item['tracks'],'usable',item['usable'],flush=True)
            finally:model.recognizer=original_recognizer
            record['summary']={}
            for name,runs in record['runs'].items():
                record['summary'][name]={'median_recognition_seconds':statistics.median(item['recognition_seconds'] for item in runs),
                    'median_compression_seconds':statistics.median(item['compression_seconds'] for item in runs),
                    'median_total_seconds':statistics.median(item['total_seconds'] for item in runs),
                    'total_seconds_range':[min(item['total_seconds'] for item in runs),max(item['total_seconds'] for item in runs)],
                    'tracks':[item['tracks'] for item in runs],'usable':[item['usable'] for item in runs]}
            result['models'][profile]=record
            (output/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    assert before=={file:(file.stat().st_size,file.stat().st_mtime_ns) for file in files}
    result['original_caches_and_model_weights_unchanged']=True
    result['temporary_videos_removed']=True
    (output/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('complete',str(output/'results.json'),flush=True)


if __name__=='__main__':main()
