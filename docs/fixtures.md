# Fixture provenance

Real book binaries stay under the version root's `data-input` directory and are not committed to Git. `npm run validate:real-books` writes exact measured results to `data-output/real-book-validation.json`.

## Project Gutenberg EPUB3 — long English

- Work: *Alice's Adventures in Wonderland*, Lewis Carroll.
- Official record: `https://www.gutenberg.org/ebooks/11`.
- Download: `https://www.gutenberg.org/ebooks/11.epub3.images`.
- Retrieved: 2026-08-10. Project Gutenberg marks it public domain in the USA.
- Local name: `pg11-alice-epub3.epub`.
- SHA-256: `6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c`.
- Validation: 15 spine resources, 16 top-level TOC entries, 162,528 visible characters.

## Project Gutenberg EPUB3 — long Chinese

- Work: *論語*, Confucius.
- Official record: `https://www.gutenberg.org/ebooks/23839`.
- Download: `https://www.gutenberg.org/ebooks/23839.epub3.images`.
- Retrieved: 2026-08-10. Project Gutenberg marks it Chinese and public domain in the USA.
- Local name: `pg23839-analects-zh-epub3.epub`.
- SHA-256: `bc7fbb6f9b0fb0e52ad266898bbf117b1778bc7b79f53275a52f94d7145aa637`.
- Validation: 3 spine resources, 43,011 visible characters including 16,031 CJK characters.

## Standard Ebooks — multi-level TOC

- Work: *Don Quixote*, Miguel de Cervantes Saavedra, John Ormsby translation.
- Official record: `https://standardebooks.org/ebooks/miguel-de-cervantes-saavedra/don-quixote/john-ormsby`.
- Standard Ebooks states that its complete ebook files are dedicated to the public domain under CC0; users outside the USA must still consider local law.
- Local name: `se-don-quixote.epub`.
- SHA-256: `c643a6f28ecd8bb7c66ae0743d3c3601be8b64e5f0b0b3197f19ffde688e1db1`.
- Validation: 142 spine resources, 9 top-level entries, 3 TOC levels, 2,432,073 visible characters.

## Real KF8 / AZW3

- Work: *Alice's Adventures in Wonderland*, Lewis Carroll.
- Source: `https://www.gutenberg.org/cache/epub/11/pg11-images-kf8.mobi`.
- Local name: `pg11-images-kf8.azw3`; libmobi confirms pure KF8/MOBI version 8.
- SHA-256: `fffee390f393ecf004f65c7fcd2cbefb3ee2652ff6f3fa8daa09c8a9a5644df0`.
- Validation: 19 spine resources and 16 TOC entries after persisted normalization.

## Generated hostile and structural fixtures

`scripts/generate-fixtures.ts` creates a legal synthetic EPUB3, a malformed ZIP, and a script/remote-resource attack EPUB. `scripts/generate-protected-azw3-fixture.ts` copies the public-domain KF8 and changes only its PalmDOC encryption field from 0 to 2. These prove rejection behavior; they contain no DRM keys or circumvention material.
