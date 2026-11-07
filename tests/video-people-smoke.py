"""Explicit real-model integration smoke over prior preview caches, never originals.

This compares calls/time on a generated clip, not recognition accuracy. No downloads.
"""
from support import _ROOT
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time

from backend.services.face_engine import load_engine
from backend.services.video_people import VideoFacePipeline,iter_frames
from PIL import Image

parser=argparse.ArgumentParser();parser.add_argument('--benchmark-cache',required=True,type=Path)
parser.add_argument('--models-dir',type=Path,default=Path.home()/'models')
args=parser.parse_args();cache=args.benchmark_cache.resolve()
faces=json.loads((cache/'results/faces.json').read_text());source=cache/'samples'/faces[0]['photo_id']/'preview.jpg'
assert source.is_file() and source.is_relative_to(cache)
models=[args.models_dir.expanduser().resolve()/name for name in ('buffalo_l','raccoon_s')]
files=[source]+[file for model in models for file in model.glob('*.onnx')]
before={file:(file.stat().st_size,file.stat().st_mtime_ns) for file in files}
result={'scope':'Generated six-second camera-motion clip from one prior cached preview; no original files or production library',
        'models':{},'accuracy_evaluated':False}
with tempfile.TemporaryDirectory(prefix='video-people-smoke-',dir=_ROOT) as temporary:
    video=Path(temporary)/'generated.mp4'
    subprocess.run(['ffmpeg','-nostdin','-v','error','-loop','1','-i',str(source),'-t','6',
        '-vf',"scale=960:-2,zoompan=z='1.04+0.002*sin(on/8)':x='iw/2-iw/zoom/2+4*sin(on/10)':y='ih/2-ih/zoom/2':d=1:s=960x600:fps=30",
        '-c:v','libx264','-pix_fmt','yuv420p',str(video)],check=True)
    for profile,folder in zip(('buffalo_l','raccoon_s'),models):
        start=time.perf_counter();model=load_engine(folder,profile,verify_enabled=profile.startswith('raccoon'))
        initialized=time.perf_counter()-start
        original_detect=model.detect;original_recognizer=model.recognizer;calls={'detection':0,'identity':0}
        class CountedRecognizer:
            def get_inputs(self):return original_recognizer.get_inputs()
            def run(self,*args,**kwargs):calls['identity']+=1;return original_recognizer.run(*args,**kwargs)
        def detect(image):calls['detection']+=1;return original_detect(image)
        model.detect=detect;model.recognizer=CountedRecognizer()
        try:
            feature_cache={};baseline_faces=0;start=time.perf_counter()
            for timestamp,image in iter_frames(video,480,lambda:False):baseline_faces+=len(model.observe(image,timestamp,feature_cache=feature_cache))
            baseline={'seconds':round(time.perf_counter()-start,3),'faces':baseline_faces,**calls}
            calls.update(detection=0,identity=0);pipeline=VideoFacePipeline(model);start=time.perf_counter()
            observations=list(pipeline.run(iter_frames(video,480,lambda:False),lambda:False))
            tracked={'seconds':round(time.perf_counter()-start,3),'faces':len(observations),'usable':sum(o['feature'] is not None for o in observations),**calls,**pipeline.stats}
            assert baseline_faces>0 and observations and tracked['usable']>0
            assert tracked['identity']<baseline['identity']
            result['models'][profile]={'initialization_seconds':round(initialized,3),'baseline':baseline,'tracking':tracked}
            print(profile,json.dumps(result['models'][profile]),flush=True)
        finally:model.detect=original_detect;model.recognizer=original_recognizer
assert before=={file:(file.stat().st_size,file.stat().st_mtime_ns) for file in files}
result['existing_caches_and_weights_unchanged']=True
out=Path('build/people-video-integration');out.mkdir(parents=True,exist_ok=True)
(out/'model-smoke.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
