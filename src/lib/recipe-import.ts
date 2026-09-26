// Recipe import from URL — pure parsing logic (JSON-LD extraction, ingredient
// splitting, instruction flattening) plus the SSRF-guarding URL validation and
// fetch used by importRecipeFromUrlAction
// (src/app/dashboard/meal-planning/recipe-actions.ts). The parsing functions below
// take no network dependency and are unit-tested with inline HTML/JSON
// fixtures in recipe-import.test.ts; fetchRecipeHtml is the only part that
// touches the network and isn't exercised by tests.
//
// Extraction runs in three tiers, most trustworthy first (GAP-31):
//   1. schema.org `Recipe` JSON-LD — the site's own machine-readable data,
//      and what the large majority of recipe blogs emit (Yoast, WP Recipe
//      Maker, Tasty Recipes, ICA, …). When one is found it always wins and
//      the other tiers never run, so JSON-LD results are byte-for-byte what
//      they were before the fallbacks existed.
//   2. schema.org `Recipe` Microdata (`itemscope itemtype=".../Recipe"` with
//      `itemprop="name"/"recipeIngredient"/"recipeInstructions"`) — older
//      templates that predate JSON-LD. Still structured, but read out of
//      arbitrary markup, so less exact.
//   3. An HTML heuristic — the page's `<h1>`/`<title>` plus the list(s)
//      following a heading like "Ingredients"/"Ingredienser". Pure guesswork
//      for pages with no structured data at all.
// Tiers 2 and 3 are flagged via `source` so the form can tell the user to
// review before saving (the import already never auto-saves; the flag just
// makes that review explicit when we were guessing). All three stay
// regex/string-based — no DOM parser dependency, matching how the JSON-LD
// tier has always worked.
import { promises as dns } from "node:dns";
import net from "node:net";

export type ParsedIngredient = { name: string; quantity: number; unit: string };
export type ParsedRecipe = {
  name: string;
  instructions: string;
  ingredients: ParsedIngredient[];
};

/**
 * Which extraction tier produced an import. Anything other than "jsonld" is
 * best-effort and shown with a "review before saving" notice.
 */
export type RecipeImportSource = "jsonld" | "microdata" | "heuristic";
export type ImportedRecipe = ParsedRecipe & { source: RecipeImportSource };

// ---------------------------------------------------------------------------
// JSON-LD extraction
// ---------------------------------------------------------------------------

// The `type` attribute value is usually quoted, but HTML5 also allows an
// unquoted value when it contains no whitespace/quotes/`=`/`<`/`>` —
// `application/ld+json` qualifies, and real sites use this (e.g. Yoast
// SEO's `<script type=application/ld+json class=yoast-schema-graph>`,
// found on a huge share of WordPress recipe blogs). The lookahead after the
// unquoted alternative stops it from matching a value that merely starts
// with `application/ld+json` followed by more non-delimiter characters.
const JSON_LD_SCRIPT_RE =
  /<script[^>]*type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json(?=[\s/>]))[^>]*>([\s\S]*?)<\/script>/gi;

/** Extract the raw text content of every `<script type="application/ld+json">` block. */
export function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    if (match[1] !== undefined) blocks.push(match[1]);
  }
  return blocks;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

type JsonLdNode = Record<string, unknown>;

function tryParseJson(raw: string): unknown | undefined {
  for (const candidate of [raw, decodeHtmlEntities(raw)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function typeIncludes(node: JsonLdNode, type: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === type;
  if (Array.isArray(t)) return t.includes(type);
  return false;
}

function searchForRecipeNode(value: unknown): JsonLdNode | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchForRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const node = value as JsonLdNode;
    if (typeIncludes(node, "Recipe")) return node;
    if (Array.isArray(node["@graph"])) {
      const found = searchForRecipeNode(node["@graph"]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Scan every JSON-LD block for an object (or an item inside an `@graph`
 * array) whose `@type` includes "Recipe". Returns the first match, or null.
 */
export function findRecipeNode(jsonLdBlocks: string[]): JsonLdNode | null {
  for (const block of jsonLdBlocks) {
    const parsed = tryParseJson(block.trim());
    if (parsed === undefined) continue;
    const found = searchForRecipeNode(parsed);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ingredient-string splitting
// ---------------------------------------------------------------------------

const KNOWN_UNITS = new Set([
  "cup",
  "cups",
  "tbsp",
  "tablespoon",
  "tablespoons",
  "tsp",
  "teaspoon",
  "teaspoons",
  "g",
  "gram",
  "grams",
  "kg",
  "kilogram",
  "kilograms",
  "mg",
  "ml",
  "milliliter",
  "milliliters",
  "millilitre",
  "millilitres",
  "l",
  "liter",
  "liters",
  "litre",
  "litres",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "clove",
  "cloves",
  "can",
  "cans",
  "slice",
  "slices",
  "pinch",
  "pinches",
  "dash",
  "dashes",
  "package",
  "packages",
  "pkg",
  "bunch",
  "bunches",
  "head",
  "heads",
  "stalk",
  "stalks",
  "piece",
  "pieces",
  "pcs",
  "pc",
  // Swedish (e.g. ICA recipes) — schema.org Recipe JSON-LD gives these as
  // plain measure words in `recipeIngredient`, same as the English ones above.
  "dl",
  "msk",
  "tsk",
  "krm",
  "st",
  "förp",
  "port",
  "ask",
  "burk",
  "påse",
  "klyfta",
  "klyftor",
  "skiva",
  "skivor",
  "kruka",
  "näve",
]);

function parseLeadingQuantity(raw: string): number | null {
  if (raw.includes(" ")) {
    // Mixed number, e.g. "1 1/2"
    const [whole, frac] = raw.split(" ");
    const [n, d] = frac.split("/").map(Number);
    if (!d) return null;
    const wholeNum = Number(whole);
    if (!Number.isFinite(wholeNum) || !Number.isFinite(n)) return null;
    return wholeNum + n / d;
  }
  if (raw.includes("/")) {
    const [n, d] = raw.split("/").map(Number);
    if (!d || !Number.isFinite(n)) return null;
    return n / d;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const LEADING_QUANTITY_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(.*)$/;

/**
 * Best-effort split of a schema.org `recipeIngredient` string (e.g.
 * "2 cups flour", "1 1/2 tbsp olive oil", "a pinch of salt") into
 * quantity/unit/name. Falls back to putting the whole string in `name` with
 * quantity 1 whenever it can't confidently split — never guesses wrong.
 */
export function parseIngredientString(raw: string): ParsedIngredient {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { name: "", quantity: 1, unit: "pcs" };

  const match = trimmed.match(LEADING_QUANTITY_RE);
  if (!match) return { name: trimmed, quantity: 1, unit: "pcs" };

  const [, qtyRaw, rest] = match;
  const quantity = parseLeadingQuantity(qtyRaw);
  if (quantity === null || quantity <= 0 || !rest) {
    return { name: trimmed, quantity: 1, unit: "pcs" };
  }

  const restWords = rest.split(" ");
  const firstWord = restWords[0]?.toLowerCase().replace(/[.,]$/, "") ?? "";
  if (KNOWN_UNITS.has(firstWord) && restWords.length > 1) {
    return { name: restWords.slice(1).join(" ").trim(), quantity, unit: firstWord };
  }

  return { name: rest.trim(), quantity, unit: "pcs" };
}

// ---------------------------------------------------------------------------
// Instruction flattening
// ---------------------------------------------------------------------------

function flattenInstructionItem(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    const node = item as JsonLdNode;
    if (Array.isArray(node.itemListElement)) {
      return node.itemListElement
        .map((sub) => flattenInstructionItem(sub))
        .filter(Boolean)
        .join("\n");
    }
    if (typeof node.text === "string") return node.text.trim();
    if (typeof node.name === "string") return node.name.trim();
  }
  return "";
}

/**
 * schema.org's `recipeInstructions` can be a plain string, an array of
 * strings, or an array of `HowToStep`/`HowToSection` objects. Flatten to
 * plain text, one step per line.
 */
export function flattenInstructions(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenInstructionItem(item))
      .filter(Boolean)
      .join("\n");
  }
  return flattenInstructionItem(value);
}

// ---------------------------------------------------------------------------
// Mapping a JSON-LD Recipe node to the form's shape
// ---------------------------------------------------------------------------

export function mapJsonLdToRecipe(node: JsonLdNode): ParsedRecipe {
  const name = typeof node.name === "string" ? node.name.trim() : "";

  const rawIngredients = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient
    : Array.isArray(node.ingredients)
      ? node.ingredients
      : [];
  const ingredients = rawIngredients
    .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
    .map(parseIngredientString);

  const instructions = flattenInstructions(node.recipeInstructions);

  return { name, instructions, ingredients };
}

function hasAnyContent(recipe: ParsedRecipe): boolean {
  return Boolean(recipe.name || recipe.ingredients.length > 0 || recipe.instructions);
}

function parseJsonLdRecipe(html: string): ParsedRecipe | null {
  const node = findRecipeNode(extractJsonLdBlocks(html));
  if (!node) return null;
  const recipe = mapJsonLdToRecipe(node);
  return hasAnyContent(recipe) ? recipe : null;
}

/**
 * End-to-end pure parse: raw page HTML -> an ImportedRecipe, or null if
 * nothing recipe-shaped could be found. Tries JSON-LD, then Microdata, then
 * the heading heuristic (see the header comment), stopping at the first
 * tier that yields something usable.
 */
export function parseRecipeFromHtml(html: string): ImportedRecipe | null {
  const jsonLd = parseJsonLdRecipe(html);
  if (jsonLd) return { ...jsonLd, source: "jsonld" };

  // Everything below reads visible markup, so drop scripts/styles/comments
  // first — otherwise a `<ul>` inside an inline template string or a
  // commented-out block could be mistaken for the ingredient list.
  const content = stripNonContent(html);

  const microdata = parseMicrodataRecipe(content);
  if (microdata) return { ...microdata, source: "microdata" };

  const heuristic = parseHeuristicRecipe(content);
  if (heuristic) return { ...heuristic, source: "heuristic" };

  return null;
}

// ---------------------------------------------------------------------------
// Fallback tiers: shared HTML-string helpers
// ---------------------------------------------------------------------------

// A hand-rolled scan rather than `/<(script|…)\b[^>]*>[\s\S]*?<\/\1>/g`: on a
// hostile (or just broken) page full of *unclosed* `<script>`s that regex
// rescans to the end of the document from every one of them — quadratic, and
// many seconds of server CPU on a 3MB response. Here an unclosed element
// simply runs to the end of the input (which is also how a browser treats an
// unclosed `<script>`), so each character is looked at a bounded number of
// times.
const NON_CONTENT_OPEN_RE = /<!--|<(script|style|noscript|template|svg)\b[^>]*>/gi;

function stripNonContent(html: string): string {
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
function htmlToText(fragment: string): string {
  return decodeTextEntities(fragment.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Visible text of an HTML fragment, one line per block-level element (list
 * item, paragraph, `<br>`, …) — how instructions and `<br>`-separated
 * ingredient blocks keep their step boundaries.
 */
function htmlToLines(fragment: string): string[] {
  const withBreaks = fragment.replace(
    /<\/?(?:li|p|br|div|h[1-6]|tr|ol|ul|section|article)\b[^>]*>/gi,
    "\n",
  );
  return withBreaks
    .split("\n")
    .map((line) => htmlToText(line))
    .filter(Boolean);
}

function getAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = attrs.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function hasBooleanAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|/|$)`, "i").test(attrs);
}

const VOID_ELEMENTS = new Set(["meta", "link", "img", "br", "hr", "input", "source", "wbr", "area"]);
const OPEN_TAG_RE = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
// How far past an element's opening tag we'll scan for its matching close
// before giving up and treating the rest of that window as its content.
// Bounds the work on malformed markup (an unclosed `<div>` would otherwise
// make every lookup scan to the end of a multi-megabyte page).
const ELEMENT_SCAN_LIMIT = 200_000;

type ElementSlice = { tag: string; attrs: string; start: number; end: number; inner: string };

/**
 * Given the index of an opening tag, find its matching close tag by counting
 * nested opens/closes of the same tag name — the one bit of structure a flat
 * regex can't give us. Void and self-closing elements have no content.
 */
function sliceElement(html: string, start: number, scanLimit = ELEMENT_SCAN_LIMIT): ElementSlice | null {
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

// ---------------------------------------------------------------------------
// Tier 2: schema.org Microdata
// ---------------------------------------------------------------------------

function isRecipeItemtype(attrs: string): boolean {
  const itemtype = getAttr(attrs, "itemtype");
  if (!itemtype) return false;
  return itemtype
    .split(/\s+/)
    .some((token) => /^https?:\/\/(?:www\.)?schema\.org\/Recipe\/?$/i.test(token));
}

/**
 * Reads a schema.org `Recipe` Microdata item out of the page. Only the
 * Recipe's *own* properties count: an `itemprop="name"` inside a nested
 * `itemscope` (the author's Person, a review, the publisher) belongs to that
 * nested item, so any property whose tag sits strictly inside a nested
 * item's element is skipped. The nested element's own opening tag is still
 * the Recipe's — that's how `<li itemprop="recipeInstructions" itemscope
 * itemtype=".../HowToStep">` is picked up, with its full text as the step.
 */
const MICRODATA_MAX_TAGS = 1_000;
// A nested item (a review, the author) or a single property's element is
// small; the Recipe root itself still gets the whole page.
const MICRODATA_ELEMENT_SCAN_LIMIT = 50_000;

export function parseMicrodataRecipe(html: string): ParsedRecipe | null {
  let root: ElementSlice | null = null;
  for (const match of html.matchAll(OPEN_TAG_RE)) {
    if (hasBooleanAttr(match[2], "itemscope") && isRecipeItemtype(match[2])) {
      root = sliceElement(html, match.index, html.length);
      break;
    }
  }
  if (!root) return null;

  const scope = root.inner;
  const nestedRanges: Array<[number, number]> = [];
  const props: Array<{ names: string[]; index: number; attrs: string }> = [];
  for (const match of scope.matchAll(OPEN_TAG_RE)) {
    // Bounded work on hostile markup: each nested scope/prop costs a
    // sliceElement scan and the own-prop filter below is props × scopes, so
    // a page stuffed with thousands of them would otherwise be quadratic.
    // A real recipe has a few dozen of each.
    if (nestedRanges.length >= MICRODATA_MAX_TAGS || props.length >= MICRODATA_MAX_TAGS) break;
    const attrs = match[2];
    if (hasBooleanAttr(attrs, "itemscope")) {
      const nested = sliceElement(scope, match.index, MICRODATA_ELEMENT_SCAN_LIMIT);
      if (nested) nestedRanges.push([nested.start, nested.end]);
    }
    const itemprop = getAttr(attrs, "itemprop");
    if (itemprop) props.push({ names: itemprop.split(/\s+/), index: match.index, attrs });
  }

  const ownProps = props.filter(
    (prop) => !nestedRanges.some(([start, end]) => prop.index > start && prop.index < end),
  );
  // `content` is the Microdata value for <meta>, and plenty of templates put
  // it on visible elements too (`<span itemprop="name" content="…">`) as an
  // override for display text — honor it wherever it appears.
  const propValues = (name: string, lines: boolean): string[] =>
    ownProps
      .filter((prop) => prop.names.includes(name))
      .flatMap((prop) => {
        const content = getAttr(prop.attrs, "content");
        if (content !== null) return [htmlToText(content)];
        const element = sliceElement(scope, prop.index, MICRODATA_ELEMENT_SCAN_LIMIT);
        if (!element) return [];
        return lines ? htmlToLines(element.inner) : [htmlToText(element.inner)];
      })
      .filter(Boolean);

  const name = propValues("name", false)[0] ?? pageTitle(html);
  const rawIngredients = propValues("recipeIngredient", false);
  const ingredients = (rawIngredients.length > 0 ? rawIngredients : propValues("ingredients", false)).map(
    parseIngredientString,
  );
  const instructions = propValues("recipeInstructions", true).join("\n");

  const recipe = { name, instructions, ingredients };
  return hasAnyContent(recipe) ? recipe : null;
}

// ---------------------------------------------------------------------------
// Tier 3: heading heuristic
// ---------------------------------------------------------------------------

// Heading text (after trimming a trailing colon) that introduces the
// ingredient list / the method. English + Swedish (the app's two locales)
// plus the handful of other languages Squirrel users are likeliest to paste
// links in. Anchored so "Ingredients" / "Ingredienser till 4 portioner"
// match but a blog paragraph heading like "Why these ingredients matter"
// doesn't.
const INGREDIENTS_HEADING_RE =
  /^(?:the\s+)?(?:ingredients?|ingredienser|zutaten|ingrédients|ingrediënten|ingredienten|ingredientes|ingredienti|ainekset|du behöver|det här behöver du)(?:\s*\(.*\)|\s+(?:for|för|till|für|pour|voor|para|per)\s.*)?$/i;
const INSTRUCTIONS_HEADING_RE =
  /^(?:instructions?|directions?|method|preparation|steps|how to make it|gör så här|så här gör du|så gör du|instruktioner|tillagning|tillvägagångssätt|zubereitung|préparation|bereiding|preparación|preparazione|valmistus)$/i;

const HEADING_OR_LIST_RE = /<(h[1-6]|ul|ol|p)\b[^>]*>/gi;
// Past this many characters after the heading we stop looking — a list that
// far away is almost certainly not the one the heading introduced.
const HEURISTIC_SECTION_LIMIT = 20_000;

function pageTitle(html: string): string {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  const h1Text = h1 ? htmlToText(h1[1]) : "";
  if (h1Text) return h1Text;
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!title) return "";
  // "Chocolate Cake | My Food Blog" → "Chocolate Cake": the site-name suffix
  // after a pipe/dash separator is near-universal and never part of the dish.
  return htmlToText(title[1]).split(/\s+[|–—-]\s+/)[0]?.trim() ?? "";
}

type Heading = { level: number; text: string; start: number; end: number };

// A heading's text is short; its close tag is looked for only this far past
// the opening tag. Unbounded (`<h([1-6])>[\s\S]*?<\/h\1>`), a page of
// unclosed `<h2>`s makes every one of them scan to the end of the document —
// quadratic on attacker-controlled input. An unclosed or absurdly long
// heading just isn't treated as one.
const HEADING_SCAN_LIMIT = 2_000;
const HEADING_OPEN_RE = /<h([1-6])\b[^>]*>/gi;

function findHeadings(html: string): Heading[] {
  const headings: Heading[] = [];
  for (const match of html.matchAll(HEADING_OPEN_RE)) {
    const contentStart = match.index + match[0].length;
    const window = html.slice(contentStart, contentStart + HEADING_SCAN_LIMIT);
    const close = window.match(new RegExp(`</h${match[1]}\\s*>`, "i"));
    if (!close || close.index === undefined) continue;
    headings.push({
      level: Number(match[1]),
      text: htmlToText(window.slice(0, close.index)).replace(/\s*:$/, ""),
      start: match.index,
      end: contentStart + close.index + close[0].length,
    });
  }
  return headings;
}

/**
 * Lines of the section a heading introduces: the items of every `<ul>`/`<ol>`
 * up to the next heading at the same or a higher level (so a sub-heading
 * like "For the sauce" under "Ingredients" keeps going), or up to the other
 * section's heading. If the section has no list at all, its paragraphs are
 * used instead — some blogs write the method as plain `<p>` steps, or the
 * ingredients as one `<p>` with `<br>`s.
 */
function collectSection(html: string, heading: Heading, stopRe: RegExp): string[] {
  const windowEnd = Math.min(html.length, heading.end + HEURISTIC_SECTION_LIMIT);
  const listLines: string[] = [];
  const paragraphLines: string[] = [];
  const re = new RegExp(HEADING_OR_LIST_RE.source, "gi");
  re.lastIndex = heading.end;
  for (let m = re.exec(html); m && m.index < windowEnd; m = re.exec(html)) {
    const tag = m[1].toLowerCase();
    if (tag === "p") {
      // `</p>` is optional in HTML, so a paragraph ends at its close tag *or*
      // the next block-level element — never let an unclosed `<p>` swallow
      // the heading that should stop this section.
      const contentStart = m.index + m[0].length;
      const rest = html.slice(contentStart, windowEnd);
      const stop = rest.search(/<\/p\s*>|<(?:p|h[1-6]|ul|ol|div)\b/i);
      const inner = stop === -1 ? rest : rest.slice(0, stop);
      paragraphLines.push(...htmlToLines(inner));
      re.lastIndex = contentStart + inner.length;
      continue;
    }
    const element = sliceElement(html, m.index, windowEnd - m.index);
    if (!element) break;
    if (tag.startsWith("h")) {
      const text = htmlToText(element.inner).replace(/\s*:$/, "");
      if (Number(tag[1]) <= heading.level || stopRe.test(text)) break;
      continue;
    }
    // A list: one line per `<li>`, where an item runs to the next `<li` or
    // list close (`</li>` is optional too). A nested sub-list's items come
    // out as their own lines after the parent item's text.
    for (const li of element.inner.matchAll(/<li\b[^>]*>([\s\S]*?)(?=<li\b|<\/[ou]l\s*>|$)/gi)) {
      const text = htmlToText(li[1]);
      if (text) listLines.push(text);
    }
    re.lastIndex = element.end;
  }
  return listLines.length > 0 ? listLines : paragraphLines;
}

/**
 * Last-resort extraction for pages with no structured data: the page title
 * plus whatever follows an "Ingredients" heading (and, if present, a
 * "Method"/"Gör så här" heading). Requires at least one ingredient — a page
 * title alone would "succeed" on every blog post and just pre-fill junk.
 */
export function parseHeuristicRecipe(html: string): ParsedRecipe | null {
  const headings = findHeadings(html);
  const ingredientsHeading = headings.find((h) => INGREDIENTS_HEADING_RE.test(h.text));
  if (!ingredientsHeading) return null;

  const ingredients = collectSection(html, ingredientsHeading, INSTRUCTIONS_HEADING_RE)
    .map(parseIngredientString)
    .filter((ingredient) => ingredient.name);
  if (ingredients.length === 0) return null;

  const instructionsHeading = headings.find((h) => INSTRUCTIONS_HEADING_RE.test(h.text));
  const instructions = instructionsHeading
    ? collectSection(html, instructionsHeading, INGREDIENTS_HEADING_RE).join("\n")
    : "";

  return { name: pageTitle(html), instructions, ingredients };
}

// ---------------------------------------------------------------------------
// SSRF-guarding URL validation + fetch
// ---------------------------------------------------------------------------

export type UrlValidationError = "invalidUrl" | "blockedHost";
export type UrlValidationResult = { ok: true; url: URL } | { ok: false; error: UrlValidationError };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

// [network, prefixLength] pairs for every private/reserved/link-local/etc.
// IPv4 range that must never be reachable from a server-side fetch of a
// user-supplied URL.
const PRIVATE_IPV4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

export function isPrivateOrReservedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparsable — refuse rather than guess safe
  for (const [network, prefix] of PRIVATE_IPV4_CIDRS) {
    const networkValue = ipv4ToInt(network);
    if (networkValue === null) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((value & mask) === (networkValue & mask)) return true;
  }
  return false;
}

export function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9")) return true; // link-local (fe80::/10)
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("2001:db8:")) return true; // documentation
  // IPv4-mapped addresses (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  return false;
}

/**
 * Pure (no network) validation: scheme must be http(s), and if the hostname
 * is itself an IP literal it must not be private/reserved. Doesn't catch a
 * hostname that *resolves* to a private IP — see fetchRecipeHtml's DNS check
 * for that.
 */
export function validateRecipeUrl(rawUrl: string): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalidUrl" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "invalidUrl" };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, error: "blockedHost" };
  }

  const ipFamily = net.isIP(hostname);
  if (ipFamily === 4 && isPrivateOrReservedIPv4(hostname)) {
    return { ok: false, error: "blockedHost" };
  }
  if (ipFamily === 6 && isPrivateOrReservedIPv6(hostname)) {
    return { ok: false, error: "blockedHost" };
  }

  return { ok: true, url };
}

async function assertResolvesToPublicAddress(hostname: string): Promise<boolean> {
  const ipFamily = net.isIP(hostname);
  if (ipFamily) return true; // already checked by validateRecipeUrl

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    return false; // unresolvable — refuse rather than guess safe
  }
  if (records.length === 0) return false;

  for (const record of records) {
    if (record.family === 4 && isPrivateOrReservedIPv4(record.address)) return false;
    if (record.family === 6 && isPrivateOrReservedIPv6(record.address)) return false;
  }
  return true;
}

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB — plenty for a recipe page's HTML
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 8000;

async function readBodyWithLimit(response: Response, limitBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limitBytes) {
          await reader.cancel();
          throw new Error("tooLarge");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

export type FetchRecipeError =
  | UrlValidationError
  | "fetchFailed"
  | "tooLarge"
  | "tooManyRedirects";
export type FetchRecipeResult = { ok: true; html: string } | { ok: false; error: FetchRecipeError };

/**
 * Fetches a user-supplied recipe URL server-side, guarding against SSRF:
 * only http(s), never a private/loopback/link-local/reserved IP (checked
 * both as a literal in the URL and after DNS resolution, to also cover DNS
 * rebinding), redirects followed manually so every hop is re-validated the
 * same way, and the response body capped in size while streaming.
 */
export async function fetchRecipeHtml(rawUrl: string): Promise<FetchRecipeResult> {
  const initial = validateRecipeUrl(rawUrl);
  if (!initial.ok) return initial;

  let currentUrl = initial.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = await assertResolvesToPublicAddress(currentUrl.hostname);
    if (!safe) return { ok: false, error: "blockedHost" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "HouseholdHubRecipeImporter/1.0" },
      });
    } catch {
      return { ok: false, error: "fetchFailed" };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, error: "fetchFailed" };
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return { ok: false, error: "invalidUrl" };
      }
      const nextValidated = validateRecipeUrl(nextUrl.toString());
      if (!nextValidated.ok) return nextValidated;
      currentUrl = nextValidated.url;
      continue;
    }

    if (!response.ok) return { ok: false, error: "fetchFailed" };

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      return { ok: false, error: "tooLarge" };
    }

    try {
      const html = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);
      return { ok: true, html };
    } catch {
      return { ok: false, error: "tooLarge" };
    }
  }

  return { ok: false, error: "tooManyRedirects" };
}
