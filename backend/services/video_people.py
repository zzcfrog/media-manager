"""Continuous video faces using pinned InsightFace motion and candidate primitives.

Decode selected frames in memory. Motion/scene cuts trigger detection; identity uses
a configurable number of real detector anchors per track. Grouping combines those
anchors only after checking features and human decisions; track IDs alone are insufficient.
"""
from contextlib import closing,nullcontext
import json
import math
from pathlib import Path
import sys
import subprocess
import os
import queue
import re
import select
import threading
from collections import deque

import cv2
import numpy as np
from PIL import Image

from ..vendor.insightface_privateframe.geometry import clip,iou,normalized_center_distance,area_ratio
from ..vendor.insightface_privateframe.tracker import BoxKalman,_estimate_flow
from ..vendor.insightface_privateframe.scene_cut import SceneCutDetector
from ..vendor.insightface_privateframe.recognition_samples import RecognitionCandidate,recognition_candidate_quality,select_temporally_distributed

_DEFAULTS=json.loads((Path(__file__).resolve().parents[1]/'vendor/insightface_privateframe/defaults.json').read_text())
_FLOW={**_DEFAULTS['flow'],'padding_pixels':_DEFAULTS['flow']['roi_edge_padding_pixels']}
DETECTION_INTERVAL=1/15
POOL_SIZE=6


def iter_frames(path,resolution,cancelled,fps=None):
    """Stream original frames/PTS, optionally keeping one per sampling interval."""
    if fps is not None and (type(fps) is not int or fps not in (1,2,3)):
        raise ValueError('视频人脸检测帧率请选择 1、2 或 3 帧/秒')
    if cancelled():raise InterruptedError('人物整理已暂停')
    path=Path(path)
    if not path.is_file():raise FileNotFoundError('视频离线，等待原文件')
    metadata=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries',
        'stream=width,height:stream_tags=rotate:stream_side_data=rotation','-of','json',str(path)],capture_output=True,timeout=15)
    if metadata.returncode:raise RuntimeError('无法读取视频信息')
    streams=json.loads(metadata.stdout).get('streams',[])
    if not streams:raise RuntimeError('文件没有视频轨道')
    stream=streams[0];width=int(stream['width']);height=int(stream['height'])
    rotation=next((item['rotation'] for item in stream.get('side_data_list',[]) if 'rotation' in item),stream.get('tags',{}).get('rotate',0))
    if int(round(float(rotation)/90))%2:width,height=height,width
    ratio=1. if resolution is None else min(1.,resolution/min(width,height))
    width=max(2,int(width*ratio)//2*2);height=max(2,int(height*ratio)//2*2)
    frame_bytes=width*height*3
    sampling=f"select='isnan(prev_selected_t)+gt(floor(t*{fps}),floor(prev_selected_t*{fps}))'," if fps else ''
    attempts=[['-hwaccel','videotoolbox'],[]] if sys.platform=='darwin' else [[]]
    for hardware in attempts:
        count=0;origin=None;prior=-1.;times=queue.Queue(maxsize=8);stopped=threading.Event();reader_done=threading.Event();errors=deque(maxlen=12)
        command=['ffmpeg','-nostdin','-hide_banner','-loglevel','info','-xerror',*hardware,'-i',str(path),'-map','0:v:0','-an','-sn',
                 '-vf',sampling+f'scale={width}:{height},showinfo','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
        process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=65536)
        def read_metadata():
            try:
                for line in iter(process.stderr.readline,b''):
                    match=re.search(rb'\bn:\s*\d+.*?\bpts_time:\s*([-\d.e+]+)',line)
                    if match:
                        while not stopped.is_set():
                            try:times.put(float(match[1]),timeout=.1);break
                            except queue.Full:pass
                    elif any(word in line.lower() for word in (b'error',b'invalid',b'failed',b'premature',b'corrupt')):errors.append(line.decode(errors='replace')[:250])
                    if stopped.is_set():break
            finally:reader_done.set()
        reader=threading.Thread(target=read_metadata,daemon=True);reader.start()
        try:
            while True:
                data=bytearray()
                while len(data)<frame_bytes:
                    if cancelled():raise InterruptedError('人物整理已暂停')
                    if not select.select([process.stdout],[],[],.2)[0]:continue
                    chunk=os.read(process.stdout.fileno(),min(frame_bytes-len(data),65536))
                    if not chunk:break
                    data.extend(chunk)
                if not data:break
                if len(data)!=frame_bytes:raise RuntimeError('连续视频解码返回了不完整画面')
                while True:
                    if cancelled():raise InterruptedError('人物整理已暂停')
                    try:raw=times.get(timeout=.2);break
                    except queue.Empty:
                        if reader_done.is_set():raise RuntimeError('视频画面缺少时间戳')
                if origin is None:origin=raw
                timestamp=raw-origin
                if not math.isfinite(timestamp) or timestamp<prior-1e-6:raise RuntimeError('视频时间戳不连续，无法安全定位人物')
                prior=timestamp;count+=1
                yield timestamp,Image.frombytes('RGB',(width,height),bytes(data))
            code=process.wait(timeout=5)
            reader.join(timeout=1)
            damaged=any(word in line.lower() for line in errors for word in ('premature','corrupt'))
            if code or damaged:
                if hardware and count==0:continue
                raise RuntimeError('连续视频解码失败：'+''.join(errors)[-400:])
            if not count:raise RuntimeError('视频解码没有返回画面')
            return
        finally:
            stopped.set()
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=2)
                except subprocess.TimeoutExpired:process.kill();process.wait()
            reader.join(timeout=1);process.stdout.close();process.stderr.close()


class VideoFacePipeline:
    def __init__(self,model,identity_samples=4):
        if type(identity_samples) is not int or not 1<=identity_samples<=48:
            raise ValueError('每条轨迹的代表人脸上限应为 1～48 张')
        self.identity_samples=identity_samples;self.pool_size=max(POOL_SIZE,identity_samples*2)
        self.model=model;self.tracks={};self.serial=0;self.previous=None;self.last_detection=-math.inf
        self.stats={'decoded_frames':0,'detector_calls':0,'identity_candidates':0,'tracks':0,'scene_cuts':0,'peak_candidates':0}
        self.feature_cache={}

    def _finish(self,track,cancelled):
        candidates=track['candidates']
        selected=select_temporally_distributed([item[0] for item in candidates],self.identity_samples) if candidates else []
        fallback=track.get('fallback')
        if not selected and fallback:selected=[fallback[0]]
        prepared={item[0].frame_index:item[1] for item in candidates+([fallback] if fallback else [])}
        for choice in selected:
            if cancelled():raise InterruptedError('人物整理已暂停')
            self.stats['identity_candidates']+=1
            observation=self.model.embed_face(prepared[choice.frame_index],self.feature_cache)
            if observation is not None:
                observation['track_id']=track['id']
                yield observation
        candidates.clear()
        track['fallback']=None

    def _candidate(self,track,index,timestamp,image,face):
        prepared=self.model.prepare_face(image,face,timestamp,include_verifier=True)
        aligned=np.asarray(prepared['crop'])[:,:,::-1]
        rank,eligible,_=recognition_candidate_quality(aligned,face['box'],face['points'],face['score'],(image.height,image.width,3))
        prepared['_eligible']=bool(prepared['_eligible'] and eligible)
        candidate=RecognitionCandidate(index,rank,aligned,'global_scrfd')
        if not prepared['_eligible']:
            if not track.get('fallback') or rank>track['fallback'][0].quality:track['fallback']=(candidate,prepared)
            return
        track['candidates'].append((candidate,prepared))
        selected=select_temporally_distributed([item[0] for item in track['candidates']],self.pool_size)
        keep={item.frame_index for item in selected}
        track['candidates']=[item for item in track['candidates'] if item[0].frame_index in keep]

    def _new_motion(self,gray):
        difference=cv2.absdiff(self.previous,gray)
        for track in self.tracks.values():
            x,y,x2,y2=track['box'];w=x2-x;h=y2-y
            x,y,x2,y2=map(int,clip([x-w*.2,y-h*.2,x2+w*.2,y2+h*.2],gray.shape[1],gray.shape[0]))
            difference[y:y2,x:x2]=0
        return float(np.mean(difference>25))>.005

    def _step(self,index,timestamp,image,cut,cancelled,last=False):
        gray=cv2.cvtColor(np.asarray(image),cv2.COLOR_RGB2GRAY)
        if cut:self.stats['scene_cuts']+=1
        discontinuity=cut or self.previous is not None and gray.shape!=self.previous.shape
        if discontinuity:
            for track in self.tracks.values():yield from self._finish(track,cancelled)
            self.tracks.clear();self.previous=None;self.last_detection=-math.inf
        lost=False
        for track in self.tracks.values():
            if cancelled():raise InterruptedError('人物整理已暂停')
            track['filter'].predict()
            flow=_estimate_flow(self.previous,gray,track['box'],_FLOW)
            if flow['valid'] and flow['quality']>=.2:
                track['filter'].update(flow['box'],2.5,.1,update_size=False)
                track['box']=clip(track['filter'].box(),image.width,image.height)
            else:lost=True
        detect=last or lost or not self.tracks or timestamp-self.last_detection>=DETECTION_INTERVAL-1e-6
        if self.previous is not None and not detect:detect=self._new_motion(gray)
        # An empty scene still uses regular scans plus motion-triggered discovery.
        if not self.tracks and self.previous is not None:
            detect=last or timestamp-self.last_detection>=DETECTION_INTERVAL-1e-6 or self._new_motion(gray)
        if detect:
            if cancelled():raise InterruptedError('人物整理已暂停')
            faces=self.model.detect(image);self.stats['detector_calls']+=1;self.last_detection=timestamp
            old=list(self.tracks.values());scores=np.zeros((len(old),len(faces)))
            for row,track in enumerate(old):
                for col,face in enumerate(faces):
                    if area_ratio(track['box'],face['box'])<=2.5 and normalized_center_distance(track['box'],face['box'])<=.75:
                        scores[row,col]=iou(track['box'],face['box'])
            matched={};used=set()
            for col,face in enumerate(faces):
                if not len(old):continue
                row=int(np.argmax(scores[:,col]));score=scores[row,col]
                if score<.3 or int(np.argmax(scores[row]))!=col:continue
                alternatives=np.delete(scores[:,col],row);other_faces=np.delete(scores[row],col)
                if (len(alternatives) and score-float(alternatives.max())<.15) or (len(other_faces) and score-float(other_faces.max())<.15):continue
                matched[col]=old[row];used.add(old[row]['id'])
            for track in old:
                if track['id'] not in used:
                    yield from self._finish(track,cancelled);del self.tracks[track['id']]
            for original,face in sorted(enumerate(faces),key=lambda item:float(item[1]['box'][0])):
                track=matched.get(original)
                if track is None:
                    self.serial+=1;self.stats['tracks']+=1
                    track={'id':str(self.serial),'box':face['box'],'filter':BoxKalman(face['box'],_DEFAULTS['flow']),'candidates':[],'fallback':None}
                    self.tracks[track['id']]=track
                track['filter'].update(face['box'],.75,.01);track['box']=np.asarray(face['box']).copy()
                self._candidate(track,index,timestamp,image,face)
            self.stats['peak_candidates']=max(self.stats['peak_candidates'],sum(len(t['candidates'])+int(t['fallback'] is not None) for t in self.tracks.values()))
        self.previous=gray

    def run(self,frames,cancelled):
        detector=SceneCutDetector(_DEFAULTS['scan']);pending={}
        try:
            with closing(frames) if hasattr(frames,'close') else nullcontext(frames):
                for index,(timestamp,image) in enumerate(frames):
                    if cancelled():raise InterruptedError('人物整理已暂停')
                    self.stats['decoded_frames']+=1;pending[index]=(timestamp,image)
                    audits=detector.observe(index,np.asarray(image)[:,:,::-1],timestamp)
                    for audit in audits:
                        i=audit['frame_idx'];t,picture=pending.pop(i)
                        yield from self._step(i,t,picture,audit['scene_cut_from_previous'],cancelled)
                for audit in detector.flush():
                    i=audit['frame_idx'];t,picture=pending.pop(i)
                    yield from self._step(i,t,picture,audit['scene_cut_from_previous'],cancelled,last=True)
                for track in self.tracks.values():yield from self._finish(track,cancelled)
        finally:
            self.tracks.clear();pending.clear();self.previous=None;self.feature_cache.clear()
