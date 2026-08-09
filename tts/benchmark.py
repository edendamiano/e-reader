from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

TTS_ROOT = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(TTS_ROOT.parent / "models" / "huggingface"))
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
sys.path.insert(0, str(TTS_ROOT))

from engines.indextts2 import IndexTTS2Engine
from engines.kokoro import KokoroEngine


SAMPLES = {
    "zh": "这是一次本地中文朗读测试。声音应该自然、平稳，并且适合长时间收听。",
    "en": "This is a local English narration test. The voice should remain calm, clear, and comfortable over a long listening session.",
    "mixed": "我们使用 Transformer architecture 处理 2026 年的 AI 阅读任务，并验证 37% 这样的数字。",
}


class CudaMemorySampler:
    """Sample process-owned CUDA memory while synthesis is running."""

    def __init__(self, torch_module, interval_seconds: float = 0.02) -> None:
        self._torch = torch_module
        self._interval_seconds = interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.allocated_mb: list[float] = []
        self.reserved_mb: list[float] = []

    def _sample(self) -> None:
        while not self._stop.is_set():
            self.allocated_mb.append(self._torch.cuda.memory_allocated() / (1024 * 1024))
            self.reserved_mb.append(self._torch.cuda.memory_reserved() / (1024 * 1024))
            self._stop.wait(self._interval_seconds)

    def start(self) -> None:
        self._thread = threading.Thread(target=self._sample, name="cuda-memory-sampler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)


def nvidia_info() -> dict[str, str]:
    try:
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
            text=True,
            encoding="utf-8",
        ).strip()
        name, memory, driver = [item.strip() for item in output.split(",", 2)]
        return {"gpu": name, "vram": memory, "driver": driver}
    except Exception as error:
        return {"gpu": "unavailable", "vram": "unavailable", "driver": f"unavailable: {error}"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["kokoro", "indextts2"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--audio-dir", type=Path, required=True)
    parser.add_argument("--stability-minutes", type=float, default=0.0)
    args = parser.parse_args()

    engine = KokoroEngine() if args.engine == "kokoro" else IndexTTS2Engine()
    args.audio_dir.mkdir(parents=True, exist_ok=True)
    try:
        import torch
        torch_version = torch.__version__
        cuda_version = torch.version.cuda
        cuda_available = torch.cuda.is_available()
        if cuda_available:
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()
    except ImportError:
        torch = None
        torch_version = "not installed"
        cuda_version = None
        cuda_available = False

    cold_start = time.perf_counter()
    engine.load()
    if cuda_available:
        torch.cuda.synchronize()
    cold_load_seconds = time.perf_counter() - cold_start

    # Kokoro uses separate Chinese and English voices. Warm both voices so the
    # measured samples exclude first-use voice downloads and lazy initialization.
    warmup_cases = [("mixed", "准备朗读。Warm-up narration.")]
    if args.engine == "kokoro":
        warmup_cases.append(("en", "Preparing local narration."))
    warmup_seconds = 0.0
    for index, (language, warmup_text) in enumerate(warmup_cases, start=1):
        warmup_target = args.audio_dir / f".{args.engine}-warmup-{index}.wav"
        warmup_start = time.perf_counter()
        engine.synthesize(warmup_text, 1.0, {"language": language}, warmup_target)
        if cuda_available:
            torch.cuda.synchronize()
        warmup_seconds += time.perf_counter() - warmup_start
        warmup_target.unlink(missing_ok=True)
    if cuda_available:
        torch.cuda.reset_peak_memory_stats()

    results = []
    memory_sampler = CudaMemorySampler(torch) if cuda_available else None
    if memory_sampler:
        memory_sampler.start()
    for name, text in SAMPLES.items():
        target = args.audio_dir / f"{args.engine}-{name}.wav"
        if cuda_available:
            torch.cuda.synchronize()
        start = time.perf_counter()
        result = engine.synthesize(text, 1.0, {"language": name}, target)
        if cuda_available:
            torch.cuda.synchronize()
        latency = time.perf_counter() - start
        duration = result.duration_ms / 1000
        results.append({
            "sample": name,
            "text": text,
            "latency_seconds": round(latency, 4),
            "audio_seconds": round(duration, 4),
            "rtf": round(latency / duration, 4) if duration else None,
            "audio_path": str(target.resolve()),
        })

    stability = {
        "status": "not run",
        "requested_minutes": args.stability_minutes,
        "elapsed_seconds": 0.0,
        "synthesis_count": 0,
        "generated_audio_seconds": 0.0,
        "failure": None,
        "scope": "synthesis stress loop; not a subjective listening test",
    }
    if args.stability_minutes > 0:
        stability_target = args.audio_dir / f".{args.engine}-stability.wav"
        stability_start = time.perf_counter()
        deadline = stability_start + args.stability_minutes * 60
        next_progress = stability_start + 60
        sample_items = list(SAMPLES.items())
        while time.perf_counter() < deadline:
            sample_name, sample_text = sample_items[stability["synthesis_count"] % len(sample_items)]
            try:
                engine_result = engine.synthesize(sample_text, 1.0, {"language": sample_name}, stability_target)
                if cuda_available:
                    torch.cuda.synchronize()
                stability["synthesis_count"] += 1
                stability["generated_audio_seconds"] += engine_result.duration_ms / 1000
                now = time.perf_counter()
                if now >= next_progress:
                    print(json.dumps({
                        "type": "stability-progress",
                        "engine": args.engine,
                        "elapsed_seconds": round(now - stability_start, 1),
                        "synthesis_count": stability["synthesis_count"],
                        "generated_audio_seconds": round(stability["generated_audio_seconds"], 1),
                    }, ensure_ascii=False), file=sys.stderr, flush=True)
                    while next_progress <= now:
                        next_progress += 60
            except Exception as error:
                stability["failure"] = f"{type(error).__name__}: {error}"
                break
        stability["elapsed_seconds"] = round(time.perf_counter() - stability_start, 4)
        stability["generated_audio_seconds"] = round(stability["generated_audio_seconds"], 4)
        stability["status"] = "passed" if stability["failure"] is None and time.perf_counter() >= deadline else "failed"
        stability_target.unlink(missing_ok=True)
    if memory_sampler:
        memory_sampler.stop()

    peak_vram_mb = None
    peak_reserved_vram_mb = None
    average_vram_mb = None
    average_reserved_vram_mb = None
    if cuda_available:
        peak_vram_mb = round(torch.cuda.max_memory_allocated() / (1024 * 1024), 1)
        peak_reserved_vram_mb = round(torch.cuda.max_memory_reserved() / (1024 * 1024), 1)
        if memory_sampler and memory_sampler.allocated_mb:
            average_vram_mb = round(statistics.mean(memory_sampler.allocated_mb), 1)
            average_reserved_vram_mb = round(statistics.mean(memory_sampler.reserved_mb), 1)
    report = {
        **nvidia_info(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "pytorch": torch_version,
        "cuda_runtime": cuda_version,
        "cuda_available": cuda_available,
        "engine": args.engine,
        "model_version": engine.model_version,
        "voice_version": engine.voice_version,
        "cold_load_seconds": round(cold_load_seconds, 4),
        "excluded_warmup_seconds": round(warmup_seconds, 4),
        "mean_warm_latency_seconds": round(statistics.mean(item["latency_seconds"] for item in results), 4),
        "mean_rtf": round(statistics.mean(item["rtf"] for item in results if item["rtf"] is not None), 4),
        "peak_vram_mb": peak_vram_mb,
        "peak_reserved_vram_mb": peak_reserved_vram_mb,
        "average_vram_mb": average_vram_mb,
        "average_reserved_vram_mb": average_reserved_vram_mb,
        "samples": results,
        "stability": stability,
        "thirty_minute_stability": stability["status"] if args.stability_minutes >= 30 else "not run",
        "subjective_quality": {"zh": "pending listening", "en": "pending listening", "mixed": "pending listening"},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
