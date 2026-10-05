// "You usually buy this about now" (AUTO-10) — predicts a run-out from the
// household's own purchase rhythm rather than from the stock count.
// Inventory counts drift (nobody updates them after every breakfast), so
// low-stock detection alone misses things; how often an item actually gets
// bought doesn't drift. Pure and read-only: this only feeds dismissible
// chips above a shopping list. It never adds anything by itself and never
// notifies (BACKLOG.md's Guardrails — suggest, don't silently mutate).
//
// Where a purchase date comes from: there's no `purchasedAt` column. A
// purchase is a `purchased` ShoppingListItem row, dated by
// purchaseTimestamp() below — its AUTO-9 `checkedOffAt` when someone ticked
// it by hand, otherwise its list's `completedAt`. That second fallback is
// exactly the rows `checkedOffAt` deliberately leaves blank: receipt apply
// marks lines purchased without a tick, and "Register receipt" creates its
// list already completed at the moment of purchase. A separate column would
// only ever hold one of those two values again, and deriving means every
// list completed before this shipped already counts as history.

import { median } from "@/lib/math";

const DAY_MS = 24 * 60 * 60 * 1000;

// Fewer purchases than this say nothing about a rhythm — two purchases are a
// single interval, which could be a one-off. Counted after same-day
// collapse (see purchaseDays), so one big shop with two coffee lines is one.
export const MIN_PURCHASES = 3;

// Suggest a little before the usual interval has fully passed: the point is
// to get it onto the list *before* the last pack runs out, and a shop is
// usually planned a day or two ahead.
export const DUE_FRACTION = 0.85;

// More chips than this would crowd the list they sit above rather than read
// as a quick nudge — same cap as use-it-up-calc.ts' MAX_SUGGESTIONS.
export const MAX_REPURCHASE_SUGGESTIONS = 5;

// Only this much history is loaded (src/lib/inventory/repurchase-suggestions.ts):
// habits change, and a year covers even a quarterly purchase MIN_PURCHASES
// times over while keeping the query bounded as lists pile up.
export const HISTORY_WINDOW_DAYS = 365;

export type PurchaseRow = {
  purchased: boolean;
  checkedOffAt: Date | null;
  listCompletedAt: Date | null;
};

/** When a shopping-list row was bought, or null if it wasn't (or we can't
 * tell yet — a receipt-applied row on a list that's still ACTIVE gets its
 * date when the list is completed). */
export function purchaseTimestamp(row: PurchaseRow): Date | null {
  if (!row.purchased) return null;
  return row.checkedOffAt ?? row.listCompletedAt;
}

// Calendar day number (days since the epoch) of `date` in `timeZone`. The
// server runs in UTC and a household has no stored zone, so callers pass
// UTC today; the parameter keeps the "same day" rule honest if one is ever
// stored.
function dayNumber(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS;
}

export type RepurchaseRhythm = {
  /** Median whole days between purchase days (may be x.5 for an even count). */
  medianIntervalDays: number;
  lastPurchasedAt: Date;
  /** Distinct purchase days the median was taken over. */
  purchaseCount: number;
};

/**
 * The item's buying rhythm, or null with fewer than MIN_PURCHASES distinct
 * purchase days. Purchases on the same calendar day collapse into one —
 * two lines of the same thing on one receipt, or a tick on one list and a
 * second on another in the same trip, are one shop, not a 0-day interval
 * that would drag the median down. Intervals are whole days between those
 * days, so a morning shop followed by an evening one a week later is still
 * "every 7 days". The median, not the mean, so one forgotten fortnight
 * doesn't skew a weekly habit.
 */
export function repurchaseRhythm(purchases: Date[], timeZone = "UTC"): RepurchaseRhythm | null {
  if (purchases.length < MIN_PURCHASES) return null;
  const days = [...new Set(purchases.map((date) => dayNumber(date, timeZone)))].sort((a, b) => a - b);
  if (days.length < MIN_PURCHASES) return null;

  const intervals = days.slice(1).map((day, i) => day - days[i]);
  const lastPurchasedAt = new Date(Math.max(...purchases.map((date) => date.getTime())));
  return { medianIntervalDays: median(intervals), lastPurchasedAt, purchaseCount: days.length };
}

export type RepurchaseCandidate = {
  inventoryItemId: string;
  name: string;
  /** InventoryItem.repurchaseSnoozedUntil — a past value has expired. */
  snoozedUntil: Date | null;
  purchases: Date[];
};

export type RepurchaseSuggestion = {
  inventoryItemId: string;
  name: string;
  /** Rounded for the chip ("usually every 12 days"), never below 1. */
  intervalDays: number;
  medianIntervalDays: number;
  lastPurchasedAt: Date;
};

/**
 * Which items to suggest right now: those whose rhythm is known, whose
 * time since the last purchase has reached DUE_FRACTION of their median
 * interval, that aren't snoozed, and that aren't already pending on any
 * active list (`pendingInventoryItemIds` — the caller decides what counts;
 * see repurchase-suggestions.ts). Most overdue first, relative to the
 * item's own rhythm (a weekly item three days late outranks a monthly one
 * three days late), then by name for a stable order; capped at `limit`.
 */
export function getRepurchaseSuggestions({
  candidates,
  pendingInventoryItemIds,
  now,
  timeZone = "UTC",
  limit = MAX_REPURCHASE_SUGGESTIONS,
}: {
  candidates: RepurchaseCandidate[];
  pendingInventoryItemIds: ReadonlySet<string>;
  now: Date;
  timeZone?: string;
  limit?: number;
}): RepurchaseSuggestion[] {
  const due: { suggestion: RepurchaseSuggestion; overdueRatio: number }[] = [];

  for (const candidate of candidates) {
    if (pendingInventoryItemIds.has(candidate.inventoryItemId)) continue;
    if (candidate.snoozedUntil && candidate.snoozedUntil.getTime() > now.getTime()) continue;

    const rhythm = repurchaseRhythm(candidate.purchases, timeZone);
    // A zero median can't happen after same-day collapse, but guard the
    // division anyway rather than suggest everything.
    if (!rhythm || rhythm.medianIntervalDays <= 0) continue;

    const elapsedDays = (now.getTime() - rhythm.lastPurchasedAt.getTime()) / DAY_MS;
    if (elapsedDays < DUE_FRACTION * rhythm.medianIntervalDays) continue;

    due.push({
      suggestion: {
        inventoryItemId: candidate.inventoryItemId,
        name: candidate.name,
        intervalDays: Math.max(1, Math.round(rhythm.medianIntervalDays)),
        medianIntervalDays: rhythm.medianIntervalDays,
        lastPurchasedAt: rhythm.lastPurchasedAt,
      },
      overdueRatio: elapsedDays / rhythm.medianIntervalDays,
    });
  }

  return due
    .sort((a, b) => b.overdueRatio - a.overdueRatio || a.suggestion.name.localeCompare(b.suggestion.name))
    .slice(0, limit)
    .map(({ suggestion }) => suggestion);
}

/**
 * Dismissing a chip snoozes the item for one whole usual interval from the
 * moment of dismissal — "not this time, ask me next cycle". If it's bought
 * meanwhile the new purchase moves the due date on by itself; if it still
 * hasn't been bought when the snooze ends, it's overdue and comes back.
 */
export function repurchaseSnoozeUntil(medianIntervalDays: number, now: Date): Date {
  return new Date(now.getTime() + Math.max(1, medianIntervalDays) * DAY_MS);
}
