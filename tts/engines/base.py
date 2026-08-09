from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AudioResult:
    path: Path
    duration_ms: int
    engine: str
    cache_hit: bool = False


class TTSEngine(ABC):
    name = "unknown"
    model_version = "unknown"
    voice_version = "unknown"
    prosody_profile_version = "calm-neutral-v1"

    @abstractmethod
    def load(self) -> None:
        raise NotImplementedError
    @abstractmethod
    def synthesize(self, text: str, speed: float, context: dict[str, Any], output_path: Path) -> AudioResult:
        raise NotImplementedError

    @abstractmethod
    def health(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def unload(self) -> None:
        raise NotImplementedError
