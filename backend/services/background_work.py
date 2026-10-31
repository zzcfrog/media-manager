"""Serialize local background inference across classification and people tasks."""
from contextlib import contextmanager
import threading

_inference_lock=threading.Lock()


@contextmanager
def inference_slot(cancelled=lambda:False):
    while not _inference_lock.acquire(timeout=.1):
        if cancelled():raise InterruptedError('后台任务已暂停')
    try:
        if cancelled():raise InterruptedError('后台任务已暂停')
        yield
    finally:
        _inference_lock.release()
