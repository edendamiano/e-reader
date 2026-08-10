# E-Ink rendering and reading typography

## Final design

The reading surface uses a restrained E-Ink-inspired treatment, not a hardware display emulator. There is no animated ghosting, paper-noise overlay, blur, artificial sharpening, canvas, or shader. This keeps pagination deterministic and text crisp in Windows Chromium.

Day uses paper `#f1f1ec`, ink `#1c1d1b`, muted ink `#545550`, and rules `rgba(28, 29, 27, 0.28)`. Night uses paper `#1b1c1a`, ink `#d2d0c8`, muted ink `#aaa89f`, and rules `rgba(210, 208, 200, 0.25)`. Images are always desaturated and grayscale; day uses 0.94 contrast/1.035 brightness, while night uses 0.90 contrast/0.80 brightness.

## Font selection

The centralized stack is `EReader Lora`, `EReader Noto Serif SC`, `Georgia`, `serif`. Lora supplies the warm editorial Latin shapes. Noto Serif SC supplies Chinese and other covered CJK glyphs without per-character JavaScript routing.

Three CJK candidates were visually compared in the actual Electron renderer:

1. **Noto Serif SC** — selected. Its variable range supports the same 440 body/620 heading calibration as Lora, remains balanced at 16–21 px, and can be redistributed across Windows installations.
2. **SimSun** — compact and familiar, but more brittle at small sizes/high DPI and dependent on the host Windows installation.
3. **STSong** — elegant but visibly lighter at small sizes and not a reliable redistributable Windows dependency.

## Final typography calibration

- Body size: 21 px default; 16 px small-size evidence
- Body weight: 440; line height: 1.72; letter spacing: 0.002 em
- Heading weight: 620; line height: 1.32; letter spacing: -0.006 em
- Optical sizing, kerning, standard ligatures, and `text-rendering: optimizeLegibility` enabled
- No text shadow, blur, synthetic bold, or per-character font detection

## Bundled assets and licenses

| Asset | Size | Source | License |
|---|---:|---|---|
| `Lora-wght.ttf` | 212,196 bytes | Google Fonts `ofl/lora` | SIL OFL 1.1 |
| `NotoSerifSC-wght.ttf` | 25,125,512 bytes | Google Fonts `ofl/notoserifsc` | SIL OFL 1.1 |

The upstream OFL texts are retained beside the fonts. Variable TTF is used because Chromium loads it locally and reliably; converting to WOFF2 would require another build dependency. Runtime never depends on Google Fonts, a CDN, or another network font.

## Visual evidence

`npm run test:eink` writes screenshots to `../../png/eink-rendering`. It waits for `document.fonts.ready`, triggers repagination after window changes, and waits for the 165 ms page animation before capture so screenshots cannot record an in-between page offset.
