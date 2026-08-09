# ADR 0001: Readium boundary under strict Electron sandboxing

Decision: accepted for Phase 0, revisit before Phase 2.

Use Readium's publication parser and Locator model immediately. Do not enable the stock `r2-navigator-js` publication webview in the product build yet.

The current package is maintained and its parser correctly handled the synthetic EPUB fixture. Its navigator, however, creates webviews with `nodeIntegration=0` and `contextIsolation=1` but explicitly sets `sandbox=0`. The task's sandbox requirement is harder than this default. The package also carries legacy HTTP dependencies with unresolved audit findings even though V1 needs no remote publication URLs.

Phase 0 therefore uses a scriptless CSS-column renderer behind the same Publication/Locator adapter. A production switch to Readium navigator requires all of the following:

1. Bundle its webview preload so it can execute with Chromium sandboxing enabled.
2. Patch/verify `sandbox=1` for every publication webview.
3. Remove or isolate unused remote/OPDS/request paths.
4. Pass malicious EPUB, navigation, network, and Electron preference tests.
5. Re-run font/resize Locator restoration and CJK pagination tests.

This is a security finding from the spike, not a silent reduction of the product requirement.
