# ADR 0002: AZW3 normalization sidecar

Decision: libmobi v0.12 command-line sidecar is the accepted Phase 0 route; KindleUnpack remains a cross-check tool only.

Reasons:

- libmobi parses KF8/AZW3 resources and builds on Windows.
- Keeping LGPL-3.0 code in a replaceable sidecar gives a clear process and license boundary.
- The reader receives a normalized EPUB-like directory and never maintains a second rendering stack.

The adapter must reject protected files before conversion, invoke the executable without a shell, constrain all paths, enforce timeout/output limits, and retain the libmobi copyright/license notice. No DRM key or circumvention workflow exists in this project.

## Verified result

- Fixed source: official `bfabiszewski/libmobi` tag `v0.12`, commit `85dcfe803fc2a21020ddcf15c3eb66b93d388add`.
- Windows boundary: dynamically linked `mobitool.exe` + replaceable `libmobi.dll`; LGPL-3.0-or-later text retained.
- Binary hashes: `mobitool.exe` is `3F5CFBAA9ED1C277FDF2337A5713A648107CA24C523E73DDB29C48153A5392DF`; `libmobi.dll` is `742B3257980EAB43FCC55BA3E01380FE7D83594C400F432ECACABA593BCDAC57`.
- Build: GCC 13.2.0, CMake/Ninja, `USE_ENCRYPTION=OFF`, internal XML writer, zlib 1.3.1.
- Input: Project Gutenberg ebook 11, pure KF8 file version 8, encryption type 0, original SHA-256 `fffee390f393ecf004f65c7fcd2cbefb3ee2652ff6f3fa8daa09c8a9a5644df0`.
- Output: the same Readium Publication parser recovered Alice's title, Lewis Carroll as author, 19 reading-order resources, and 16 TOC entries.
- Protected regression: a synthetic copy with only the PalmDOC encryption field changed from 0 to 2 is rejected before `mobitool` runs, with the required user-facing message.
