# Phase 0 status

Status: complete as a technical spike on 2026-08-09. This is not the packaged V1 application.

## Implemented

- Electron/TypeScript/React repository and documented security/process architecture.
- Shared EPUB/AZW3 publication path with SHA-256 identity, metadata, spine and TOC parsing, strict ZIP preflight, markup sanitization, CSP/network blocking, and a scriptless paginated iframe.
- Locator-based reading-state restore across pagination and font-size changes, atomic state replacement, and quarantine/recovery for malformed or mismatched state.
- Keyboard/page-edge navigation, sentence selection and highlighting, progress, click/Space playback, auto-advance, and page following.
- libmobi v0.12 AZW3 sidecar built with encryption support disabled, KF8/header/DRM preflight, bounded child-process execution, temporary normalization, and the required protected-book rejection.
- Persistent isolated Python JSON Lines sidecar, `TTSEngine` abstraction, offline-by-default model access, normalization/language routing, versioned WAV cache, restart policy, and path containment checks.
- Kokoro as the measured interactive default; IndexTTS2 as an explicitly enabled development candidate with automatic fallback to Kokoro. Model, CUDA, voice, engine identity, and local paths are not exposed to the renderer.
- Pinned component/model versions, hashes, narrator provenance, licenses, reproduction commands, and machine-readable benchmark/audio evidence.

## Verified

- `npm run verify:phase0` passes from a clean production rebuild.
- TypeScript: 4 files and 16 tests passed, covering locators, speech units, hostile publication preflight, engine routing, and state recovery/overwrite behavior.
- Python: 6 tests passed, covering normalization, mixed-language handling, language detection, cache invalidation, default routing, and IndexTTS2 fallback.
- Electron: 3 end-to-end tests passed for real EPUB pagination/state, real no-DRM KF8 normalization/rendering, and persistent TTS cache/playback/highlight/auto-next behavior.
- Real public-domain KF8: version 8/encryption type 0, 19 reading-order resources and 16 TOC entries; a protected-header fixture is rejected.
- Six generated Chinese, English, and mixed-language WAVs reopen as valid mono PCM with non-zero samples and zero clipped samples.
- Kokoro 30-minute synthesis stress test passed for 1800.1252 seconds and 13,689 syntheses; mean warm latency 0.1482 seconds, RTF 0.0183, peak allocated VRAM 734.1 MiB.
- IndexTTS2 30-minute synthesis stress test passed for 1854.3326 seconds and 21 syntheses; mean warm latency 89.9327 seconds, RTF 11.7366, peak allocated VRAM 7299.1 MiB.

## Known limitations and release gates

- Phase 0 is an architecture/technical spike, not the complete V1. There is no packaged executable, installer, or desktop shortcut yet.
- The Library layer is not implemented: SQLite/migrations, import-copy, duplicate handling, bookshelf, search, delete, and recent-book flows belong to Phase 1.
- AZW3 normalization is temporary and deleted after the first readable resource is extracted. Later full-spine navigation needs a persisted normalized publication owned by the Library.
- The renderer currently opens one readable spine item. It has no full TOC overlay or spine transitions, and intentionally strips publisher CSS and images.
- The scriptless custom paginator remains in place because the evaluated stock desktop navigator disables its webview sandbox. Production navigator integration remains gated by hostile-publication regression evidence.
- TTS still lacks adaptive prefetch, LRU eviction, continuity/silence/loudness processing, persisted speed, independent view/playback progression, and background/lock-screen acceptance work.
- The automated 30-minute synthesis stress tests passed, but no human 30-minute Chinese/English listening session has been completed. Naturalness, pronunciation, fatigue, and cross-language narrator identity remain pending.
- `npm audit --omit=dev` still reports 9 production advisories in Readium's legacy transitive graph. Hostile ZIP/LCP/image paths have explicit preflight/runtime mitigations, but dependency replacement or upstream remediation remains a release gate.
- Installer notices and redistribution review are not complete. IndexTTS2's custom license requires an explicit final include/omit decision.

## Next phase

1. Implement SQLite schema/migrations and a durable Library service.
2. Copy imports into app-owned storage, deduplicate by source SHA-256, persist normalized AZW3 publications, and add search/delete/recent-book flows.
3. Extend the reader across the full spine with TOC navigation and a secure image protocol while preserving the hostile-book security boundary.
4. Build adaptive TTS prefetch/cache/continuity behavior and conduct long-form human listening acceptance before packaging.
