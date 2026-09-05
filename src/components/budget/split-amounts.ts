// Pure helper for TransactionDialog's "split this expense" UI: computes the
// default even-split amounts (in whole cents, so they always sum exactly to
// the total — no floating-point drift like a naive `amount / n`), used both
// when the split section is first enabled and by its "Split evenly" reset
// button. See REQUIREMENTS.md's "Household expense splitting" subsection.

/**
 * Splits `totalAmount` into `memberCount` amounts that sum exactly to it,
 * as evenly as possible — any leftover cent(s) from rounding go to the
 * first members in the list (e.g. splitting 10 three ways gives
 * `[3.34, 3.33, 3.33]`, matching how Splitwise-style apps resolve the
 * remainder rather than silently losing/gaining a cent).
 */
export function evenSplitAmounts(totalAmount: number, memberCount: number): number[] {
  if (memberCount <= 0 || !Number.isFinite(totalAmount)) return [];

  const totalCents = Math.round(totalAmount * 100);
  const base = Math.floor(totalCents / memberCount);
  const remainder = totalCents - base * memberCount;

  return Array.from({ length: memberCount }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}
