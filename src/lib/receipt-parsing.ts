// Pure, dependency-free parsing of OCR'd receipt text into candidate line
// items — used by ReceiptScanDialog (src/components/shopping/
// receipt-scan-dialog.tsx) after Tesseract.js extracts raw text from a
// photo client-side. Kept free of any OCR/DOM dependency so it's
// unit-testable with plain fixture strings, same convention as
// item-matching.ts / recipe-import.ts.
//
// This is deliberately a heuristic, not a real receipt-format parser: real
// receipts vary wildly by store/country/printer. It optimizes for the
// common case (one item name, one trailing total price per line) and skips
// anything it isn't confident about — a missed line is just an item the
// user adds/matches manually, same as today; a wrongly-parsed line is
// reviewed and can be corrected/skipped in ReceiptScanDialog before
// anything is written to the database.

export type ParsedReceiptLine = {
  rawLine: string;
  name: string;
  /** From a leading "2 x " / "2× " prefix; 1 when none is present. Purely
   * informational for the review UI — the shopping-list item's own
   * quantity (not this) is what applyReceiptScanAction uses to adjust
   * inventory, same as togglePurchasedAction always has. */
  quantity: number;
  price: number;
};

// Line-level boilerplate that should never be treated as a purchased item,
// even though it often carries a trailing amount (a subtotal, the VAT
// breakdown, the card payment line, ...). Matched case-insensitively as a
// substring anywhere in the line. Swedish + English, covering the two
// locales this app ships (src/lib/i18n/dictionaries).
const BOILERPLATE_SUBSTRINGS = [
  "subtotal",
  "total",
  "summa",
  "moms",
  "vat",
  "tax",
  "kort",
  "card",
  "visa",
  "mastercard",
  "swish",
  "cash",
  "kontant",
  "växel",
  "change",
  "rabatt",
  "discount",
  "avrundning",
  "rounding",
  "tack",
  "thank",
  "kvitto",
  "receipt",
  "referens",
  "reference",
  "org.nr",
  "kassa",
  "butik",
  "store",
  "datum",
  "date",
  "bonus",
  "medlem",
  "member",
];

function isBoilerplate(line: string): boolean {
  const lower = line.toLowerCase();
  return BOILERPLATE_SUBSTRINGS.some((s) => lower.includes(s));
}

// A trailing amount: 1-3 digits, optionally thousands-grouped by a space or
// dot/comma, then a decimal separator (`.` or `,`) and exactly 2 digits —
// real prices are printed with cents, which is what distinguishes them from
// a bare quantity/weight/barcode elsewhere on the line. An optional
// currency token (symbol or code) may follow.
const TRAILING_PRICE_RE =
  /(-?\d{1,3}(?:[ .,]?\d{3})*[.,]\d{2})\s*(kr|sek|:-|eur|usd|gbp|dkk|nok|chf|€|\$|£)?\s*$/i;

const LEADING_QUANTITY_RE = /^(\d+(?:[.,]\d+)?)\s*[x×]\s+(.+)$/i;

/** Parses a European- or US-formatted amount ("1 234,56", "1,234.56",
 * "163,17", "19.90") into a plain number. Whichever of `,`/`.` appears
 * *last* is taken as the decimal separator; the other (if present) is
 * assumed to be a thousands separator and stripped. */
function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseLine(rawLine: string): ParsedReceiptLine | null {
  const trimmed = rawLine.trim();
  if (!trimmed || isBoilerplate(trimmed)) return null;

  const priceMatch = trimmed.match(TRAILING_PRICE_RE);
  if (!priceMatch || priceMatch.index === undefined) return null;

  const price = parseAmount(priceMatch[1]);
  if (price === null || price <= 0) return null;

  let rest = trimmed.slice(0, priceMatch.index).trim();

  let quantity = 1;
  const qtyMatch = rest.match(LEADING_QUANTITY_RE);
  if (qtyMatch) {
    const parsedQty = Number(qtyMatch[1].replace(",", "."));
    if (Number.isFinite(parsedQty) && parsedQty > 0) quantity = parsedQty;
    rest = qtyMatch[2].trim();
  }

  const name = rest.replace(/\s{2,}/g, " ").trim();
  if (name.length < 2) return null;

  return { rawLine: trimmed, name, quantity, price };
}

/** Every line in OCR'd receipt text that looks like a purchased item with a
 * price — boilerplate (totals, VAT, payment method, ...) and lines with no
 * confidently-parseable trailing price are silently dropped. */
export function parseReceiptText(text: string): ParsedReceiptLine[] {
  return text
    .split(/\r?\n/)
    .map(parseLine)
    .filter((line): line is ParsedReceiptLine => line !== null);
}

const CURRENCY_TOKENS: Record<string, string> = {
  kr: "SEK",
  sek: "SEK",
  ":-": "SEK",
  eur: "EUR",
  "€": "EUR",
  usd: "USD",
  $: "USD",
  gbp: "GBP",
  "£": "GBP",
  dkk: "DKK",
  nok: "NOK",
  chf: "CHF",
};

const CURRENCY_TOKEN_RE = /(kr|sek|:-|eur|usd|gbp|dkk|nok|chf|€|\$|£)/gi;

/** The most frequent currency symbol/code seen anywhere in the receipt
 * text, or `fallback` (typically HOUSEHOLD_BASE_CURRENCY) if none appear —
 * a whole receipt is essentially always one currency, so this is a
 * receipt-level guess rather than something computed per line. */
export function detectReceiptCurrency(text: string, fallback: string): string {
  const counts = new Map<string, number>();

  for (const match of text.matchAll(CURRENCY_TOKEN_RE)) {
    const code = CURRENCY_TOKENS[match[1].toLowerCase()];
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }

  return best ?? fallback;
}
