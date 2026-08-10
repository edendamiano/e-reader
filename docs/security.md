# Security boundary

Status: enforced and regression-tested in the Phase 1/2 build.

## Electron

- `nodeIntegration=false`, `nodeIntegrationInWorker=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`, no webviews, and a frozen narrow preload bridge.
- New windows and unexpected top-level navigation are denied. IPC checks the exact trusted renderer file URL before every operation.
- Session requests allow only files below the built renderer directory plus `data:`, `blob:`, and DevTools. HTTP(S), loopback, arbitrary `file:` paths, malformed URLs, and dangerous schemes are blocked.
- Normal reading never initiates network access. Reader fonts and publication resources are local.

## Hostile publications

- ZIP preflight limits packed size, entry count, per-entry and total expansion, compression ratio, encryption, and path/control characters, including repeatedly encoded traversal.
- `META-INF/license.lcpl` and encrypted ZIP entries are rejected before package parsing. The AZW3 header must be unencrypted KF8; libmobi contains no decryption support.
- XML parsing is non-executing. Only manifest spine/NAV/NCX links resolving inside the archive are accepted.
- Chapter HTML passes DOMPurify with scripts, iframes, objects, forms, SVG/MathML, style/link/base elements, event handlers, and navigation attributes forbidden.
- Only bounded local PNG/JPEG/GIF/WebP bytes are rewritten to image data URLs. Remote URLs, SVG, HEIF, JXL, ICNS, local filesystem URLs, and unsupported types are removed without invoking metadata decoders.
- The publication iframe has no scripts, Node, process, arbitrary network, forms, objects, or nested frames. Its only file-backed resources are the two application-owned reader fonts injected by trusted code.

## Filesystem and child processes

- Library IPC accepts at most 100 file paths per import and validates types/lengths. SHA-256 is the duplicate identity.
- Imports use app-owned random staging directories and cleanup/rollback. Deletes operate only on a validated 64-hex book directory under the configured Library and never on source files.
- AZW3 conversion uses a fixed executable and argument vector, `execFile` without a shell, a fresh temporary directory, a 120-second timeout, and bounded output capture.

## Dependency result

The initial Phase 1 audit reproduced 9 production findings inherited through `r2-shared-js`, `r2-lcp-js`, `request`, and `image-size`. The narrow Readium metadata adapter was replaced with the already-used safe ZIP/XML components and validated against four real publications before those packages were removed. `npm audit --omit=dev` now reports 0 findings. The exact before/after analysis is in `dependency-security.md`.

This does not remove the need to re-run the audit and Electron security review before packaging. A full third-party notice bundle and installer signing/hardening remain release gates.
