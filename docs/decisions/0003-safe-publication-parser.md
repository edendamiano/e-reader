# ADR 0003: replace the legacy Readium metadata dependency

Decision: accepted in Phase 1/2 on 2026-08-10.

The product already used its own `PublicationDto`, canonical Locator, scriptless paginator, and sanitizer. `r2-shared-js` remained only to parse container metadata, spine, and TOC, but brought all 9 production audit findings through legacy LCP/request/image packages.

Replace that narrow adapter with the already locked `yauzl` and `fast-xml-parser` dependencies. Support EPUB container/OPF, EPUB3 NAV, EPUB2 NCX, metadata, linear spine, nested TOC, bounded raster materialization, and the same internal DTO. Keep the hostile ZIP and LCP rejection boundary ahead of XML parsing.

Acceptance evidence:

1. Synthetic EPUB3 and hostile archive tests pass.
2. Project Gutenberg Alice EPUB3: 15 spine resources and 16 TOC entries.
3. Project Gutenberg Chinese *論語*: 3 spine resources and more than 16,000 CJK characters.
4. Standard Ebooks *Don Quixote*: 142 spine resources and a three-level TOC.
5. libmobi-normalized KF8: 19 spine resources and 16 NCX-derived TOC entries.
6. Full Electron pagination, TOC, persistence, and security regression pass.
7. Production npm audit decreases from 9 findings to 0 without overrides or ignored advisories.

This does not claim universal EPUB conformance. Unsupported malformed publications must fail cleanly and be logged; future compatibility work expands the safe adapter rather than restoring an unmaintained network/DRM chain.
