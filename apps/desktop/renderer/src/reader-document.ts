import DOMPurify from "dompurify";
import { buildReadingUnits, segmentSentences, type TextBlock } from "../../../../packages/reader-core/src/reading-units";
import type { ReadingUnit, ReadingUnitType } from "../../../../packages/shared/src/types";
import { readerThemeCss } from "./reader-theme";

export interface PreparedReaderDocument {
  html: string;
  units: ReadingUnit[];
}
const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,blockquote,li";

function blockType(element: Element): ReadingUnitType {
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
  const units = buildReadingUnits(bookId, href, blocks, locale);

  let unitIndex = 0;
  for (const element of elements) {
    const sentences = segmentSentences(element.textContent ?? "", locale);
    element.replaceChildren();
    for (const sentence of sentences) {
      const unit = units[unitIndex++];
      if (!unit) continue;
      const span = parsed.createElement("span");
      span.className = "reading-unit";
      span.dataset.readingUnitId = unit.id;
      span.textContent = sentence;
      element.append(span, parsed.createTextNode(" "));
    }
  }

  const safeLocale = escapeStyleValue(locale || "und");
  const contentSecurityPolicy = "default-src 'none'; img-src data:; media-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src file:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const html = `<!doctype html><html lang="${safeLocale}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}"><style>
    ${readerThemeCss()}
  </style></head><body><main id="book-content">${parsed.body.innerHTML}</main></body></html>`;
  return { html, units };
}
