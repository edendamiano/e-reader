# E-Reader V1

A quiet, fully offline Windows EPUB/AZW3 reader with paginated, E-Ink-inspired rendering.

## Daily use

- Start with `npm start` during development.
- Drag one or more `.epub` / `.azw3` files onto the bookshelf, or press `Ctrl+O` and choose multiple files.
- Double-click a cover to read. Imported books are copied into `%LOCALAPPDATA%\EReader\library`; deleting or moving the original does not affect reading.
- Left/Right or the outer 23% page edges turn pages. `T` opens the temporary table of contents. `Esc` closes the TOC or returns to the bookshelf.
- `+`/`-` changes the reading size while preserving the nearby sentence.
- Settings are available only from the bookshelf. The reading surface has no persistent toolbar.

Only no-DRM KF8/AZW3 is supported. Protected books are rejected with `此文件受保护，无法读取。`; no decryption path is present.

## Verification

```powershell
npm install
npm run verify:phase12
```

The full command performs type checking, TypeScript tests, production build, EPUB/AZW3 checks, Electron E2E, real-book validation, and the production dependency audit. Real public-domain fixtures and hashes are documented in `docs/fixtures.md`.

Reading text uses bundled Lora with Noto Serif SC as the CJK fallback. Both fonts are distributed under the SIL Open Font License 1.1 and work without a network connection.

This is still a development build rather than a packaged installer. Do not create a desktop shortcut until a signed/packageable `.exe` exists.
