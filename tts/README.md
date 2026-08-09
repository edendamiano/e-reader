# Local TTS sidecar

The Windows application starts `tts/.venv/Scripts/python.exe -I -X utf8 -u tts/service/main.py` once and exchanges newline-delimited JSON over stdin/stdout. Python isolated mode ignores user-site and `PYTHON*` path/config injection. The sidecar does not expose HTTP, bind a port, or let the renderer select a model or voice.

## Verified Phase 0 environment

- CPython 3.11.15
- PyTorch 2.8.0+cu128 and torchaudio 2.8.0+cu128
- Kokoro 0.9.4 and Misaki 0.9.4
- IndexTTS2 2.0.0 source commit `90ca4d608209584bad3a5bd5becc0b80c146e60f`
- setuptools 80.9.0, pinned because the installed ModelScope release still imports `pkg_resources`

`requirements.runtime.txt` records direct pins. Install the official CUDA 12.8 PyTorch wheels first, clone the pinned IndexTTS2 source into `tts/vendor/index-tts`, and then install the requirement file from the repository root. This is a development reproduction path, not the final bundled model installer.

Expected local-only layout:

```text
models/
  huggingface/                 Kokoro Hugging Face cache
  IndexTTS-2/                  IndexTTS2 checkpoints and auxiliary cache
  narrator/
    reference-zf001-v1.wav     project-generated benchmark reference
tts/
  vendor/index-tts/            pinned official source checkout
  .venv/                       CPython 3.11 environment
```

The application sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` in normal use. Development-only model acquisition must be explicitly enabled with `EREADER_ALLOW_MODEL_DOWNLOAD=1`. The benchmark runner is always offline and fails if required local artifacts are missing.

## Internal engine route

- Default: Kokoro. This is the measured production route on the 8 GiB RTX 4060 target.
- `EREADER_TTS_ENGINE=indextts2`: development evaluation only; failures transparently fall back to Kokoro.
- `EREADER_TTS_ENGINE=auto`: tries Kokoro first and considers a configured IndexTTS2 only if Kokoro cannot load.

These values are intentionally absent from the user settings UI.

## Evidence commands

```powershell
npm run benchmark:kokoro
npm run benchmark:index
npm run benchmark:kokoro:stability
npm run benchmark:index:stability
npm run validate:audio
npm run test:python
```

Benchmark JSON and validated WAV metadata are written under the version root's `data-output` directory. The six generated WAV files are evidence samples, not a human listening verdict. See `docs/tts-benchmark.md` and `docs/model-licenses.md`.
