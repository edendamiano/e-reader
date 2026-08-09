from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from .base import AudioResult, TTSEngine


class IndexTTS2Engine(TTSEngine):
    name = "indextts2"
    model_version = "IndexTTS2-2.0.0"
    voice_version = "kokoro-zf001-reference-v1"

    def __init__(self) -> None:
        self._loaded = False
        self._tts: Any = None
        project_root = Path(__file__).resolve().parents[2]
        self._root = Path(os.environ.get("INDEXTTS_ROOT", project_root / "tts" / "vendor" / "index-tts"))
        self._model_dir = Path(os.environ.get("INDEXTTS_MODEL_DIR", project_root / "models" / "IndexTTS-2"))
        self._voice = Path(
            os.environ.get(
                "EREADER_NARRATOR_SAMPLE",
                project_root / "models" / "narrator" / "reference-zf001-v1.wav",
            )
        )

    def configured(self) -> bool:
        return self._root.is_dir() and self._model_dir.is_dir() and self._voice.is_file()

    def load(self) -> None:
        if self._loaded:
            return
        if not self.configured():
            raise RuntimeError("IndexTTS2 paths or licensed narrator sample are not configured.")
        sys.path.insert(0, str(self._root))
        from indextts.infer_v2 import IndexTTS2

        self._tts = IndexTTS2(
            cfg_path=str(self._model_dir / "config.yaml"),
            model_dir=str(self._model_dir),
            use_fp16=True,
            use_cuda_kernel=False,
            use_deepspeed=False,
        )
        self._loaded = True

    def synthesize(self, text: str, speed: float, context: dict[str, Any], output_path: Path) -> AudioResult:
        self.load()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._tts.infer(
            spk_audio_prompt=str(self._voice),
            text=text,
            output_path=str(output_path),
            emo_vector=[0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.0, 0.3],
            use_random=False,
            verbose=False,
        )
        import soundfile as sf

        audio, sample_rate = sf.read(output_path)
        duration_ms = round(len(audio) / sample_rate * 1000)
        return AudioResult(output_path, duration_ms, self.name)

    def health(self) -> dict[str, Any]:
        return {
            "ready": self._loaded,
            "configured": self.configured(),
            "engine": self.name,
            "device": "cuda" if self._loaded else "unloaded",
            "model": self.model_version,
        }

    def unload(self) -> None:
        self._tts = None
        self._loaded = False
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
