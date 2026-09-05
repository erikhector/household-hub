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
