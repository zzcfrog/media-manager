"""Persistent, isolated native video worker; parent never imports OpenCV.

Its private pipes carry only locally generated records. Cancellation terminates
the worker process group, including its decoder, before another request starts.
"""
import atexit
from collections import deque
import json
import os
import pickle
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading
import uuid


class VideoRuntime:
    def __init__(self):
        self.process=None;self.lock=threading.Lock();self.events=None;self.stopped=None;self.errors=deque(maxlen=16)

    def close(self):
        process,self.process=self.process,None
        if self.stopped:self.stopped.set()
        if process:
            if process.poll() is None:
                try:os.killpg(process.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                try:process.wait(timeout=3)
                except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
            for stream in (process.stdin,process.stdout,process.stderr):stream.close()

    def _start(self):
        if self.process is not None and self.process.poll() is None:return
        self.close();self.events=queue.Queue(maxsize=4);self.stopped=threading.Event();self.errors.clear()
        command=[sys.executable,'people-video-worker'] if getattr(sys,'frozen',False) else [sys.executable,'-m','backend.services.video_worker']
        self.process=subprocess.Popen(command,cwd=Path(__file__).resolve().parents[2],stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        process,events,stopped=self.process,self.events,self.stopped
        def put(event):
            while not stopped.is_set():
                try:events.put(event,timeout=.1);return
                except queue.Full:pass
        def read_events():
            try:
                while not stopped.is_set():put(pickle.load(process.stdout))
            except (EOFError,OSError,ValueError,pickle.UnpicklingError):
                if not stopped.is_set():put({'event':'crashed'})
        def read_errors():
            try:
                for line in iter(process.stderr.readline,b''):
                    if stopped.is_set():break
                    self.errors.append(line.decode(errors='replace')[:500])
            except (OSError,ValueError):pass
        threading.Thread(target=read_events,daemon=True).start();threading.Thread(target=read_errors,daemon=True).start()

    def run(self,request,cancelled):
        acquired=False;complete=False
        try:
            while not acquired:
                if cancelled():raise InterruptedError('人物整理已暂停')
                acquired=self.lock.acquire(timeout=.2)
            self._start();request={**request,'id':uuid.uuid4().hex}
            self.process.stdin.write((json.dumps(request)+'\n').encode());self.process.stdin.flush()
            while True:
                if cancelled():raise InterruptedError('人物整理已暂停')
                try:event=self.events.get(timeout=.2)
                except queue.Empty:continue
                if event['event']=='crashed':raise RuntimeError('视频工作进程意外退出：'+''.join(self.errors)[-400:])
                if event.get('id')!=request['id']:raise RuntimeError('视频工作进程响应与任务不一致')
                if event['event']=='error':
                    error={'missing':FileNotFoundError,'invalid':ValueError}.get(event.get('kind'),RuntimeError)
                    raise error(event['error'])
                if event['event']=='done':complete=True;yield event;return
                yield event
        finally:
            if acquired:
                if not complete:self.close()
                self.lock.release()


_runtime=VideoRuntime()
atexit.register(_runtime.close)


class VideoResult:
    def __init__(self,settings,path,resolution,cancelled):
        self.request={'settings':settings,'path':str(path),'resolution':resolution}
        self.cancelled=cancelled;self.model_key='';self.stats={}

    def run(self):
        events=_runtime.run(self.request,self.cancelled)
        try:
            for event in events:
                if event['event']=='ready':self.model_key=event['model_key']
                elif event['event']=='observation':yield event['observation']
                elif event['event']=='done':self.stats=event['stats']
        finally:events.close()
