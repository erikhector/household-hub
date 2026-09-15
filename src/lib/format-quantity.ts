// Formats an inventory-style quantity to at most 2 decimal places. Rounding
// through Number (rather than toFixed, which pads to a fixed width) both
// strips trailing zeros — 3 stays "3", 1.5 stays "1.5" — and collapses float
// drift from arithmetic elsewhere (e.g. 0.1 - 0.03 => 0.06999999999999999)
// down to the clean 2-decimal value a user actually entered.
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return (Math.round(value * 100) / 100).toString();
}
