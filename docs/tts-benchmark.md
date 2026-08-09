# Local TTS benchmark

Status: Phase 0 measurement is complete on the target Windows laptop. Both 30-minute synthesis stability runs passed, and every value below comes from completed commands and saved JSON/WAV evidence.

## Outcome first

Kokoro is the Phase 0 production route. It starts locally in seconds, synthesizes the tested sentences in about 0.15 seconds, runs far faster than playback, and leaves most of the 8 GiB GPU free. IndexTTS2 is retained only as an explicitly enabled development candidate: its measured latency is far slower than real time and its roughly 7.3 GiB allocated-VRAM peak leaves no safe queueing margin on this machine. This decision is based on measured latency/stability/resource fit; human narration quality is still a separate open test.

## Hardware and runtime

| Field | Measured value |
|---|---|
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU |
| VRAM | 8188 MiB |
| NVIDIA driver | 596.49 |
| Compute capability | 8.9 |
| OS | Windows NT build 10.0.26200 (64-bit) |
| Python | 3.11.15 project environment |
| PyTorch | 2.8.0+cu128 |
| CUDA runtime | 12.8 |

## Method

- Both engines ran in the same project virtual environment on the same GPU.
- Benchmark execution forces Hugging Face/Transformers offline mode. All timed steady-state runs used already installed local weights and auxiliary models.
- `cold load` measures adapter `load()` through CUDA synchronization in a fresh Python process.
- Warmup is excluded from the sample metrics. Kokoro warms both its Chinese/mixed and English voice paths; IndexTTS2 warms once.
- Each engine directly synthesizes one Chinese, one English, and one mixed-language semantic sentence without using the application audio cache. Latency is synchronized to CUDA; RTF is synthesis seconds divided by output-audio seconds.
- Allocated and reserved CUDA memory are sampled every 20 ms during the three samples and stability loop. Values are process-owned PyTorch memory, not total board allocation from other Windows applications.
- The 30-minute stability test cycles the same three samples as fast as the engine allows and overwrites one hidden scratch WAV. It is a synthesis stress test, not 30 minutes of continuous playback or a human listening test.

## Summary

| Metric | IndexTTS2 | Kokoro v1.1 zh |
|---|---:|---:|
| Model/source version | 2.0.0 / `90ca4d6` | `b1d8410f` weight |
| License | bilibili Model Use License | Apache-2.0 |
| Cold load, local cache | 29.1362 s | 9.5438 s |
| Excluded warmup | 6.1958 s | 1.2216 s |
| Mean warm latency | 89.9327 s | 0.1482 s |
| Mean RTF | 11.7366 | 0.0183 |
| Average allocated VRAM | 6833.8 MiB | 600.0 MiB |
| Average reserved VRAM | 7496.1 MiB | 910.2 MiB |
| Peak allocated VRAM | 7299.1 MiB | 734.1 MiB |
| Peak reserved VRAM | 7504.0 MiB | 912.0 MiB |
| 30-minute synthesis stability | Passed: 1854.3326 s, 21 syntheses, no failure | Passed: 1800.1252 s, 13,689 syntheses, no failure |
| Chinese subjective quality | Pending human listening | Pending human listening |
| English subjective quality | Pending human listening | Pending human listening |
| Mixed-language subjective quality | Pending human listening | Pending human listening |

The preserved acquisition/first-start reports are intentionally not mixed into the steady-state table. Kokoro's first report measured 30.1555 seconds to load and 34.7040 seconds of excluded first-use voice work. IndexTTS2's first report measured 460.4895 seconds to load because required auxiliary artifacts were acquired; its subsequent fully local cold load was about 30 seconds. Normal application runtime forbids model network access.

## Per-sample evidence

| Engine | Sample | Latency | Audio duration | RTF |
|---|---|---:|---:|---:|
| Kokoro | Chinese | 0.1537 s | 7.3500 s | 0.0209 |
| Kokoro | English | 0.1437 s | 8.0250 s | 0.0179 |
| Kokoro | Mixed | 0.1472 s | 9.1750 s | 0.0160 |
| IndexTTS2 | Chinese | 82.4045 s | 7.0008 s | 11.7704 |
| IndexTTS2 | English | 90.5088 s | 7.7671 s | 11.6530 |
| IndexTTS2 | Mixed | 96.8849 s | 8.2199 s | 11.7865 |

The mixed input was passed as one semantic sentence rather than being mechanically split around English tokens:

> 我们使用 Transformer architecture 处理 2026 年的 AI 阅读任务，并验证 37% 这样的数字。

## Actual audio validation

Six WAVs exist under the version root's `data-output/audio` directory. `npm run validate:audio` independently reopened every file and produced `tts-audio-manifest.json` with SHA-256, duration, peak, RMS, and format metadata. Validation passed:

- Kokoro: mono PCM s16le, 24 kHz, durations 7.350 / 8.025 / 9.175 seconds.
- IndexTTS2: mono PCM s16le, 22.05 kHz, durations 7.001 / 7.767 / 8.220 seconds.
- All six contain non-zero samples and zero clipped samples.

This verifies real, decodable audio output. It does not establish naturalness, pronunciation, narrator consistency, or listener fatigue. Those fields remain explicitly pending until a person listens to long Chinese, English, and mixed material. In particular, Kokoro currently uses `zf_001` for Chinese/mixed and `bf_vale` for full English, so cross-language narrator identity is not yet proven.

## Route decision

1. Default application engine: Kokoro, selected internally with no model/CUDA/voice setting in the UI.
2. IndexTTS2: development-only explicit opt-in. Any load or synthesis failure falls back to Kokoro and the renderer receives no engine identity.
3. IndexTTS2 is not bundled by default at this stage because both its target-hardware performance and custom redistribution terms are materially less suitable. See `model-licenses.md`.
4. Phase 3 still needs adaptive prefetch, LRU cache eviction, continuity/silence/loudness handling, persisted speed, and long-form listening validation. A fast isolated sentence benchmark is necessary but not sufficient for gapless audiobook playback.

## Reproduction and artifacts

```powershell
npm run benchmark:kokoro
npm run benchmark:index
npm run benchmark:kokoro:stability
npm run benchmark:index:stability
npm run validate:audio
```

Machine-readable evidence is kept outside the Git repository under the version root:

- `data-output/tts-kokoro.json`
- `data-output/tts-kokoro-first-run.json`
- `data-output/tts-indextts2.json`
- `data-output/tts-indextts2-first-run.json`
- `data-output/tts-audio-manifest.json`
- `data-output/audio/*.wav`

The benchmark reference narrator and all model/component hashes are recorded in `model-licenses.md` and `third-party-components.md`.
