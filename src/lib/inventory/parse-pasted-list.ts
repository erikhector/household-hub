// Turns a freeform "brain dump" into structured rows — one item per line, or
// per comma within a line, so "2 cans tomatoes, milk, AA batteries x8" and
// three separate lines parse the same way. Deliberately simple: this only
// needs to save the common cases (a leading count, a trailing "x8") from
// being retyped in the review step, not parse every possible phrasing —
// anything it gets wrong is still editable there before anything is saved.

export type ParsedItem = { name: string; quantity: number; unit: string };

// Recognized unit words directly after a leading count, e.g. "2 cans
// tomatoes" — stripped out into `unit` instead of staying part of the name.
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
  "g",
  "l",
  "ml",
]);

const LEADING_COUNT = /^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+(.+)$/i;
const TRAILING_COUNT = /^(.+?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)$/i;

function parseLine(raw: string): ParsedItem | null {
  const line = raw.trim();
  if (!line) return null;

  const trailing = line.match(TRAILING_COUNT);
  if (trailing) {
    const name = trailing[1].trim();
    const quantity = Number(trailing[2].replace(",", "."));
    if (name && Number.isFinite(quantity) && quantity > 0) {
      return { name, quantity, unit: "pcs" };
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
