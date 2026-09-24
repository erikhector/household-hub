// The one rule for "change an item's stock by a delta": floored at zero
// (you can't have used up more than you had) and rounded to 2 decimals, the
// same precision the item schema stores (see itemSchema in
// src/app/dashboard/inventory/actions.ts). Shared by adjustQuantityAction's
// +/- taps and the barcode stock scan (AUTO-6, src/lib/actions/barcode.ts)
// so a scan and a tap can never disagree about where a quantity lands.
// Pure and split out of both "use server" files, which may only export
// async functions.
export function nextQuantityAfterDelta(current: number, delta: number): number {
  return Math.round(Math.max(0, current + delta) * 100) / 100;
}
