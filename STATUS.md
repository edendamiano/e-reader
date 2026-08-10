# Phase 3 status

Status: implemented and verified from source on Windows on 2026-08-10. This phase intentionally does not create an installer or update the desktop shortcut.

## Implemented

### Phase 1 — Library

- Versioned SQLite schema with `books`, `reading_state`, and `settings`; WAL, foreign keys, transactional migrations, rollback tests, and safe reopen/recovery.
- App-owned `%LOCALAPPDATA%\EReader` storage with staged import, SHA-256 duplicate detection, atomic promotion, startup orphan cleanup, and source-file independence.
- Multi-file dialog and drag/drop import for EPUB and no-DRM KF8/AZW3. AZW3 is normalized once to a persistent EPUB publication; protected books are rejected without a decryption path.
- Quiet cover-grid bookshelf, generated fallback covers, recent/title sort, title search, progress display, book details, and confirmation-based delete.
- Last-book and last-location resume after normal exit and forced process termination.

### Phase 2 — Reader

- Full-spine pagination with chapter-boundary turns, keyboard and blank page-edge navigation, a temporary hierarchical TOC, and current-chapter highlighting.
- Canonical locator persistence with before/highlight/after context; delayed automatic saves; resize, margin, line-height, and font changes preserve the nearby sentence.
- E-Ink-inspired day/night themes, Lora plus Noto Serif SC reading typography, font size, line height, margin, and progress visibility. Settings are reachable from the bookshelf; the reading surface has no persistent toolbar.
- Text selection and copy, local raster images, publisher-script/CSS stripping, lazy image loading, bounded per-spine DOM, and local-only request/navigation policy.
- Reading-aloud was removed end to end: UI, shortcuts, bridge, IPC, sidecar, Python dependencies, models, caches, tests, build resources, and speech-specific state.
- The E-Ink layer uses soft neutral paper/ink tokens and grayscale image treatment without blur, shadow, ghosting, paper-noise textures, canvas, or shaders.

## Final verification

Current source verification on 2026-08-10:

- TypeScript type checking passed for main, preload, and renderer.
- Vitest unit and integration tests passed.
- Electron/Playwright smoke, symmetric-margin, and E-Ink visual tests passed.
- Real-publication validation: 4 books passed — 15-spine English EPUB, 3-spine Chinese EPUB, 142-spine EPUB with a three-level TOC, and 19-spine real KF8/AZW3.
- `npm audit --omit=dev --offline`: 0 vulnerabilities from the current npm cache. A live registry retry on 2026-08-10 was unavailable because DNS returned `EAI_AGAIN`; no advisory was suppressed.

## Known limitations

- Development launch only: no installer, code signing, auto-update, final icon, or desktop shortcut.
- Covers currently use a deterministic generated fallback instead of extracting the publisher's embedded cover.
- The Reader intentionally ignores publisher CSS and accepts only bounded local PNG/JPEG/GIF/WebP images; fixed-layout EPUB, vertical writing, SVG artwork, media overlays, and advanced typography are not supported.
- Overall progress is spine-weighted, not character- or byte-weighted. Search currently matches titles only.
- `node:sqlite` emits Node 24's experimental-feature warning, although migration, transaction, reopen, abrupt-restart, and rollback paths are covered.
- Noto Serif SC is distributed as a variable TTF (about 25.1 MB); this avoids another conversion dependency but is larger than an equivalent curated WOFF2 subset.

## Deferred / next

- Broader device/book compatibility soak and additional EPUB typography fixtures.
- Extract and cache publisher covers, expand EPUB compatibility fixtures, and refine progress weighting.
- Packaging phase: signed Windows installer/executable, final licenses/notices, clean-machine validation, icon, and only then the final desktop shortcut.
