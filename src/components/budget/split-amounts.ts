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

// Same tolerance the actions use (SPLIT_SUM_TOLERANCE in
// src/app/dashboard/budget/actions.ts) — floating-point noise, not a real
// mismatch.
const TOLERANCE = 0.01;

export type SplitFormCheck = {
  shareTotal: number;
  paidTotal: number;
  /** The shares don't add up to the bill. */
  shareMismatch: boolean;
  /** More has been paid than the bill is for. */
  overpaid: boolean;
  /** What's still unpaid on the bill (0 when fully paid or overpaid). */
  leftDue: number;
};

/**
 * Live validation for the split editor's share and "paid" columns — the
 * same two rules the server re-checks (shares sum to the amount, payments
 * don't exceed it), so the dialog can warn and disable submit before a
 * round trip. Inputs are the raw strings from the number inputs; anything
 * unparseable counts as 0, like the rest of the form's live totals.
 */
export function checkSplitForm(
  amount: string,
  shares: Record<string, string>,
  paid: Record<string, string>,
): SplitFormCheck {
  const total = Number(amount) || 0;
  const shareTotal = Object.values(shares).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const paidTotal = Object.values(paid).reduce((sum, v) => sum + (Number(v) || 0), 0);
  return {
    shareTotal,
    paidTotal,
    shareMismatch: Math.abs(shareTotal - total) > TOLERANCE,
    overpaid: paidTotal - total > TOLERANCE,
    leftDue: total - paidTotal > TOLERANCE ? total - paidTotal : 0,
  };
}
