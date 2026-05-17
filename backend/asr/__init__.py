"""ASR plugin system — pluggable speech recognition engines."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

_ENGINES: dict[str, type[AsrEngine]] = {}
_INSTANCES: dict[str, AsrEngine] = {}


@dataclass
class AsrSegment:
    time_start: str  # "MM:SS.ss"
    time_end: str    # "MM:SS.ss"
    text: str


class AsrEngine(ABC):
    name: str

    @abstractmethod
    def transcribe(self, audio_path: str | Path) -> list[AsrSegment]:
        ...


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


def _auto_register():
    try:
        from .engines import whisper  # noqa: F401
    except ImportError:
        pass


_auto_register()
