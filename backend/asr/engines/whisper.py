"""faster-whisper ASR engine."""

from __future__ import annotations

import logging
import time
from pathlib import Path

from .. import AsrEngine, AsrSegment, register_engine

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        logger.info("正在加载 Whisper large-v3 模型...")
        t0 = time.time()
        _model = WhisperModel("large-v3", device="auto", compute_type="auto")
        logger.info("Whisper 模型加载完成，耗时 %.1fs", time.time() - t0)
    return _model


def _fmt(seconds: float) -> str:
    m = int(seconds // 60)
    s = seconds - m * 60
    return f"{m:02d}:{s:05.2f}"


@register_engine
class WhisperEngine(AsrEngine):
    name = "whisper"

    def transcribe(self, audio_path: str | Path) -> list[AsrSegment]:
        model = _get_model()
        segments, _ = model.transcribe(str(audio_path))
        return [
            AsrSegment(time_start=_fmt(s.start), time_end=_fmt(s.end), text=s.text.strip())
            for s in segments
            if s.text.strip()
        ]
