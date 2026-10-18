from support import _ROOT
import sys
import threading
import types
import unittest
from unittest.mock import patch
from backend.asr.engines import whisper

class WhisperTests(unittest.TestCase):
    def test_switching_after_unlock_cannot_change_returned_model(self):
        first_unlocked=threading.Event();second_loading=threading.Event();finish_second=threading.Event()
        mutex=threading.Lock();errors=[];completed=[]
        class ControlledLock:
            def __enter__(self):mutex.acquire();return self
            def __exit__(self,*args):
                mutex.release()
                if threading.current_thread().name=='fixture-A':
                    first_unlocked.set()
                    if not second_loading.wait(3):raise AssertionError('second load missing')
        def factory(name,**kwargs):
            if name=='base':
                second_loading.set()
                if not finish_second.wait(3):raise AssertionError('first return missing')
            return types.SimpleNamespace(transcribe=lambda *a,**kw:([],None))
        def run(name):
            try:
                if name=='base' and not first_unlocked.wait(3):raise AssertionError('first load missing')
                whisper.WhisperEngine().transcribe('synthetic.wav',model_name=name);completed.append(name)
            except Exception as e:errors.append(e)
            finally:
                if name=='small':finish_second.set()
        with patch.object(whisper,'_lock',ControlledLock()),patch.object(whisper,'_model',None),patch.object(whisper,'_model_name',None),patch.object(whisper,'_model_loaded',False),patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=factory)}):
            threads=[threading.Thread(target=run,args=(name,),name='fixture-'+label) for name,label in [('small','A'),('base','B')]]
            try:
                for thread in threads:thread.start()
                for thread in threads:thread.join(4)
                self.assertFalse(any(thread.is_alive() for thread in threads));self.assertEqual(errors,[])
                self.assertEqual(set(completed),{'small','base'})
            finally:
                finish_second.set()
                for thread in threads:thread.join(4)
