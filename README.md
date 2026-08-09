# E-Reader V1

Phase 0 of a quiet, local Windows EPUB/AZW3 reader with persistent offline TTS.

## Verified commands

```powershell
npm install
npm run spike:epub
npm run fixture:azw3-protected
npm run spike:azw3
npm run verify
npm run verify:phase0
npm run test:smoke
npm run benchmark:kokoro
npm run benchmark:index
npm run validate:audio
```

`npm start` builds and opens the generated EPUB fixture in fullscreen reading mode. Use Left/Right to turn pages, `+`/`-` to change font size, click a sentence to select the speech unit, Space to play/pause, Up/Down to change reading speed, and Ctrl+O to choose a local book.

The AZW3 spike expects the documented Project Gutenberg KF8 fixture at the version root's `data-input/pg11-images-kf8.azw3`; see `docs/fixtures.md` for source and hash. The converter is a replaceable dynamic libmobi sidecar built without encryption support.

The TTS runtime lives under `tts/.venv`. It communicates only through stdin/stdout JSON Lines and does not open a port. Runtime model access is offline by default. Kokoro is the production-route default established by the RTX 4060 benchmark; IndexTTS2 remains an explicitly enabled development candidate whose failures transparently fall back to Kokoro. Neither engine is a user-facing choice. See `docs/architecture.md`, `docs/security.md`, `docs/model-licenses.md`, `docs/third-party-components.md`, and `docs/tts-benchmark.md` for the evidence and explicit limitations.

The two `:stability` benchmark scripts each run a real 30-minute synthesis stress loop. They overwrite only a hidden scratch WAV and write the final machine-readable report under the version root's `data-output` directory. A stress pass is not a substitute for the separately required human listening test.

This is a Phase 0 development spike, not the final installer. A desktop shortcut is intentionally deferred until a packaged release executable exists.
