# Production dependency security audit

Audit date: 2026-08-10. Command: `npm audit --omit=dev`.

## Outcome

The starting graph reported 9 packages: 5 moderate, 2 high, and 2 critical. All 9 were removed, not suppressed, after replacing the narrow `r2-shared-js` metadata adapter with the repository's bounded `yauzl` + `fast-xml-parser` Publication adapter. The replacement passed synthetic hostile fixtures, real EPUB3/NAV, real EPUB2/NCX through KF8 normalization, Chinese/English long books, and a 142-spine three-level TOC book. The final audit reports 0 production findings across 21 production dependencies.

| Package | Locked affected version | Severity | Advisory affected/fixed range | Runtime reachability before removal | Electron/renderer relevance | Action |
|---|---:|---|---|---|---|---|
| `r2-shared-js` | 1.0.85 | High aggregate | No clean compatible release in the locked chain | Directly used for untrusted OPF/spine/TOC parsing | Main-process hostile-book boundary | Removed after compatible Publication adapter validation |
| `image-size` | 2.0.2 | High | All current versions affected for ICNS/JXL/HEIF; no patched release reported | Readium could inspect untrusted publication images; vulnerable detectors had been disabled | Main-process denial-of-service risk | Removed; Reader now accepts only bounded PNG/JPEG/GIF/WebP bytes without metadata decoding |
| `r2-lcp-js` | 1.0.44 | Moderate aggregate | No clean compatible release in locked chain | Conditional LCP path; `license.lcpl` was preflight-rejected | Main-process DRM/network path | Removed; unsupported LCP remains rejected by archive preflight |
| `r2-utils-js` | 1.0.43 | Moderate aggregate | No clean compatible release in locked chain | Imported by Readium; request helpers were not needed by accepted local flow | Main-process utility path | Removed |
| `request` | 2.88.2 | Critical aggregate | SSRF affects `<=2.88.2`; package is unmaintained | Only inherited by LCP/utilities; accepted flow had no request operation | Could have created main-process network access | Removed |
| `form-data` | 2.3.3 | Critical aggregate | Affected `<=2.5.5`; fixed `2.5.6` | Child of unused `request` path | No renderer call; conditional main-process multipart path | Removed with `request` rather than forced across an incompatible range |
| `qs` | 6.5.5 | Moderate | Affected `<6.14.1`; fixed `6.14.1` | Child of unused `request` path | Conditional main-process parsing/DoS risk | Removed |
| `tough-cookie` | 2.5.0 | Moderate | Affected `<4.1.3`; fixed `4.1.3` | Child of unused `request` path | Conditional main-process cookie/prototype risk | Removed. The separate dev-only jsdom dependency uses 6.x. |
| `uuid` | 3.4.0 | Moderate | Affected `<11.1.1`; fixed `11.1.1` | Child of unused `request`; vulnerable buffer API was not called | No renderer API exposure | Removed |

Electron 43.3.0 is a development dependency used as the runtime shell during tests; it had no npm advisory in this audit. Its sandbox, navigation, permission, request, and preload configuration is tested separately because absence from npm audit is not a security guarantee.

## Evidence and release action

- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm run validate:real-books`: four real publications passed, including EPUB3, NCX-derived KF8, Chinese, English, and three-level TOC.
- Security regression tests cover script/handler removal, remote and arbitrary-file request blocking, dangerous URI removal, archive traversal, unsupported protection, and sandbox preferences.
- Re-run this audit, Electron release review, and hostile-book tests immediately before installer packaging.
