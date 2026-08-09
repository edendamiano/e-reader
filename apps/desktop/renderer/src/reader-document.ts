import DOMPurify from "dompurify";
import { buildSpeechUnits, segmentSentences, type TextBlock } from "../../../../packages/reader-core/src/speech-units";
import type { SpeechUnit, SpeechUnitType } from "../../../../packages/shared/src/types";

export interface PreparedReaderDocument {
  html: string;
  units: SpeechUnit[];
}
const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,blockquote,li";

function blockType(element: Element): SpeechUnitType {
  const tag = element.tagName.toLowerCase();
  if (tag.startsWith("h")) return "heading";
  if (tag === "blockquote") return "quote";
  if (tag === "li") return "list";
  return "paragraph";
}

function escapeStyleValue(value: string): string {
  return value.replace(/[<>&"']/g, "");
}

export function prepareReaderDocument(
  rawHtml: string,
  bookId: string,
  href: string,
  locale: string,
): PreparedReaderDocument {
  const sanitized = DOMPurify.sanitize(rawHtml, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "style", "base", "video", "audio", "svg", "math"],
    FORBID_ATTR: ["srcset", "href", "xlink:href", "action", "formaction", "style"],
    ALLOW_DATA_ATTR: false,
  });
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  parsed.querySelectorAll("img").forEach((image) => {
    const source = image.getAttribute("src") ?? "";
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(source) || source.length > 24_000_000) image.remove();
    else image.removeAttribute("alt");
  });
  parsed.querySelectorAll("[onload],[onclick],[onerror],[onmouseover],[onfocus]").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }
  });

  const elements = Array.from(parsed.body.querySelectorAll(BLOCK_SELECTOR)).filter((element) => {
    return Boolean(element.textContent?.replace(/\s+/g, " ").trim()) && !element.closest("nav,[hidden],[aria-hidden='true'],aside[epub\\:type~='footnote']");
  });
  const blocks: TextBlock[] = elements.map((element, index) => ({
    text: element.textContent ?? "",
    selector: `${element.tagName.toLowerCase()}:nth-reader-block(${index + 1})`,
    type: blockType(element),
  }));
  const units = buildSpeechUnits(bookId, href, blocks, locale);

  let unitIndex = 0;
  for (const element of elements) {
    const sentences = segmentSentences(element.textContent ?? "", locale);
    element.replaceChildren();
    for (const sentence of sentences) {
      const unit = units[unitIndex++];
      if (!unit) continue;
      const span = parsed.createElement("span");
      span.className = "speech-unit";
      span.dataset.speechUnitId = unit.id;
      span.textContent = sentence;
      element.append(span, parsed.createTextNode(" "));
    }
  }

  const safeLocale = escapeStyleValue(locale || "und");
  const contentSecurityPolicy = "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const html = `<!doctype html><html lang="${safeLocale}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}"><style>
    :root { --font-size: 21px; --line-height: 1.72; --page-margin: 8vw; --paper: #f4f0e7; --ink: #292824; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--paper); color: var(--ink); }
    body { font-family: Georgia, "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif; }
    main { height: calc(100vh - 10vh); margin: 5vh var(--page-margin); column-width: calc(100vw - (2 * var(--page-margin))); column-gap: calc(2 * var(--page-margin)); column-fill: auto; font-size: var(--font-size); line-height: var(--line-height); text-align: justify; overflow: visible; }
    h1, h2, h3 { break-after: avoid; line-height: 1.3; text-align: start; }
    p { margin: 0 0 1.05em; orphans: 2; widows: 2; }
    img { display: block; max-width: 100%; max-height: 76vh; margin: 1em auto; object-fit: contain; break-inside: avoid; }
    .speech-unit { border-radius: 0.15em; transition: background-color 80ms linear; }
    .speech-unit.is-active { background: rgba(108, 96, 77, 0.14); }
    ::selection { background: rgba(111, 129, 148, 0.23); }
  </style></head><body><main id="book-content">${parsed.body.innerHTML}</main></body></html>`;
  return { html, units };
}
