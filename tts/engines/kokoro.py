from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .base import AudioResult, TTSEngine
from normalize import detect_language


class KokoroEngine(TTSEngine):
    name = "kokoro"
    model_version = "hexgrad/Kokoro-82M-v1.1-zh@b1d8410f"
    voice_version = "zf_001+bf_vale-v1"

    def __init__(self) -> None:
        self._loaded = False
        self._device = "unloaded"
        self._model: Any = None
        self._zh_pipeline: Any = None
        self._en_pipeline: Any = None

    def load(self) -> None:
        if self._loaded:
            return
        import torch
        from kokoro import KModel, KPipeline

        repo_id = "hexgrad/Kokoro-82M-v1.1-zh"
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model = KModel(repo_id=repo_id).to(self._device).eval()
        en_phonemizer = KPipeline(lang_code="a", repo_id=repo_id, model=False)

        def en_callable(text: str) -> str:
            generated = next(en_phonemizer(text))
            return generated.phonemes

        self._en_pipeline = KPipeline(lang_code="b", repo_id=repo_id, model=self._model)
        self._zh_pipeline = KPipeline(lang_code="z", repo_id=repo_id, model=self._model, en_callable=en_callable)
        self._loaded = True

    def synthesize(self, text: str, speed: float, context: dict[str, Any], output_path: Path) -> AudioResult:
        self.load()
        import numpy as np
        import soundfile as sf

        language = str(context.get("language") or detect_language(text))
        if language in {"zh", "mixed"}:
            pipeline = self._zh_pipeline
            voice = "zf_001"
        else:
            pipeline = self._en_pipeline
            voice = "bf_vale"
        chunks = [result.audio.detach().cpu().numpy() if hasattr(result.audio, "detach") else np.asarray(result.audio) for result in pipeline(text, voice=voice, speed=speed)]
        if not chunks:
            raise RuntimeError("Kokoro produced no audio.")
        audio = np.concatenate(chunks)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output_path, audio, 24_000)
        duration_ms = round(len(audio) / 24_000 * 1000)
        return AudioResult(output_path, duration_ms, self.name)

    def health(self) -> dict[str, Any]:
        return {"ready": self._loaded, "engine": self.name, "device": self._device, "model": self.model_version}

    def unload(self) -> None:
        self._model = None
        self._zh_pipeline = None
        self._en_pipeline = None
        self._loaded = False
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
