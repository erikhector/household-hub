// Shared expiry-status predicate — mirrors src/lib/stock-status.ts's split
// for the same reason: the notification center (a Server Component/module)
// and the inventory table (a "use client" module) both need the exact same
// classification, and a Server Component can't safely import a plain
// function from a "use client" module.

export const EXPIRY_WARNING_DAYS = 3;

export type ExpiryStatus = "expired" | "soon" | null;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getExpiryStatus(expiresAt: Date | null, now: number): ExpiryStatus {
  if (!expiresAt) return null;
  const daysUntil = (expiresAt.getTime() - now) / DAY_MS;
  if (daysUntil < 0) return "expired";
  if (daysUntil <= EXPIRY_WARNING_DAYS) return "soon";
  return null;
}

// --- GAP-28: "Mark opened" --------------------------------------------------

export type OpenedExpiryInput = {
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
};

export type OpenedExpiryPatch = {
  openedAt: Date;
  expiresAt: Date;
  expiresAtEstimated: boolean;
};

/**
 * The Prisma update patch for marking an item opened: `openedAt` is `now`,
 * and `expiresAt` becomes min(existing expiresAt, now + useWithinDaysOpened
 * days) — opening a pack can only ever bring its deadline *closer*, never
 * push a best-before date further out (a jar of pesto with a week left on
 * the lid and "use within 14 days once opened" still has a week, not two).
 * With no existing date at all, the opened date simply becomes the date.
 *
 * `expiresAtEstimated`: when the existing date is still the earlier one it
 * wins untouched, flag and all — nothing about it changed. When the opened
 * date wins it's flagged as an estimate (`true`), even though the number of
 * days came from the household rather than a category default. Two reasons:
 * a "use within N days once opened" figure is a rule of thumb about the
 * whole product, not a date printed on this particular pack, so the softer
 * "≈"/"probably" treatment (ExpiryBadge, EXPIRING_SOON, the expired-waste
 * recap's "maybe" line) is the honest one; and it keeps AUTO-7's arrival
 * gate (estimatedExpiryUpdate) free to replace it with a fresh estimate once
 * the next, sealed pack arrives, where a real date would be pinned there
 * forever by "the estimator never overwrites a real date".
 *
 * Returns null when there's nothing to do — no (positive, whole) opened
 * window set, which is also when the "Mark opened" button is hidden, so a
 * stale click is a no-op rather than a surprise.
 */
export function openedExpiryUpdate(
  current: OpenedExpiryInput,
  useWithinDaysOpened: number | null,
  now: Date = new Date(),
): OpenedExpiryPatch | null {
  if (useWithinDaysOpened == null || !Number.isInteger(useWithinDaysOpened) || useWithinDaysOpened <= 0) {
    return null;
  }
  const openedDeadline = new Date(now.getTime() + useWithinDaysOpened * DAY_MS);
  if (current.expiresAt && current.expiresAt.getTime() <= openedDeadline.getTime()) {
    return { openedAt: now, expiresAt: current.expiresAt, expiresAtEstimated: current.expiresAtEstimated };
  }
  return { openedAt: now, expiresAt: openedDeadline, expiresAtEstimated: true };
}

/**
 * The patch a stock-arrival action (the same three that call AUTO-7's
 * estimatedExpiryUpdate: togglePurchasedAction, applyReceiptScanAction,
 * registerReceiptAction) merges in *before* the estimator's own patch, so an
 * opened item that ran out and was bought again stops showing "Opened":
 * restocking from zero means a new, sealed pack. Only a 0 → positive
 * crossing counts — topping up while the opened pack is still there (a
 * second carton next to the open one) keeps it opened, since the open one
 * is still the one to use first.
 *
 * If the old pack's `expiresAt` was an estimate (which includes every opened
 * date that won — see openedExpiryUpdate), it belonged to that pack and is
 * cleared too; the estimator's patch, spread after this one, replaces it
 * with a fresh estimate whenever the item has a known shelf life. A real,
 * typed-in date is left alone, same "never clobber a real date" rule as the
 * estimator. Deliberately *not* wired into the +/- buttons or the item
 * form's quantity field: those are recounts as often as they're purchases,
 * and AUTO-7's arrival paths are the ones that reliably mean "new stock came
 * in" — keeping both features on the exact same trigger.
 */
export function openedResetOnArrival(
  current: { openedAt?: Date | null; expiresAtEstimated: boolean },
  previousQuantity: number,
  nextQuantity: number,
): { openedAt: null } | { openedAt: null; expiresAt: null; expiresAtEstimated: false } | null {
  if (!current.openedAt) return null;
  if (!(previousQuantity <= 0 && nextQuantity > 0)) return null;
  if (current.expiresAtEstimated) return { openedAt: null, expiresAt: null, expiresAtEstimated: false };
  return { openedAt: null };
}

// --- GAP-44: "Freeze it" ----------------------------------------------------

/** How long frozen food is treated as good for when the item has no
 * `useWithinDaysFrozen` of its own — roughly the three months most freezer
 * guidance gives for meat, bread and cooked leftovers. */
export const DEFAULT_USE_WITHIN_DAYS_FROZEN = 90;

export type FrozenExpiryPatch = {
  frozenAt: Date;
  expiresAt: Date;
  expiresAtEstimated: true;
};

/**
 * The Prisma update patch for freezing an item: `frozenAt` is `now` and
 * `expiresAt` becomes now + the item's `useWithinDaysFrozen` (the 90-day
 * default when unset or not a positive whole number). Unlike
 * openedExpiryUpdate this *replaces* the date even when it moves it later:
 * extending the clock is the whole point of freezing.
 *
 * `expiresAtEstimated` is always true. "Frozen for N days" is a rule of
 * thumb, not a date printed on the pack, so it gets the same soft "≈"
 * treatment as the opened clock's date, and the arrival gate may replace it
 * with a fresh estimate when a sealed pack comes in. The original date is
 * not kept here; the toast's Undo restores it from a client-held snapshot.
 */
export function frozenExpiryUpdate(
  useWithinDaysFrozen: number | null,
  now: Date = new Date(),
): FrozenExpiryPatch {
  const days =
    useWithinDaysFrozen != null && Number.isInteger(useWithinDaysFrozen) && useWithinDaysFrozen > 0
      ? useWithinDaysFrozen
      : DEFAULT_USE_WITHIN_DAYS_FROZEN;
  return { frozenAt: now, expiresAt: new Date(now.getTime() + days * DAY_MS), expiresAtEstimated: true };
}

/**
 * The patch a stock-arrival action merges in alongside openedResetOnArrival
 * so a frozen item that ran out and was bought again stops showing "Frozen":
 * a 0 → positive crossing is a new pack. Same rule as the opened reset: an
 * estimated `expiresAt` (which every freeze writes) belonged to the old
 * pack and is cleared for the estimator to refill, a typed date is kept.
 */
export function frozenResetOnArrival(
  current: { frozenAt?: Date | null; expiresAtEstimated: boolean },
  previousQuantity: number,
  nextQuantity: number,
): { frozenAt: null } | { frozenAt: null; expiresAt: null; expiresAtEstimated: false } | null {
  if (!current.frozenAt) return null;
  if (!(previousQuantity <= 0 && nextQuantity > 0)) return null;
  if (current.expiresAtEstimated) return { frozenAt: null, expiresAt: null, expiresAtEstimated: false };
  return { frozenAt: null };
}
