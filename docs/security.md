# Security model

## Trust boundary

Every EPUB/AZW3 is hostile input. Publication content may not execute JavaScript, access Electron or Node, open files, spawn processes, navigate the host window, or make network requests.

## Enforced in the Phase 0 build

- BrowserWindow: `nodeIntegration=false`, `nodeIntegrationInWorker=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`, and `webviewTag=false`.
- Preload: one bundled file with a frozen, narrow IPC bridge; no generic `send`, shell, path, or filesystem method.
- IPC: sender URL and payload type/length/range checks.
- Navigation: new windows denied; unexpected top-level navigation prevented.
- Permissions: all permission requests and checks denied.
- Network: session request filter permits only `file:`, `data:`, `blob:`, and DevTools; HTTP(S) is denied.
- EPUB markup: DOMPurify 3.4.13, active/form/embed/style elements removed, URL and event attributes removed, and an iframe CSP with `script-src 'none'`, `connect-src 'none'`, `font-src 'none'`, and `frame-src 'none'`.
- ZIP resources: packed size, entry count, per-entry and total expanded-size limits, suspicious compression-ratio rejection, encrypted-entry rejection, traversal/control-character name rejection (including double-encoded traversal), and exact entry reads only. `META-INF/license.lcpl` is rejected before Readium parsing so the unsupported DRM/LCP and legacy request path is never entered.
- Image metadata: Readium's transitive `image-size@2.0.2` currently has no patched release for the [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) infinite-loop advisories. Those four non-core EPUB detectors are disabled process-wide before Readium parses any publication, with a malicious ICNS regression test.
- TTS: no localhost server; JSON Lines over a hidden Python isolated-mode (`-I`) child process with explicit UTF-8; bounded IPC text/speed inputs; returned audio paths must resolve below the cache root.
- TTS network policy: `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` are set by default. Model downloading is possible only when a developer explicitly starts the app with `EREADER_ALLOW_MODEL_DOWNLOAD=1`; normal reading and synthesis use local files.
- TTS failures: technical stderr is written to the local application log while the renderer receives only the generic `朗读暂时不可用。` state. The sidecar has a one-restart budget and deliberate application shutdown cannot trigger a restart.
- AZW3: preflight header parsing rejects non-KF8 and non-zero encryption types before conversion; `mobitool.exe` is a fixed executable invoked without a shell, its build disables encryption, and conversion is confined to a fresh temporary directory with a timeout.

The generated malicious fixture includes a script, an event handler, an external tracking image, and a remote iframe. The Electron smoke test confirms that the script markers never appear and publication networking is unavailable.

## Open security decisions

`r2-navigator-js@1.25.7` creates publication webviews with `sandbox=0`, so it was evaluated but removed from the shipped direct dependencies. The remaining Readium parser dependency still brings legacy advisories through `r2-lcp-js`, `request`, and `image-size`; they are documented rather than hidden, and publication resources stay behind the stricter parser/sanitizer boundary. The stock navigator is not enabled until a bundled sandboxed preload and a reviewed dependency patch set pass the hostile fixture suite.

The 2026-08-10 production-dependency audit reports 9 static findings (5 moderate, 2 high, 2 critical). Removing the unused navigator/streamer cut 160 installed packages and reduced the count from 12. The two `image-size` high findings are mitigated by disabling the affected detectors before any untrusted parse. The remaining `request` family is pulled by `r2-lcp-js`; the application accepts only a local `.epub` file path and rejects the LCP license entry before Readium runs, so that remote/DRM route is outside the accepted execution path. Nevertheless, the repository does not claim a zero-advisory dependency graph: replacing or patching the parser chain remains a release gate.

The remaining publication-security decision is the hardened production paginator. The libmobi AZW3 sidecar boundary is now implemented and covered by both a real no-DRM KF8 fixture and a synthetic protected-header rejection fixture; no DRM key or decryption path is implemented.
