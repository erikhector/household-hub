// Recipe import from URL — pure parsing logic (JSON-LD extraction, ingredient
// splitting, instruction flattening) plus the SSRF-guarding URL validation and
// fetch used by importRecipeFromUrlAction
// (src/app/dashboard/meal-planning/recipe-actions.ts). The parsing functions below
// take no network dependency and are unit-tested with inline HTML/JSON
// fixtures in recipe-import.test.ts; fetchRecipeHtml is the only part that
// touches the network — recipe-import.test.ts mocks node:dns/node:http/
// node:https to exercise its SSRF/DNS-rebinding guard and its size/timeout
// handling without a real connection.
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
import { promises as dns, type LookupAddress, type LookupOptions } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import { tagsFromSchemaOrgDiet, type RecipeTag } from "@/lib/recipe-tags";

// `note` is the preparation text split off the name ("finhackad", "gärna
// lätt", a "2–3" range); `rawText` is the line exactly as the site wrote it
// (whitespace collapsed). Both are optional so hand-built rows stay valid.
export type ParsedIngredient = { name: string; quantity: number; unit: string; note?: string; rawText?: string };
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
// `tags` (GAP-29) only ever comes from the JSON-LD tier's
// `suitableForDiet` — it's the site's own structured claim, mapped through
// the closed set in recipe-tags.ts. The Microdata and heading-heuristic
// tiers are already guesses, so they never guess a diet on top and always
// return [].
export type ImportedRecipe = ParsedRecipe & { source: RecipeImportSource; tags: RecipeTag[] };

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

// Unicode vulgar fractions as recipe sites write them ("½ tsk salt",
// "1½ dl mjölk"). Anything outside this map is left alone, so the line
// falls back to the whole-text name rather than a wrong number.
const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 1 / 2,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅕": 1 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};
const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");
const UNICODE_QUANTITY_RE = new RegExp(`^(\\d*)\\s*([${FRACTION_CHARS}])$`);

function parseLeadingQuantity(raw: string): number | null {
  const unicode = raw.match(UNICODE_QUANTITY_RE);
  if (unicode) {
    const whole = unicode[1] ? Number(unicode[1]) : 0;
    return whole + UNICODE_FRACTIONS[unicode[2]];
  }
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
  // English thousands separators ("1,000 g") — see NUMBER_SRC for why only
  // this exact shape counts as one.
  if (THOUSANDS_RE.test(raw)) return Number(raw.replace(/,/g, ""));
  // Swedish sites write decimals with a comma ("1,5 dl"). The number pattern
  // only lets a comma through when digits follow it, so a prep-note comma
  // ("1, finhackad") never gets here.
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// "1,000" / "12,500": a non-zero lead of 1–3 digits, then groups of exactly
// three. Read as thousands, not as a Swedish decimal, because a recipe
// amount with three decimals ("1,500 kg") is far rarer than an English
// "1,000 g", and reading that as 1 g would be silently wrong. A leading zero
// ("0,125 l") stays a decimal.
const THOUSANDS_SRC = "[1-9]\\d{0,2}(?:,\\d{3})+(?![\\d,])";
const THOUSANDS_RE = new RegExp(`^${THOUSANDS_SRC}$`);

// One quantity: "1½" / "1 ½", "1 1/2", "1/2", "1,000", "1.5" / "1,5", "3",
// or a bare "½". Order matters — the longer forms must be tried before a
// plain integer so "1 1/2" isn't read as "1" followed by the name "1/2 cup
// …".
const NUMBER_SRC = `(?:\\d+\\s*[${FRACTION_CHARS}]|\\d+\\s+\\d+/\\d+|\\d+/\\d+|${THOUSANDS_SRC}|\\d+(?:[.,]\\d+)?|[${FRACTION_CHARS}])`;
// An optional approximation word ("ca 500 g", "about 2 cups", "ungefär 1
// dl") — the amount is used as-is, the hedge is dropped. Then the quantity,
// an optional range upper bound ("2-3", "2–3", "2 - 3"), and the rest, with
// no space required so a unit glued to the number ("500g", "2dl") still
// lands at the start of the rest.
const LEADING_QUANTITY_RE = new RegExp(
  `^(?:(?:ca\\.?|c:a|cirka|ungefär|about|approx\\.?|approximately)\\s+)?(${NUMBER_SRC})(?:\\s*[-–—]\\s*(${NUMBER_SRC}))?\\s*(.*)$`,
  "i",
);

// Preparation words that sites put in front of the ingredient ("finhackad
// gul lök", "finely chopped onion") and that are moved to the note. Kept to
// words that never name a product you buy: "krossade tomater", "riven ost",
// "skivad mandel", "hackade tomater", "crushed red pepper", "minced garlic"
// and "chopped tomatoes" are all packaged goods, and stripping them would
// link to the wrong item (fresh tomatoes, cheese, the vegetable). Anything
// else stays in the name; a prep note after a comma or in parentheses is
// still split off.
const PREP_ADJECTIVES = new Set(["finhackad", "finhackade", "grovhackad", "grovhackade", "pressad", "pressade"]);
// Two-word forms: a degree adverb makes it plain this is preparation, even
// though the bare participle ("chopped tomatoes", "hackade tomater") can be
// a product.
const PREP_ADVERBS = new Set(["fint", "grovt", "finely", "roughly", "coarsely"]);
const PREP_ADVERB_TARGETS = new Set(["hackad", "hackade", "chopped"]);

function takeLeadingPrep(name: string): { name: string; prep: string | null } {
  const words = name.split(" ");
  let i = 0;
  while (i < words.length) {
    const word = words[i].toLowerCase();
    if (PREP_ADJECTIVES.has(word)) i += 1;
    else if (PREP_ADVERBS.has(word) && PREP_ADVERB_TARGETS.has(words[i + 1]?.toLowerCase() ?? "")) i += 2;
    else break;
  }
  // Never strip the whole name ("finhackad" alone is still what the line says).
  if (i === 0 || i >= words.length) return { name, prep: null };
  return { name: words.slice(i).join(" "), prep: words.slice(0, i).join(" ") };
}

// Pulls every "(…)" out of the text, returning what's left (whitespace
// collapsed) and the non-empty insides in order.
function takeParentheses(text: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const rest = text.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return " ";
  });
  return { text: rest.replace(/\s+/g, " ").trim(), notes };
}

/**
 * Split the name part of an ingredient line into the thing itself and a
 * preparation note: everything inside parentheses, everything after the
 * first comma, and a leading prep-adjective list all go to the note
 * ("gul lök, finhackad" → "gul lök" + "finhackad"). If that would leave no
 * name, the text is kept whole.
 */
function splitNote(text: string): { name: string; notes: string[] } {
  const parens = takeParentheses(text);
  const notes = [...parens.notes];
  let name = parens.text;
  const comma = name.indexOf(",");
  if (comma !== -1) {
    const after = name.slice(comma + 1).trim();
    if (after) notes.push(after);
    name = name.slice(0, comma).trim();
  }
  const prep = takeLeadingPrep(name);
  if (prep.prep) {
    notes.unshift(prep.prep);
    name = prep.name;
  }
  if (!name) return { name: text, notes: [] };
  return { name, notes };
}

function withNote(ingredient: ParsedIngredient, notes: string[]): ParsedIngredient {
  return notes.length > 0 ? { ...ingredient, note: notes.join(", ") } : ingredient;
}

/**
 * Best-effort split of a schema.org `recipeIngredient` string (e.g.
 * "2 cups flour", "1 1/2 tbsp olive oil", "1,5 dl mjölk", "2-3
 * vitlöksklyftor", "1 gul lök, finhackad") into quantity/unit/name plus a
 * preparation `note`. `rawText` keeps the original line. Falls back to
 * putting the whole string in `name` with quantity 1 whenever it can't
 * confidently split — never guesses wrong. This parses exactly one
 * ingredient; use `parseIngredientLine` for lines that can hold two
 * ("salt och peppar").
 */
export function parseIngredientString(raw: string): ParsedIngredient {
  const rawText = raw.trim().replace(/\s+/g, " ");
  if (!rawText) return { name: "", quantity: 1, unit: "pcs" };
  // U+2044 FRACTION SLASH ("1⁄2") reads as an ordinary slash.
  const trimmed = rawText.replace(/⁄/g, "/");

  const whole = (): ParsedIngredient => {
    const { name, notes } = splitNote(trimmed);
    return withNote({ name, quantity: 1, unit: "pcs", rawText }, notes);
  };

  const match = trimmed.match(LEADING_QUANTITY_RE);
  if (!match) return whole();

  const [, lowRaw, highRaw, restRaw] = match;
  // Parentheses come out before the unit check, so a pack size between the
  // number and the unit ("1 (400 g) burk tomater") doesn't hide the unit.
  const { text: rest, notes: parenNotes } = takeParentheses(restRaw);
  const low = parseLeadingQuantity(lowRaw);
  const high = highRaw ? parseLeadingQuantity(highRaw) : null;
  if (low === null || low <= 0 || (highRaw && (high === null || high <= 0)) || !rest) return whole();

  // A range ("2-3 vitlöksklyftor") buys the upper bound — better one clove
  // left over than one short — and keeps the range itself in the note.
  const quantity = high !== null ? Math.max(low, high) : low;
  const rangeNote = highRaw ? [`${lowRaw}–${highRaw}`] : [];

  const restWords = rest.split(" ");
  const firstWord = restWords[0]?.toLowerCase().replace(/[.,]$/, "") ?? "";
  const hasUnit = KNOWN_UNITS.has(firstWord) && restWords.length > 1;
  const unit = hasUnit ? firstWord : "pcs";
  const nameText = (hasUnit ? restWords.slice(1).join(" ") : rest).trim();

  const { name, notes } = splitNote(nameText);
  return withNote({ name, quantity, unit, rawText }, [...rangeNote, ...parenNotes, ...notes]);
}

// "Salt och peppar" / "salt and pepper" / "salt, peppar" is two things in
// the pantry, so it becomes two rows. Only this fixed pair: a general "X och
// Y" split would break real names like "sweet and sour sauce".
const SALT_SRC = "salt|flingsalt|havssalt|sea salt";
const PEPPER_SRC = "(?:svart|vit)?peppar|(?:black |white )?pepper";
const SALT_AND_PEPPER_RE = new RegExp(`^(${SALT_SRC})\\s+(?:och|and|&)\\s+(${PEPPER_SRC})$`, "i");
const SALT_RE = new RegExp(`^(?:${SALT_SRC})$`, "i");
const PEPPER_RE = new RegExp(`^(?:${PEPPER_SRC})$`, "i");

/**
 * Parse one ingredient line into one or more rows: `parseIngredientString`,
 * plus splitting "salt och peppar" into a salt row and a pepper row (both
 * keep the line's quantity, unit, note and `rawText`).
 */
export function parseIngredientLine(raw: string): ParsedIngredient[] {
  const parsed = parseIngredientString(raw);
  const pair = parsed.name.match(SALT_AND_PEPPER_RE);
  if (pair) {
    return [
      { ...parsed, name: pair[1] },
      { ...parsed, name: pair[2] },
    ];
  }
  // "Salt, peppar": the comma split already made "peppar" the start of the
  // note, so take it back out as the second row.
  if (SALT_RE.test(parsed.name) && parsed.note) {
    const [first, ...others] = parsed.note.split(", ");
    if (PEPPER_RE.test(first)) {
      const salt = withNote({ name: parsed.name, quantity: parsed.quantity, unit: parsed.unit, rawText: parsed.rawText }, others);
      return [salt, { ...salt, name: first }];
    }
  }
  return [parsed];
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
    .flatMap(parseIngredientLine);

  const instructions = flattenInstructions(node.recipeInstructions);

  return { name, instructions, ingredients };
}

function hasAnyContent(recipe: ParsedRecipe): boolean {
  return Boolean(recipe.name || recipe.ingredients.length > 0 || recipe.instructions);
}

function parseJsonLdRecipe(html: string): (ParsedRecipe & { tags: RecipeTag[] }) | null {
  const node = findRecipeNode(extractJsonLdBlocks(html));
  if (!node) return null;
  const recipe = mapJsonLdToRecipe(node);
  return hasAnyContent(recipe) ? { ...recipe, tags: tagsFromSchemaOrgDiet(node.suitableForDiet) } : null;
}

/**
 * End-to-end pure parse: raw page HTML -> an ImportedRecipe, or null if
 * nothing recipe-shaped could be found. Tries JSON-LD, then Microdata, then
 * the heading heuristic (see the header comment), stopping at the first
 * tier that yields something usable.
 */
export function parseRecipeFromHtml(html: string): ImportedRecipe | null {
  const recipe = extractRecipe(html);
  return recipe ? { ...recipe, ingredients: recipe.ingredients.map(toFormRow) } : null;
}

function extractRecipe(html: string): ImportedRecipe | null {
  const jsonLd = parseJsonLdRecipe(html);
  if (jsonLd) return { ...jsonLd, source: "jsonld" };

  // Everything below reads visible markup, so drop scripts/styles/comments
  // first — otherwise a `<ul>` inside an inline template string or a
  // commented-out block could be mistaken for the ingredient list.
  const content = stripNonContent(html);

  const microdata = parseMicrodataRecipe(content);
  if (microdata) return { ...microdata, source: "microdata", tags: [] };

  const heuristic = parseHeuristicRecipe(content);
  if (heuristic) return { ...heuristic, source: "heuristic", tags: [] };

  return null;
}

// The recipe form has no note field yet (RecipeIngredient.note arrives with
// MATCH-2), so until then the note rides along in the name as a trailing
// "(…)" so the user sees it. This relies on MATCH-1's matcher
// (src/lib/recipes/ingredient-match.ts), which ignores a trailing
// parenthesized part so "gul lök (finhackad)" still links to "Gul lök";
// without it the save path's exact-name lookup would create a new item for
// every row with a note, so MATCH-1 must merge before (or with) this. The
// parsed rows above keep name and note apart for when the column lands.
function toFormRow({ note, ...row }: ParsedIngredient): ParsedIngredient {
  return note ? { ...row, name: `${row.name} (${note})` } : row;
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
  const ingredients = (rawIngredients.length > 0 ? rawIngredients : propValues("ingredients", false)).flatMap(
    parseIngredientLine,
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
    .flatMap(parseIngredientLine)
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

// A `net.connect`-compatible `lookup` error code for "this hostname
// resolves to a private/reserved address" — distinct from Node's own
// ENOTFOUND/etc. so fetchRecipeHtml's catch block can tell a blocked host
// apart from a plain connection failure and report "blockedHost" instead of
// a generic "fetchFailed".
const EBLOCKEDHOST = "EBLOCKEDHOST";

// Test-only seam (SEC-2): recipe-import.test.ts fakes node:http/https to
// exercise most of fetchRecipeHtml without a real connection, but that
// can't by itself prove createPinnedPublicLookup satisfies Node's *real*
// lookup contract (the fake only does what it's coded to do). Proving that
// means running a real `http.createServer` round trip through real
// `http.request` — which means the target has to be loopback, and loopback
// is exactly what this function exists to block. This override lets a test
// swap in a different private-address check for that one round trip
// (mocking `dns.lookup` to point at the local test server, and this to
// treat that address as "public" for the purpose of the test) while
// everything else — the real Node `lookup` contract, the real connect,
// the real body read — stays real. Never touched outside tests; always
// null in production.
type PrivateAddressCheck = (address: string, family: number) => boolean;
let privateAddressCheckOverride: PrivateAddressCheck | null = null;
export function _setPrivateAddressCheckForTests(check: PrivateAddressCheck | null): void {
  privateAddressCheckOverride = check;
}
function isPrivateOrReservedAddress(address: string, family: number): boolean {
  if (privateAddressCheckOverride) return privateAddressCheckOverride(address, family);
  return family === 4 ? isPrivateOrReservedIPv4(address) : isPrivateOrReservedIPv6(address);
}

/**
 * A `net.connect`-compatible `lookup` for `http(s).request`, pinning DNS
 * resolution to the exact address the socket goes on to connect to (SEC-2).
 *
 * The previous version resolved the hostname once up front to check it was
 * public (`dns.lookup` in `assertResolvesToPublicAddress`), then let
 * `fetch` resolve the *same hostname again* to actually connect. Those are
 * two independent DNS queries, and a TTL-0 or otherwise hostile DNS server
 * can answer them differently — return a public address the first time
 * (passing the check) and a private one (`127.0.0.1`, the cloud metadata
 * address `169.254.169.254`, …) the second, which is exactly what the
 * socket then connects to. This is the standard DNS-rebinding SSRF bypass.
 *
 * Passing this function as `lookup` to `http(s).request` means the
 * request's *only* resolution is this one, and Node connects to whichever
 * address it hands back — so validating here is validating what's actually
 * connected to, with no gap for a second query to answer differently in.
 *
 * `dns.lookup(..., { all: true })` can return several records (multiple A
 * results, A + AAAA, …), and Node tries them in order until one connects —
 * so every record must be checked, not just the first, or a rebinding
 * attacker could list a public "decoy" address alongside a private one and
 * rely on the client eventually trying the private one.
 *
 * This must follow `dns.lookup`'s own callback contract, not a simplified
 * one, because Node calls it that way whether we like it or not: `net`'s
 * `autoSelectFamily` (on by default since Node 20) makes `http(s).request`
 * always call `lookup` with `{ all: true, ... }` so it can attempt multiple
 * resolved addresses (Happy Eyeballs) — never the single
 * `(address, family)` shape. A `lookup` that always calls back with a
 * single address regardless of `options.all` breaks *every* request with
 * `ERR_INVALID_IP_ADDRESS` (address undefined), because Node passes that
 * single value through `isIP()` expecting the array shape it asked for.
 * `options.family` (4 or 6) is honored too, the same way `dns.lookup`
 * itself would filter, when a caller asks for just one.
 */
function normalizeFamily(family: LookupOptions["family"]): number {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return family || 0; // 0 (or unset) means "either"
}

function createPinnedPublicLookup(): (
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true }).then(
      (records) => {
        if (records.length === 0) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
          return;
        }
        // Every resolved record must be validated, regardless of which
        // family the caller ends up wanting — an attacker could otherwise
        // hide a private address behind a family Node didn't ask for this
        // time (e.g. it wants AAAA now, A later) and have it validated as
        // "safe" simply because it wasn't looked at.
        const blocked = records.some((record) => isPrivateOrReservedAddress(record.address, record.family));
        if (blocked) {
          callback(
            Object.assign(new Error(`${hostname} resolves to a private/reserved address`), {
              code: EBLOCKEDHOST,
            }),
            "",
          );
          return;
        }

        const wantFamily = normalizeFamily(options.family);
        const matching = wantFamily ? records.filter((record) => record.family === wantFamily) : records;
        if (matching.length === 0) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
          return;
        }

        if (options.all) {
          callback(
            null,
            matching.map((record) => ({ address: record.address, family: record.family })),
          );
        } else {
          callback(null, matching[0].address, matching[0].family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, ""),
    );
  };
}

const RECIPE_IMPORT_USER_AGENT = "HouseholdHubRecipeImporter/1.0";

type RawHttpResponse = { statusCode: number; headers: http.IncomingHttpHeaders; body: IncomingMessage };

/** One GET with DNS pinned via createPinnedPublicLookup; redirects are left for the caller to follow manually. */
function requestOnce(url: URL, signal: AbortSignal): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { "user-agent": RECIPE_IMPORT_USER_AGENT },
        // Forces a fresh socket (and so a fresh `lookup` call) for this
        // request — a pooled keep-alive socket from an earlier request
        // could otherwise be reused for a different hop's hostname without
        // ever going through `lookup` again.
        agent: false,
        lookup: createPinnedPublicLookup(),
        signal,
      },
      (res) => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    req.on("error", reject);
    req.end();
  });
}

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB — plenty for a recipe page's HTML
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 8000;

/** Reads a Node response stream up to `limitBytes`, destroying it and rejecting once exceeded. */
function readBodyWithLimit(body: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    body.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        body.destroy();
        reject(new Error("tooLarge"));
        return;
      }
      chunks.push(chunk);
    });
    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    body.on("error", reject);
  });
}

export type FetchRecipeError =
  | UrlValidationError
  | "fetchFailed"
  | "tooLarge"
  | "tooManyRedirects";
export type FetchRecipeResult = { ok: true; html: string } | { ok: false; error: FetchRecipeError };

/**
 * Fetches a user-supplied recipe URL server-side, guarding against SSRF:
 * only http(s), never a private/loopback/link-local/reserved IP (checked as
 * a literal in the URL by validateRecipeUrl, and after DNS resolution by
 * createPinnedPublicLookup — see its comment for why that's the *same*
 * lookup used to connect, closing the DNS-rebinding gap a separate
 * check-then-fetch resolution would leave open), redirects followed
 * manually so every hop is re-validated the same way, and the response
 * body capped in size while streaming.
 *
 * Built on node:http/https rather than `fetch` specifically so the lookup
 * that *validates* a hostname is the one that *connects* to it (fetch/undici
 * has no supported hook for that short of constructing an `undici.Agent`,
 * and undici isn't a direct dependency here). One consequence: this doesn't
 * send `Accept-Encoding`, so responses arrive uncompressed instead of via
 * fetch's automatic gzip/br negotiation — heavier over the wire, but this
 * fetches one page per import and MAX_RESPONSE_BYTES still applies.
 *
 * The abort timer set per hop stays armed through the body read below, not
 * just until headers arrive — a slow-drip response has nothing else to cut
 * it off past FETCH_TIMEOUT_MS otherwise (SEC-2).
 */
export async function fetchRecipeHtml(rawUrl: string): Promise<FetchRecipeResult> {
  const initial = validateRecipeUrl(rawUrl);
  if (!initial.ok) return initial;

  let currentUrl = initial.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await requestOnce(currentUrl, controller.signal);

      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.body.resume(); // discard the redirect's own body, if any
        const location = response.headers.location;
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

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.resume();
        return { ok: false, error: "fetchFailed" };
      }

      const contentLength = response.headers["content-length"];
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        response.body.resume();
        return { ok: false, error: "tooLarge" };
      }

      try {
        const html = await readBodyWithLimit(response.body, MAX_RESPONSE_BYTES);
        return { ok: true, html };
      } catch {
        return { ok: false, error: "tooLarge" };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === EBLOCKEDHOST) return { ok: false, error: "blockedHost" };
      return { ok: false, error: "fetchFailed" };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, error: "tooManyRedirects" };
}
