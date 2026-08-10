# V1 shipped third-party components

Exact Node versions are locked in `package-lock.json`. The application has no Python runtime or model dependency.

## Application runtime

| Component | Version | License | Purpose |
|---|---:|---|---|
| Electron | 43.3.0 | MIT plus Chromium/Node notices | Windows shell |
| React / React DOM | 18.3.1 | MIT | UI |
| DOMPurify | 3.4.13 | MPL-2.0 OR Apache-2.0 | Chapter sanitization |
| fast-xml-parser | 5.10.1 | MIT | EPUB metadata/navigation parsing |
| mime-types | 3.0.2 | MIT | Local media types |
| yauzl | 3.4.0 | MIT | Bounded EPUB ZIP reads |

`yazl` is test-only and is not a production dependency. Electron's generated `LICENSE` and `LICENSES.chromium.html` remain in the installed application directory.

## Native AZW3 converter

| Component | Version | License | Packaging |
|---|---:|---|---|
| libmobi | 0.12, commit `85dcfe803fc2a21020ddcf15c3eb66b93d388add` | LGPL-3.0-or-later | Dynamically linked `libmobi.dll`, license and replacement/build instructions included |
| zlib | 1.3.1 | zlib License | Statically linked into `libmobi.dll`, notice included |

The libmobi build uses `USE_ENCRYPTION=OFF`; no DRM decryption component is present.

## Reader fonts

| Component | Version / source | License | Purpose |
|---|---|---|---|
| Lora variable | Google Fonts `ofl/lora` | SIL OFL-1.1 | English reading text |
| Noto Serif SC variable | Google Fonts `ofl/notoserifsc` | SIL OFL-1.1 | Simplified Chinese and CJK fallback |

The exact upstream license files are retained beside the fonts under `apps/desktop/renderer/src/assets/fonts`.
