"""faster-whisper ASR engine."""

from __future__ import annotations

import logging
import time
from pathlib import Path

from .. import AsrEngine, AsrSegment, register_engine

logger = logging.getLogger(__name__)

_model = None
_model_loaded = False


def _get_model():
    global _model, _model_loaded
    if _model is None:
        from faster_whisper import WhisperModel
        logger.info("正在加载 Whisper large-v3 模型...")
        t0 = time.time()
        _model = WhisperModel("large-v3", device="auto", compute_type="auto")
        logger.info("Whisper 模型加载完成，耗时 %.1fs", time.time() - t0)
        _model_loaded = True
    return _model


def is_model_loaded() -> bool:
    return _model_loaded


def _fmt(seconds: float) -> str:
    m = int(seconds // 60)
    s = seconds - m * 60
    return f"{m:02d}:{s:05.2f}"


@register_engine
class WhisperEngine(AsrEngine):
    name = "whisper"

    def transcribe(self, audio_path: str | Path, on_progress=None) -> list[AsrSegment]:
        if on_progress and not _model_loaded:
            on_progress("loading")
        model = _get_model()
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
