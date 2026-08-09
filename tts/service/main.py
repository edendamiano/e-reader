from __future__ import annotations

import contextlib
import hashlib
import json
import os
import sys
import traceback
import wave
from pathlib import Path
from typing import Any

TTS_ROOT = Path(__file__).resolve().parents[1]
if str(TTS_ROOT) not in sys.path:
    sys.path.insert(0, str(TTS_ROOT))

from engines.base import AudioResult, TTSEngine
from engines.indextts2 import IndexTTS2Engine
from engines.kokoro import KokoroEngine
from normalize import TextNormalizer, detect_language


class EngineRouter:
    def __init__(self, cache_root: Path) -> None:
        self.cache_root = cache_root
        self.normalizer = TextNormalizer()
        self.index = IndexTTS2Engine()
        self.kokoro = KokoroEngine()
        self.engine: TTSEngine | None = None
        self.last_error = ""

    def warmup(self) -> None:
        preference = os.environ.get("EREADER_TTS_ENGINE", "kokoro").strip().lower()
        if preference == "indextts2":
            candidates: list[TTSEngine] = [self.index, self.kokoro]
        elif preference == "auto":
            candidates = [self.kokoro, self.index] if self.index.configured() else [self.kokoro]
        else:
            candidates = [self.kokoro]
        for candidate in candidates:
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    candidate.load()
                self.engine = candidate
                self.last_error = ""
                return
            except Exception as error:
                self.last_error = f"{candidate.name}: {error}"
                traceback.print_exc(file=sys.stderr)
        self.engine = None

    def health(self) -> dict[str, Any]:
        if not self.engine:
            return {"ready": False, "detail": self.last_error or "No local TTS engine is available."}
        return self.engine.health() | {"ready": True}

    def _cache_path(self, engine: TTSEngine, text: str, speed: float, context: dict[str, Any] | None = None) -> Path:
        payload = {
            "model": engine.model_version,
            "voice": engine.voice_version,
            "text": text,
            "speed": round(speed, 3),
            "prosody": engine.prosody_profile_version,
        }
        digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        candidate = str((context or {}).get("bookId", ""))
        book_id = candidate.lower() if len(candidate) == 64 and all(character in "0123456789abcdefABCDEF" for character in candidate) else "_shared"
        return self.cache_root / engine.name / book_id / f"{digest}.wav"

    @staticmethod
    def _duration(path: Path) -> int:
        with wave.open(str(path), "rb") as wav:
            return round(wav.getnframes() / wav.getframerate() * 1000)

    def synthesize(self, text: str, speed: float, context: dict[str, Any]) -> AudioResult:
        if not self.engine:
            self.warmup()
        if not self.engine:
            raise RuntimeError(self.last_error or "No local TTS engine is available.")
        normalized = self.normalizer.normalize(text)
        context = dict(context)
        context["language"] = context.get("language") or detect_language(normalized)
        output = self._cache_path(self.engine, normalized, speed, context)
        if output.is_file():
            return AudioResult(output, self._duration(output), self.engine.name, cache_hit=True)
        temp = output.with_suffix(f".{os.getpid()}.tmp.wav")
        try:
            result = self.engine.synthesize(normalized, speed, context, temp)
            output.parent.mkdir(parents=True, exist_ok=True)
            temp.replace(output)
            return AudioResult(output, result.duration_ms, result.engine, cache_hit=False)
        except Exception:
            temp.unlink(missing_ok=True)
            if self.engine is self.index:
                self.index.unload()
                with contextlib.redirect_stdout(sys.stderr):
                    self.kokoro.load()
                self.engine = self.kokoro
                return self.synthesize(normalized, speed, context)
            raise

    def unload(self) -> None:
        if self.engine:
            self.engine.unload()


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> None:
    cache_root = Path(os.environ.get("EREADER_TTS_CACHE", TTS_ROOT / "tts-cache")).resolve()
    router = EngineRouter(cache_root)
    router.warmup()
    for raw in sys.stdin:
        request_id = ""
        try:
            request = json.loads(raw)
            request_id = str(request.get("requestId", ""))
            kind = request.get("type")
            if kind == "health":
                send({"type": "health", "requestId": request_id, **router.health()})
            elif kind == "synthesize":
                result = router.synthesize(
                    str(request.get("text", "")),
                    float(request.get("speed", 1.0)),
                    request.get("context") if isinstance(request.get("context"), dict) else {},
                )
                send({
                    "type": "synthesized",
                    "requestId": request_id,
                    "audioPath": str(result.path),
                    "durationMs": result.duration_ms,
                    "engine": result.engine,
                    "cacheHit": result.cache_hit,
                })
            elif kind == "shutdown":
                router.unload()
                send({"type": "shutdown", "requestId": request_id})
                return
            else:
                raise ValueError("Unknown request type.")
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            send({"type": "error", "requestId": request_id, "message": str(error)})


if __name__ == "__main__":
    main()
