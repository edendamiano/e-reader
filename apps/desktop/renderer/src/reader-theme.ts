import loraUrl from "./assets/fonts/Lora-wght.ttf?url";
import notoSerifScUrl from "./assets/fonts/NotoSerifSC-wght.ttf?url";

export const READER_FONT_FAMILY = '"EReader Lora", "EReader Noto Serif SC", Georgia, serif';

const safeUrl = (value: string) => value.replace(/["'()\\\n\r]/g, "");

export function readerThemeCss(): string {
  return `
    @font-face {
      font-family: "EReader Lora";
      src: url("${safeUrl(loraUrl)}") format("truetype");
      font-style: normal;
      font-weight: 400 700;
      font-display: block;
    }
    @font-face {
      font-family: "EReader Noto Serif SC";
      src: url("${safeUrl(notoSerifScUrl)}") format("truetype");
      font-style: normal;
      font-weight: 200 900;
      font-display: block;
    }
    :root {
      --font-size: 21px;
      --line-height: 1.72;
      --page-margin: 8vw;
      --paper: #f1f1ec;
      --ink: #1c1d1b;
      --muted-ink: #545550;
      --rule: rgba(28, 29, 27, 0.28);
      --image-filter: grayscale(1) saturate(0) contrast(0.94) brightness(1.035);
      --reader-font: ${READER_FONT_FAMILY};
    }
    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--paper) !important;
      color: var(--ink) !important;
    }
    body {
      font-family: var(--reader-font);
      font-weight: 440;
      font-optical-sizing: auto;
      font-kerning: normal;
      font-synthesis: none;
      font-feature-settings: "kern" 1, "liga" 1, "clig" 1;
      letter-spacing: 0.002em;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    body * {
      color: inherit !important;
      border-color: var(--rule) !important;
      background-color: transparent !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    main {
      width: calc(100vw - var(--page-margin) - var(--page-margin));
      height: 90vh;
      margin: 5vh var(--page-margin);
      column-width: calc(100vw - var(--page-margin) - var(--page-margin));
      column-gap: calc(var(--page-margin) + var(--page-margin));
      column-fill: auto;
      font-size: var(--font-size);
      line-height: var(--line-height);
      text-align: justify;
      overflow: hidden;
    }
    h1, h2, h3, h4, h5, h6 {
      break-after: avoid;
      color: var(--ink) !important;
      font-family: var(--reader-font);
      font-weight: 620;
      font-optical-sizing: auto;
      line-height: 1.32;
      letter-spacing: -0.006em;
      text-align: start;
    }
    p { margin: 0 0 1.04em; orphans: 2; widows: 2; }
    blockquote { margin: 1em 1.45em; color: var(--muted-ink) !important; }
    a { color: var(--muted-ink) !important; text-decoration: underline; text-underline-offset: 0.14em; }
    hr { border: 0; border-top: 1px solid var(--rule) !important; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid var(--rule) !important; padding: 0.3em 0.45em; }
    img {
      display: block;
      max-width: 100%;
      max-height: 76vh;
      margin: 1em auto;
      object-fit: contain;
      break-inside: avoid;
      filter: var(--image-filter);
      opacity: 0.97;
    }
    ::selection { color: var(--ink); background: rgba(91, 97, 100, 0.22); }
  `;
}
