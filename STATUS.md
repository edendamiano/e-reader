# Phase 1–2 status

Status: implemented and verified as a Windows development build on 2026-08-10. This is not the packaged V1 application and no desktop shortcut has been created.

## Implemented

### Phase 1 — Library

- Versioned SQLite schema with `books`, `reading_state`, and `settings`; WAL, foreign keys, transactional migrations, rollback tests, and safe reopen/recovery.
- App-owned `%LOCALAPPDATA%\EReader` storage with staged import, SHA-256 duplicate detection, atomic promotion, startup orphan cleanup, and source-file independence.
- Multi-file dialog and drag/drop import for EPUB and no-DRM KF8/AZW3. AZW3 is normalized once to a persistent EPUB publication; protected books are rejected without a decryption path.
- Quiet cover-grid bookshelf, generated fallback covers, recent/title sort, title search, progress display, book details, confirmation-based delete, and per-book TTS-cache cleanup.
- Last-book and last-location resume after normal exit and forced process termination.

### Phase 2 — Reader

- Full-spine pagination with chapter-boundary turns, keyboard and blank page-edge navigation, a temporary hierarchical TOC, and current-chapter highlighting.
- Canonical locator persistence with before/highlight/after context; delayed automatic saves; resize, margin, line-height, and font changes preserve the nearby sentence.
- Day/night themes, font family/size, line height, margin, progress visibility, and speech-rate settings. Settings are reachable from the bookshelf; the reading surface has no persistent toolbar.
- Text selection and copy, local raster images, publisher-script/CSS stripping, lazy image loading, bounded per-spine DOM, and local-only request/navigation policy.
- Existing offline TTS integrated across spine transitions with sentence selection, highlight, cache reuse, speed control, and automatic advance.

## Final verification

`npm run verify:phase12` passed on 2026-08-10:

- TypeScript type checking passed for main, preload, and renderer.
- Vitest: 8 files, 31 tests passed.
- Python unittest: 6 tests passed.
- Electron/Playwright: 4 end-to-end tests passed, including EPUB, real KF8, daily Library/full-spine Reader/restart recovery, security blocking, and persistent TTS.
- Real-publication validation: 4 books passed — 15-spine English EPUB, 3-spine Chinese EPUB, 142-spine EPUB with a three-level TOC, and 19-spine real KF8/AZW3.
- Six Chinese, English, and mixed-language WAV samples reopen as valid mono PCM with non-zero samples and zero clipped samples.
- `npm audit --omit=dev`: 0 vulnerabilities. The initial 9 production advisories were removed by replacing the narrow legacy Readium metadata adapter; none were suppressed.

## Known limitations

- Development launch only: no installer, code signing, auto-update, final icon, or desktop shortcut.
- Covers currently use a deterministic generated fallback instead of extracting the publisher's embedded cover.
- The Reader intentionally ignores publisher CSS and accepts only bounded local PNG/JPEG/GIF/WebP images; fixed-layout EPUB, vertical writing, SVG artwork, media overlays, and advanced typography are not supported.
- Overall progress is spine-weighted, not character- or byte-weighted. Search currently matches titles only.
- `node:sqlite` emits Node 24's experimental-feature warning, although migration, transaction, reopen, abrupt-restart, and rollback paths are covered.
- Human listening review and broader device/book compatibility soak remain release work; automated TTS and real-book checks pass.

## Deferred / next

- Phase 3 TTS polish: listening QA, adaptive prefetch, failure UX, and long-session resource checks in the integrated Reader.
- Extract and cache publisher covers, expand EPUB compatibility fixtures, and refine progress weighting.
- Packaging phase: signed Windows installer/executable, final licenses/notices, clean-machine validation, icon, and only then the final desktop shortcut.
