/**
 * Rounds to two decimals. Used for money (cents) and for quantities shown to
 * two places, so the name says what it does rather than what it's for.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Median of `values` (mean of the middle pair when the count is even). NaN for an empty list. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
