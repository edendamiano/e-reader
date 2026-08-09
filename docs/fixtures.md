# Fixture provenance

## Real KF8 / AZW3

- Work: *Alice's Adventures in Wonderland*, Lewis Carroll (1865).
- Source: Project Gutenberg ebook 11, `https://www.gutenberg.org/cache/epub/11/pg11-images-kf8.mobi`.
- Retrieved: 2026-08-09.
- Project Gutenberg status: public domain in the USA; this 1865 work is used only as a local parsing fixture.
- Local name: `data-input/pg11-images-kf8.azw3`. The extension is normalized to `.azw3`; libmobi confirms that the container is pure KF8/MOBI file version 8 rather than MOBI7.
- SHA-256: `fffee390f393ecf004f65c7fcd2cbefb3ee2652ff6f3fa8daa09c8a9a5644df0`.

The source binary is kept in the versioned `data-input` directory, not silently copied from a commercial ebook and not committed as an unexplained fixture.

## Protected-file detection

`fixtures/generated/protected-header.azw3` is generated locally from the public-domain KF8 fixture. The generator changes only the PalmDOC encryption-type field from `0` to `2`. It is not a decrypted commercial book and contains no DRM key or circumvention material; it exists solely to prove that the importer rejects a protected header before conversion.

## EPUB fixtures

The EPUB3, malformed EPUB, and hostile-script EPUB files are generated from synthetic text by `scripts/generate-fixtures.ts`. Generated ebook binaries are ignored by Git and can be recreated without copyrighted commercial content.
