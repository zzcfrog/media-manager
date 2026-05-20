"""faster-whisper ASR engine."""

from __future__ import annotations

import threading
import time
from pathlib import Path

from loguru import logger

from .. import AsrEngine, AsrSegment, register_engine

AVAILABLE_MODELS = ["tiny", "base", "small", "medium", "large-v3"]

_model = None
_model_name = None
_model_loaded = False
_lock = threading.Lock()


def _get_model(model_name: str | None = None):
    global _model, _model_name, _model_loaded
    if model_name is None:
        model_name = "large-v3"
    with _lock:
        if _model is not None and _model_name == model_name:
            return _model
        # Unload old model if different
        if _model is not None:
            logger.info("卸载旧模型 {}", _model_name)
            _model = None
            _model_loaded = False
        from faster_whisper import WhisperModel
        logger.info("正在加载 Whisper {} 模型...", model_name)
        t0 = time.time()
        _model = WhisperModel(model_name, device="auto", compute_type="auto")
        _model_name = model_name
        _model_loaded = True
        logger.info("Whisper {} 模型加载完成，耗时 {:.1f}s", model_name, time.time() - t0)
    return _model


def preload(model_name: str | None = None):
    """Preload model (call directly from a background thread)."""
    t0 = time.time()
    _get_model(model_name)
    logger.info("Whisper 预加载完成，总耗时 {:.1f}s", time.time() - t0)


def unload():
    """Release model from memory."""
    global _model, _model_name, _model_loaded
    with _lock:
        _model = None
        _model_name = None
        _model_loaded = False


def is_model_loaded() -> bool:
    return _model_loaded


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:05.2f}"


@register_engine
class WhisperEngine(AsrEngine):
    name = "whisper"

    def transcribe(self, audio_path: str | Path, on_progress=None, model_name: str | None = None) -> list[AsrSegment]:
        if on_progress and not _model_loaded:
            on_progress("loading")
        model = _get_model(model_name)
        if on_progress:
            on_progress("transcribing")
        segments, _ = model.transcribe(str(audio_path), vad_filter=True, word_timestamps=True)
        results = []
        for s in segments:
            if not s.text.strip():
                continue
            if s.words:
                start = s.words[0].start
                end = s.words[-1].end
            else:
                start = s.start
                end = s.end
            results.append(AsrSegment(time_start=_fmt(start), time_end=_fmt(end), text=s.text.strip()))
        return results
