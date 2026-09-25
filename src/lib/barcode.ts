// Pure barcode-format validation, split out of src/lib/actions/barcode.ts
// (a "use server" file, which may only export async functions) so it's
// unit-testable without mocking anything — same reasoning the recipe-import
// and missing-ingredients tasks use for their own pure helpers.

// EAN-8/UPC-E through EAN-13/UPC-A/GTIN-14 are all plain digit strings in
// this length range. Anything else isn't a barcode format Open Food Facts
// (or this app's decoder) deals in, so it's rejected before ever making a
// network call.
const BARCODE_PATTERN = /^\d{6,14}$/;

export function isValidBarcodeFormat(barcode: string): boolean {
  return BARCODE_PATTERN.test(barcode.trim());
}

// The storage/lookup key for a scanned code (AUTO-6). The same physical
// UPC-A product can come back from the decoder as 12 digits (`upc_a`) or as
// the equivalent 13-digit EAN with a leading zero (`ean_13`), depending on
// which format the frame happened to match first — padding 12-digit codes
// to GTIN-13 makes both resolve to the one row. Everything else (EAN-13,
// EAN-8, UPC-E, GTIN-14) is stored as scanned. Returns null for anything
// that isn't barcode-shaped, so callers can't persist junk.
export function normalizeBarcode(barcode: string): string | null {
  const trimmed = barcode.trim();
  if (!isValidBarcodeFormat(trimmed)) return null;
  return trimmed.length === 12 ? `0${trimmed}` : trimmed;
}

// A barcode printed on a receipt line (AUTO-11), as either the vision model
// or the OCR fallback (receipt-parsing.ts) read it. Stricter than
// normalizeBarcode on purpose: a receipt line is full of other digit runs
// (store article numbers, PLU codes, weights, a misread price), and a
// receipt barcode is only ever used to *auto-accept* a match without the
// user looking at it — so anything that isn't a real GTIN-8/12/13/14 with a
// valid check digit is dropped rather than risk linking the wrong item.
// UPC-E (6 digits) is left out too: it's rarely printed on receipts and has
// no check digit of its own to validate. Returns the same normalized form
// normalizeBarcode stores, so it compares directly to InventoryItem.barcode.
export function receiptLineBarcode(raw: string | null | undefined): string | null {
  const digits = raw?.trim() ?? "";
  if (!/^(\d{8}|\d{12,14})$/.test(digits)) return null;
  if (!hasValidGtinCheckDigit(digits)) return null;
  return normalizeBarcode(digits);
}

// Standard GS1 mod-10 check: weights alternate 3,1,3,… from the digit just
// left of the check digit, for every GTIN length.
function hasValidGtinCheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

// How long the same code has to be out of frame before a continuous scan
// session (the inventory "Scan" dialog) counts it again. A can sitting in
// front of the lens is decoded on every ~350ms tick; without this, holding
// it there for three seconds would count as +8. Moving on to the next
// item (a different code) is never held back by it.
export const SAME_CODE_REPEAT_MS = 2000;

export type RepeatGuardState = { code: string | null; lastSeenAt: number };

// Pure decision for the guard above: accept a detection unless it's the
// same code seen within SAME_CODE_REPEAT_MS. `lastSeenAt` is refreshed on
// every sighting (accepted or not), so a code held continuously in frame
// stays suppressed until it has actually been gone for the whole window —
// that's what makes "scan two identical cans" work: show one, take it
// away, show the other.
export function acceptScan(
  state: RepeatGuardState,
  code: string,
  now: number,
): { accept: boolean; next: RepeatGuardState } {
  const repeat = state.code === code && now - state.lastSeenAt < SAME_CODE_REPEAT_MS;
  return { accept: !repeat, next: { code, lastSeenAt: now } };
}
