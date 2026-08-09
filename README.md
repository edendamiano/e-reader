# E-Reader V1

A quiet, local-first Windows EPUB/AZW3 reader. Phase 1 (Library) and Phase 2 (paginated Reader) are implemented on top of the verified Phase 0 TTS pipeline.

## Daily use

- Start with `npm start` during development.
- Drag one or more `.epub` / `.azw3` files onto the bookshelf, or press `Ctrl+O` and choose multiple files.
- Double-click a cover to read. Imported books are copied into `%LOCALAPPDATA%\EReader\library`; deleting or moving the original does not affect reading.
- Left/Right or the outer 23% page edges turn pages. `T` opens the temporary table of contents. `Esc` closes the TOC or returns to the bookshelf.
- `+`/`-` repaginates around the current sentence. Space plays/pauses local TTS; Up/Down adjusts its speed.
- Settings are available only from the bookshelf. The reading surface has no persistent toolbar.

Only no-DRM KF8/AZW3 is supported. Protected books are rejected with `此文件受保护，无法读取。`; no decryption path is present.

## Verification

```powershell
npm install
npm run verify:phase12
```

The full command performs type checking, TypeScript/Python tests, production build, EPUB/AZW3 checks, Electron E2E, real-book validation, audio validation, and the production dependency audit. Real public-domain fixtures and hashes are documented in `docs/fixtures.md`.

Kokoro remains the internal default TTS engine. IndexTTS2 is frozen as an explicit developer/research candidate and cannot block Reader startup or normal reading. Engine, model, voice, CUDA, and cache choices are not exposed in the product UI.

This is still a development build rather than a packaged installer. Do not create a desktop shortcut until a signed/packageable `.exe` exists.
