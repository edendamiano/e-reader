from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import wave
from array import array
from datetime import datetime, timezone
from pathlib import Path


EXPECTED_SAMPLE_RATES = {
    "kokoro": 24_000,
    "indextts2": 22_050,
}
SAMPLE_NAMES = ("zh", "en", "mixed")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_wav(path: Path, engine: str) -> dict[str, object]:
    with wave.open(str(path), "rb") as audio:
        channels = audio.getnchannels()
        sample_width = audio.getsampwidth()
        sample_rate = audio.getframerate()
        frame_count = audio.getnframes()
        compression = audio.getcomptype()
        frames = audio.readframes(frame_count)

    expected_rate = EXPECTED_SAMPLE_RATES[engine]
    if channels != 1 or sample_width != 2 or sample_rate != expected_rate or compression != "NONE" or frame_count <= 0:
        raise RuntimeError(
            f"Unexpected WAV format for {path.name}: channels={channels}, width={sample_width}, "
            f"rate={sample_rate}, compression={compression}, frames={frame_count}"
        )

    samples = array("h")
    samples.frombytes(frames)
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples or not any(samples):
        raise RuntimeError(f"WAV contains no non-zero audio samples: {path}")
    peak = max(abs(value) for value in samples) / 32768
    rms = math.sqrt(sum(value * value for value in samples) / len(samples)) / 32768
    return {
        "path": str(path.resolve()),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "codec": "pcm_s16le",
        "channels": channels,
        "sample_rate_hz": sample_rate,
        "frames": frame_count,
        "duration_seconds": round(frame_count / sample_rate, 6),
        "peak_dbfs": round(20 * math.log10(max(peak, 1e-12)), 3),
        "rms_dbfs": round(20 * math.log10(max(rms, 1e-12)), 3),
        "clipped_samples": sum(1 for value in samples if abs(value) >= 32767),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    records = []
    for engine in EXPECTED_SAMPLE_RATES:
        for sample in SAMPLE_NAMES:
            path = args.audio_dir / f"{engine}-{sample}.wav"
            if not path.is_file():
                raise FileNotFoundError(path)
            records.append({"engine": engine, "sample": sample, **inspect_wav(path, engine)})

    report = {
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed",
        "files": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
