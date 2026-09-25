// Turns a freeform "brain dump" into structured rows — one item per line, or
// per comma within a line, so "2 cans tomatoes, milk, AA batteries x8" and
// three separate lines parse the same way. Deliberately simple: this only
// needs to save the common cases (a leading count, a trailing "x8", or a
// trailing "count unit" like the Swedish grocery-app share/export text this
// also feeds — see ImportListDialog — tends to use: "Mjölk 1 l", "Ägg 12
// st") from being retyped in the review step, not parse every possible
// phrasing — anything it gets wrong is still editable there before anything
// is saved.

export type ParsedItem = { name: string; quantity: number; unit: string };

// Recognized unit words directly after a leading count ("2 cans tomatoes")
// or before a trailing count ("Ägg 12 st") — stripped out into `unit`
// instead of staying part of the name. Includes the Swedish words a
// Swedish-locale household is likely to paste (ICA's shared/exported lists
// among them), alongside the English ones.
const UNIT_WORDS = new Set([
  "pcs",
  "pc",
  "piece",
  "pieces",
  "can",
  "cans",
  "bottle",
  "bottles",
  "bag",
  "bags",
  "box",
  "boxes",
  "pack",
  "packs",
  "packet",
  "packets",
  "carton",
  "cartons",
  "roll",
  "rolls",
  "jar",
  "jars",
  "bunch",
  "bunches",
  "kg",
  "hg",
  "g",
  "l",
  "dl",
  "cl",
  "ml",
  // Swedish
  "st",
  "styck",
  "förp",
  "förpackning",
  "förpackningar",
  "paket",
  "burk",
  "burkar",
  "påse",
  "påsar",
  "flaska",
  "flaskor",
  "låda",
  "lådor",
  "rulle",
  "rullar",
  "bunt",
  "buntar",
]);

/** Whether `word` is one of the unit words the parser strips into `unit` —
 * voice add (normalizeVoiceTranscript) uses it to know a spoken number
 * belongs to a unit even when the number isn't first in the item. */
export function isUnitWord(word: string): boolean {
  return UNIT_WORDS.has(word.toLowerCase());
}

// Strips a leading bullet/checkbox marker some apps' share text uses
// ("- Mjölk", "• Ägg", "[ ] Bröd", "☐ Smör", "✓ Ost") before the count/unit
// patterns below ever see the line.
const LEADING_MARKER = /^(?:[-*•]|\[\s?[xX]?\s?\]|[☐☑✓✔])\s*/;

const LEADING_COUNT = /^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+(.+)$/i;
const TRAILING_COUNT = /^(.+?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)$/i;
const TRAILING_COUNT_UNIT = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*([^\s\d,]+)$/;

function parseLine(raw: string): ParsedItem | null {
  const line = raw.trim().replace(LEADING_MARKER, "").trim();
  if (!line) return null;

  const trailing = line.match(TRAILING_COUNT);
  if (trailing) {
    const name = trailing[1].trim();
    const quantity = Number(trailing[2].replace(",", "."));
    if (name && Number.isFinite(quantity) && quantity > 0) {
      return { name, quantity, unit: "pcs" };
    }
  }

  const trailingUnit = line.match(TRAILING_COUNT_UNIT);
  if (trailingUnit) {
    const name = trailingUnit[1].trim();
    const quantity = Number(trailingUnit[2].replace(",", "."));
    const unit = trailingUnit[3].toLowerCase();
    if (name && Number.isFinite(quantity) && quantity > 0 && UNIT_WORDS.has(unit)) {
      return { name, quantity, unit };
    }
  }

  const leading = line.match(LEADING_COUNT);
  if (leading) {
    const quantity = Number(leading[1].replace(",", "."));
    const rest = leading[2].trim();
    if (Number.isFinite(quantity) && quantity > 0 && rest) {
      const [firstWord, ...restWords] = rest.split(/\s+/);
      if (restWords.length > 0 && UNIT_WORDS.has(firstWord.toLowerCase())) {
        return { name: restWords.join(" "), quantity, unit: firstWord.toLowerCase() };
      }
      return { name: rest, quantity, unit: "pcs" };
    }
  }

  return { name: line, quantity: 1, unit: "pcs" };
}

export function parsePastedList(input: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const line of input.split(/\n+/)) {
    for (const segment of line.split(",")) {
      const parsed = parseLine(segment);
      if (parsed) items.push(parsed);
    }
  }
  return items;
}
