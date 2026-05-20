"""ASR plugin system — pluggable speech recognition engines."""

from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

from loguru import logger

_ENGINES: dict[str, type[AsrEngine]] = {}
_INSTANCES: dict[str, AsrEngine] = {}


@dataclass
class AsrSegment:
    time_start: str  # "HH:MM:SS.ss"
    time_end: str    # "HH:MM:SS.ss"
    text: str


class AsrEngine(ABC):
    name: str

    @abstractmethod
    def transcribe(self, audio_path: str | Path, on_progress=None, **kwargs) -> list[AsrSegment]:
        ...

    def preload(self, **kwargs):
        pass

    def unload(self):
        pass


def register_engine(cls: type[AsrEngine]) -> type[AsrEngine]:
    _ENGINES[cls.name] = cls
    return cls


def get_engine(name: str) -> AsrEngine | None:
    if name in _INSTANCES:
        return _INSTANCES[name]
    cls = _ENGINES.get(name)
    if cls is None:
        return None
    inst = cls()
    _INSTANCES[name] = inst
    return inst


def available_engines() -> list[str]:
    return list(_ENGINES.keys())


def preload_all(asr_engine_name: str, asr_model_name: str | None = None):
    """Preload the configured ASR engine model in a background thread."""
    engine = get_engine(asr_engine_name)
    if engine:
        logger.info("后台预加载 ASR 模型: {} ({})", asr_engine_name, asr_model_name)
        threading.Thread(target=engine.preload, kwargs={"model_name": asr_model_name}, daemon=True).start()


def reload_engine(asr_engine_name: str, asr_model_name: str | None = None):
    """Unload old model and preload new one in background."""
    # Unload current engine instance
    for inst in _INSTANCES.values():
        inst.unload()
    engine = get_engine(asr_engine_name)
    if engine:
        threading.Thread(target=engine.preload, kwargs={"model_name": asr_model_name}, daemon=True).start()


def _auto_register():
    try:
        from .engines import whisper  # noqa: F401
    except ImportError:
        pass


_auto_register()
