import type { ParsedIngredient } from "./types";

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

