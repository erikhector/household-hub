// ---------------------------------------------------------------------------

// A hand-rolled scan rather than `/<(script|…)\b[^>]*>[\s\S]*?<\/\1>/g`: on a
// hostile (or just broken) page full of *unclosed* `<script>`s that regex
// rescans to the end of the document from every one of them — quadratic, and
// many seconds of server CPU on a 3MB response. Here an unclosed element
// simply runs to the end of the input (which is also how a browser treats an
// unclosed `<script>`), so each character is looked at a bounded number of
// times.
const NON_CONTENT_OPEN_RE = /<!--|<(script|style|noscript|template|svg)\b[^>]*>/gi;

export function stripNonContent(html: string): string {
  const lower = html.toLowerCase();
  let out = "";
  let cursor = 0;
  NON_CONTENT_OPEN_RE.lastIndex = 0;
  for (let m = NON_CONTENT_OPEN_RE.exec(html); m; m = NON_CONTENT_OPEN_RE.exec(html)) {
    out += html.slice(cursor, m.index);
    const contentStart = m.index + m[0].length;
    const close = m[1] ? `</${m[1].toLowerCase()}` : "-->";
    const closeAt = lower.indexOf(close, contentStart);
    if (closeAt === -1) return out;
    const closeEnd = m[1] ? lower.indexOf(">", closeAt) : closeAt + close.length - 1;
    if (closeEnd === -1) return out;
    cursor = closeEnd + 1;
    NON_CONTENT_OPEN_RE.lastIndex = cursor;
  }
  return out + html.slice(cursor);
}

// A separate decoder from decodeHtmlEntities above on purpose: that one only
// un-escapes what a site might have done to its own JSON-LD and is part of
// the unchanged JSON-LD path, while visible text also needs &nbsp; and
// numeric references (&#8217;, &#xE5;, …). &amp; goes last so "&amp;lt;"
// decodes to the literal "&lt;" rather than "<".
function decodeTextEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function safeFromCodePoint(codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

/** Visible text of an HTML fragment, collapsed to a single line. */
export function htmlToText(fragment: string): string {
  return decodeTextEntities(fragment.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Visible text of an HTML fragment, one line per block-level element (list
 * item, paragraph, `<br>`, …) — how instructions and `<br>`-separated
 * ingredient blocks keep their step boundaries.
 */
export function htmlToLines(fragment: string): string[] {
  const withBreaks = fragment.replace(
    /<\/?(?:li|p|br|div|h[1-6]|tr|ol|ul|section|article)\b[^>]*>/gi,
    "\n",
  );
  return withBreaks
    .split("\n")
    .map((line) => htmlToText(line))
    .filter(Boolean);
}

export function getAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = attrs.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

export function hasBooleanAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|/|$)`, "i").test(attrs);
}

const VOID_ELEMENTS = new Set(["meta", "link", "img", "br", "hr", "input", "source", "wbr", "area"]);
export const OPEN_TAG_RE = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
// How far past an element's opening tag we'll scan for its matching close
// before giving up and treating the rest of that window as its content.
// Bounds the work on malformed markup (an unclosed `<div>` would otherwise
// make every lookup scan to the end of a multi-megabyte page).
const ELEMENT_SCAN_LIMIT = 200_000;

export type ElementSlice = { tag: string; attrs: string; start: number; end: number; inner: string };

/**
 * Given the index of an opening tag, find its matching close tag by counting
 * nested opens/closes of the same tag name — the one bit of structure a flat
 * regex can't give us. Void and self-closing elements have no content.
 */
export function sliceElement(html: string, start: number, scanLimit = ELEMENT_SCAN_LIMIT): ElementSlice | null {
  const openRe = /<([a-zA-Z][\w-]*)\b([^>]*)>/y;
  openRe.lastIndex = start;
  const open = openRe.exec(html);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const attrs = open[2];
  const contentStart = start + open[0].length;
  if (VOID_ELEMENTS.has(tag) || attrs.trimEnd().endsWith("/")) {
    return { tag, attrs, start, end: contentStart, inner: "" };
  }

  const windowEnd = Math.min(html.length, contentStart + scanLimit);
  const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tagRe.lastIndex = contentStart;
  let depth = 1;
  for (let m = tagRe.exec(html); m && m.index < windowEnd; m = tagRe.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      return { tag, attrs, start, end: m.index + m[0].length, inner: html.slice(contentStart, m.index) };
    }
  }
  return { tag, attrs, start, end: windowEnd, inner: html.slice(contentStart, windowEnd) };
}

// The page's own name for the dish. Shared by the Microdata and heading-heuristic
// tiers, which both fall back to it when no structured name is present.
export function pageTitle(html: string): string {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  const h1Text = h1 ? htmlToText(h1[1]) : "";
  if (h1Text) return h1Text;
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!title) return "";
  // "Chocolate Cake | My Food Blog" → "Chocolate Cake": the site-name suffix
  // after a pipe/dash separator is near-universal and never part of the dish.
  return htmlToText(title[1]).split(/\s+[|–—-]\s+/)[0]?.trim() ?? "";
}

