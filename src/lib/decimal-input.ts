// UX-30: money and quantity fields are `type="text" inputMode="decimal"`,
// not `type="number"`. With a Swedish region, iOS's decimal keypad offers
// only ",", and WebKit treats "12,5" in a number input as invalid and
// submits "" — so the amount was lost without a word. A text input keeps
// what was typed, and this module reads it the same way on both sides:
// the server normalises FormData before Zod (`normalizeDecimal`), and
// client previews (split sums, the "Saved 12,50 kr" toast, live totals)
// parse with `parseDecimal`, so a preview never disagrees with what saves.
//
// The rules, deliberately small so nothing is guessed:
// - Leading, trailing and inner whitespace is dropped, including the
//   no-break and narrow no-break spaces Swedish formatting puts between
//   thousands, so "1 234,5" (as sv-SE prints it, or pasted) reads 1234.5.
// - One "," with no "." is the decimal separator: "12,5" → 12.5.
// - Anything with both separators, or more than one comma ("1,234.5",
//   "1.234,5", "1,2,3"), fails as not-a-number rather than having one
//   of them read as a thousands separator. "1,234" is therefore
//   1.234: a decimal comma, which is what a Swedish user means by it.
// - Anything else that isn't a plain decimal ("abc", and the "0x10" or
//   "1e3" that `Number` would happily read) becomes NaN, which every
//   schema rejects. A leading "-" is kept so a schema's own
//   "can't be negative" message still applies.

/** The `pattern` for a decimal text field: digits with optional spaces
 * between them, then at most one "." or "," and more digits, or just
 * ",5". Written for the `v` flag browsers compile `pattern` with (no bare
 * "-" or "|" inside a class). Only forms that let the browser validate
 * enforce it; the noValidate forms rely on the server's Zod check. */
export const DECIMAL_PATTERN = String.raw`\s*\d[\d\s]*([.,]\d*)?\s*|\s*[.,]\d+\s*`;

/**
 * A typed decimal as the dot-decimal string `Number` and `z.coerce.number()`
 * read, by the rules above, or NaN when it isn't a decimal. A non-string
 * (a missing FormData field's null, a number) is returned unchanged, so it
 * can sit in front of any existing schema without changing how empty or
 * missing values are treated: "" stays "" and still coerces to 0 or fails
 * `.positive()` as before.
 */
export function normalizeDecimal(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const compact = value.replace(/\s+/g, "");
  const dotted = !compact.includes(".") && compact.split(",").length === 2 ? compact.replace(",", ".") : compact;
  return dotted === "" || /^-?(\d+\.?\d*|\.\d+)$/.test(dotted) ? dotted : Number.NaN;
}

/** The number in a typed decimal, or NaN when it isn't one. Unlike
 * `Number("")`, an empty or blank field is NaN, not 0. */
export function parseDecimal(raw: string): number {
  const normalized = normalizeDecimal(raw);
  return normalized === "" ? Number.NaN : Number(normalized);
}

/**
 * `normalizeDecimal` for money: the same, except that a value with more
 * than two decimals once normalised is NaN. A comma before three digits is
 * a decimal in a quantity (1,250 kg), but money never has three decimals,
 * and an English-locale user typing rent as "1,200" means twelve hundred:
 * reading it as 1.2 would save a thousandth of the amount without a word.
 * So "1,200" (and "1.200", "12,505") is turned down by the schema, while
 * "12,5", "12,50" and "1 200,50" are read as typed. Every amount, split
 * share and payment, settlement, limit and goal goes through it, on the
 * server and in the client's previews, so a preview never shows a number
 * that won't save.
 */
export function normalizeMoney(value: unknown): unknown {
  const normalized = normalizeDecimal(value);
  return typeof normalized === "string" && /\.\d{3,}$/.test(normalized) ? Number.NaN : normalized;
}

/** `parseDecimal` for money (see normalizeMoney): NaN for a blank field,
 * text, and anything with more than two decimals. */
export function parseMoney(raw: string): number {
  const normalized = normalizeMoney(raw);
  return normalized === "" ? Number.NaN : Number(normalized);
}
