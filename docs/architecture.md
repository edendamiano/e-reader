# E-Reader V1 architecture

Status: Phase 1 Library and Phase 2 Reader implemented, 2026-08-10.

## Product boundary

V1 is a local Windows EPUB/no-DRM AZW3 reader with paginated reading and local TTS. It excludes PDF, DRM circumvention, cloud sync, notes, highlights, dictionaries, translation, recommendations, statistics, AI chat, and online stores.

## Process and storage boundary

```text
Electron renderer (React, no Node)
  -> frozen contextBridge methods
Electron main
  -> LibraryService -> node:sqlite + app-owned files
  -> bounded EPUB/AZW3 adapters
  -> stdin/stdout JSON Lines
Persistent Python Kokoro sidecar (loaded only when requested)
```

The normal Windows data root is `%LOCALAPPDATA%\EReader`:

```text
library/<sha256>/source.epub|source.azw3
library/<sha256>/publication.epub    # persisted AZW3 normalization only
library/<sha256>/cover.svg
database/reader.sqlite3
tts-cache/<engine>/<book-id>/*.wav
models/
logs/reader.log
```

The renderer never receives arbitrary filesystem/process APIs. Cover bytes and audio bytes cross the bridge as bounded data URLs; publication chapters cross as sanitized-input HTML strings and are sanitized again in the renderer.

## SQLite and migrations

`LibraryDatabase` uses Electron's Node 24 `node:sqlite` runtime, WAL mode, foreign keys, full synchronous writes, and a busy timeout. `schema_version` stores every applied migration. Each migration runs inside `BEGIN IMMEDIATE` / commit-or-rollback; initialization is repeatable and version 1 databases are upgraded to version 2 without data loss.

`books` owns source/normalized/cover paths and SHA-256 identity. `reading_state` stores canonical view and TTS locator JSON plus total progression and cascades on book deletion. `settings` stores validated global reader settings. The database is never kept in the repository.

## Import transaction

1. Validate the extension and regular-file status, then hash the original with SHA-256.
2. Return `此书已在书架中` when that hash already exists.
3. Copy the source into a private `.import-<uuid>` directory below the app-owned Library.
4. Preflight the archive/header, reject protected input, parse metadata/spine/TOC, and persist an AZW3 normalization when required.
5. Generate a deterministic, escaped placeholder cover when no safely extracted cover is available.
6. Rename staging to `library/<sha256>` and insert the database record transactionally. Any failure removes staging/final files.

Startup removes abandoned import/delete staging directories and app-owned orphan directories with no database record. Book deletion first renames the owned directory to a private delete staging path, deletes the database row transactionally, then removes source, normalization, cover, and per-book TTS cache. It never touches the user's original import path.

## EPUB and AZW3 publication model

The accepted EPUB adapter uses `yauzl` for bounded exact ZIP reads and `fast-xml-parser` for container, OPF, EPUB3 NAV, and EPUB2 NCX parsing. It emits the existing small `PublicationDto` and Locator model. This replaces the former `r2-shared-js` metadata dependency after validation against four real books; see ADR 0003 and `dependency-security.md`.

Only raster PNG/JPEG/GIF/WebP images referenced by the active chapter are read, bounded to 16 MB, and materialized as data URLs. Remote, SVG, filesystem, and unsupported image sources are removed. Publisher scripts, forms, style/link elements, handlers, navigation targets, and external resource URLs do not survive the renderer sanitizer.

AZW3 remains a fixed no-shell libmobi v0.12 sidecar built with `USE_ENCRYPTION=OFF`. Import validates PDB/MOBI/KF8 headers before launching it. The normalized EPUB is stored under the same book directory and then uses the identical Publication/Reader path as native EPUB.

## Paginated Reader

Each active spine resource is sanitized and placed in a scriptless `sandbox="allow-same-origin"` iframe with a no-script/no-network CSP. CSS columns provide one viewport per page. Only the active chapter enters the DOM; the full large book is never concatenated into one document.

The Reader supports keyboard and 23% edge navigation, forward/back chapter boundaries, hierarchical temporary TOC, current-chapter marking, page-following sentence selection, Ctrl+C, day/night appearance, and re-pagination for font, line height, margin, and resize. It has no persistent header, toolbar, sidebar, playback panel, or settings button.

The canonical locator contains book ID, spine href, stable speech-unit selector, local progression, total spine-weighted progression, and before/highlight/after text context. Page numbers are never persisted. A 250 ms debounce saves normal movement, while chapter/book switches and unmount also preserve the latest locator. Both task-kill recovery and normal-close restart are exercised against the same SQLite database.

## TTS boundary

Kokoro is the internal default established by the Phase 0 RTX 4060 measurement. IndexTTS2 remains an explicit developer candidate with fallback and is not optimized in Phase 1/2. The sidecar is not warmed at bookshelf startup; it loads on the first health/synthesis request. Cache paths are grouped by book ID so deletion can remove only the relevant audio.

Adaptive prefetch, LRU eviction, continuity/silence/loudness processing, background media controls, and long-form human listening remain Phase 3 work.
