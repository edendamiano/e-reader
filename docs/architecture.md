# E-Reader V1 architecture

Status: Phase 0 spike, 2026-08-09.

## Product boundary

V1 is a local Windows EPUB/AZW3 reader with paginated reading and local TTS. It intentionally excludes PDF, DRM circumvention, cloud sync, notes, highlights, dictionaries, translation, recommendations, statistics, and AI chat features.

## Process boundary

```text
Electron renderer (React, no Node)
  -> narrow contextBridge API
Electron main (file validation, state, process lifecycle)
  -> stdin/stdout JSON Lines
Persistent Python TTS sidecar
  -> IndexTTS2 adapter or Kokoro adapter
```

The renderer never receives a filesystem/process API. The Python model is loaded once, cache files are returned only after the main process verifies that their resolved path remains under the TTS cache root.

## Publication boundary

- `r2-shared-js@1.0.85` is already exercised against a generated EPUB3: metadata, language, reading order, and nested navigation are parsed into a small internal `PublicationDto`.
- The canonical reading position is a Locator containing `href`, progression, a stable speech-unit selector, and a text quote. Visual page numbers are never persisted.
- The Phase 0 renderer uses a deliberately narrow, scriptless CSS-column paginator. It proves pagination, page-edge and keyboard navigation inside the iframe, font-size repagination around the selected sentence, Locator fallback, sentence selection, and page following without accepting the security regression in the stock desktop navigator.
- `r2-navigator-js@1.25.7` remains an evaluated adapter, not the accepted production renderer or a shipped direct dependency. Its current Electron webview setup hard-codes `sandbox=0`. See [ADR 0001](decisions/0001-readium-boundary.md).

## EPUB pipeline

1. Validate extension, regular-file status, packed size, and resource expansion limit.
2. Compute SHA-256; this is the stable book ID and duplicate key.
3. Parse publication metadata, TOC, and spine with Readium.
4. Read only the requested spine resource from the ZIP.
5. Sanitize markup, strip active/external content, and inject a no-script CSP.
6. Segment visible prose into stable `SpeechUnit` spans.
7. Paginate with CSS columns; save Locator on movement with a short debounce and atomic replace.

The current spike opens the first readable spine item (skipping an image-only cover because publication images are intentionally disabled in Phase 0). Phase 2 will add spine transitions, full TOC navigation, images through an allow-listed custom protocol, and ReadiumCSS-equivalent typography.

## AZW3 pipeline

1. Validate the Palm Database signature, first-record bounds, `MOBI` header, KF8 file version, size, and encryption type before starting a child process.
2. Reject any non-zero encryption type with the exact protected-file message. The bundled libmobi build has `USE_ENCRYPTION=OFF` and therefore contains no decryption path.
3. Invoke the fixed `mobitool.exe` path with `execFile`, a fixed argument vector, no shell, a private temporary directory, a 120-second timeout, and bounded output capture.
4. Require exactly one normalized EPUB, then feed it into the same Readium parser used by native EPUB input.
5. Replace the normalized EPUB hash with the original AZW3 SHA-256 so duplicate identity remains tied to the imported source.

The verified public-domain KF8 fixture produced 19 reading-order resources and 16 TOC entries and rendered in the same Electron reader. `mobitool.exe` dynamically loads an adjacent, replaceable `libmobi.dll`; LGPL and zlib notices are retained under `native/azw3`.

## TTS pipeline

`TTSEngine` exposes `load`, `synthesize`, `health`, and `unload`. `EngineRouter` loads Kokoro by default. IndexTTS2 can be selected only by an internal `EREADER_TTS_ENGINE=indextts2` development setting and falls back to Kokoro if loading or synthesis fails. `auto` keeps Kokoro first and considers IndexTTS2 only after a failure. No model, CUDA, or voice choice is exposed in the renderer or product UI.

This ordering is an evidence-based Phase 0 decision. On the target RTX 4060 Laptop GPU, warmed Kokoro averaged 0.1482 seconds per sample at RTF 0.0183 and 734.1 MiB peak allocated VRAM. IndexTTS2 averaged 89.9327 seconds at RTF 11.7366 and 7299.1 MiB peak allocated VRAM. IndexTTS2 therefore cannot feed an interactive sentence queue on this 8 GiB target without unacceptable waits and memory pressure, irrespective of its still-pending subjective quality evaluation.

Kokoro uses the official `hexgrad/Kokoro-82M-v1.1-zh` model and its mixed-language pipeline. IndexTTS2 uses a pinned official checkout plus local checkpoints and a project-generated Kokoro `zf_001` reference sample; no arbitrary or celebrity recording is used. Exact versions, hashes, and redistribution constraints are in `model-licenses.md`.

The persistent Python process is started after the reader window is created. It exchanges JSON Lines over inherited pipes, loads one model once, normalizes text, and writes version-keyed WAV cache entries. The Electron main process verifies every returned path stays below its cache root before returning audio bytes to the renderer. The Phase 0 renderer proves click-to-select, Space play/pause, sentence highlighting, and auto-advance/page-follow. Adaptive prefetch, LRU eviction, pause-position persistence, and long-form continuity processing remain later-phase work.

## State

The Phase 0 state writer uses one atomic JSON file per SHA-256 book ID so crash-like restart can be tested before SQLite lands in Phase 1. Writes use a unique create-only temporary file, file flush, and atomic rename. Loads validate the book ID/href/location shape; malformed state is moved to a recoverable `.corrupt-<timestamp>` sibling, logged, and treated as no saved position rather than preventing the book from opening. SQLite migrations remain the Phase 1 persistence design and will replace this temporary store rather than coexist with it.
