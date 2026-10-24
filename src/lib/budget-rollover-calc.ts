// GAP-21: envelope-style carryover for a capped budget category. Kept
// dependency-free (no Prisma, React, zod or even budget-date-utils), like
// safe-to-spend-calc.ts, so the maths is unit-testable on plain data and
// can't pull anything server-only into a Client Component by accident.
//
// Shared by both budgets: the household page (BudgetCategory/Transaction)
// and the personal page (PersonalBudgetCategory/PersonalTransaction) fold
// the result into PeriodSummary's expense rows with `withCategoryRollover`,
// the same way GAP-12's `withCategoryLimits` (budget-category-limit.ts)
// attaches the limit itself.
//
// Where the accumulation starts: the LATER of
//   1. the month the category was created (`createdAt`) — before that there
//      was no envelope to put money in, so there's nothing to carry, and
//      backdated spending logged into a brand-new category can't eat into
//      (or pad) an allowance that never existed; and
//   2. January of the viewed month's calendar year — the envelope starts
//      fresh every year.
// (2) is what keeps this cheap and predictable: the carry for any month
// needs at most the 11 months before it, which both pages already have in
// hand (the household page's 12-month recurringLookbackTransactions window,
// the personal loader's full transaction list), so rollover adds no query.
// A plain rolling "last 12 months" window would have the same cost but
// isn't self-consistent — the oldest month dropping out of the window could
// change next month's carry in ways "last month's balance + this month's
// leftover" doesn't explain — whereas a calendar-year reset keeps
// carried(M+1) = max(0, carried(M) + limit − spent(M)) true within the year.
// It also bounds how much a retroactive change can move the number: there's
// no history of limits or of when rollover was switched on, so the
// *current* limit is applied to every month in the window (see
// computeCategoryRollover), and turning rollover on in March counts
// January and February too — but never last year.
//
// Rollover is purely advisory, like the limit it builds on (REQUIREMENTS.md,
// "Monthly spending limits"): it only changes what PeriodSummary's bar is
// drawn against. Safe to spend and every other total ignore it.

/** Only the fields the calc reads, so either Prisma category model fits. */
export type RolloverCategory = {
  id: string;
  monthlyLimit: number | null;
  rolloverEnabled: boolean;
  createdAt: Date;
};

/** Only the fields the calc reads, so either Prisma transaction model fits. */
export type RolloverTransaction = {
  categoryId: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  amount: number;
  date: Date;
};

export type RolloverMonth = { limit: number; spent: number };

export type CategoryRollover = {
  /** Unspent budget brought forward from earlier months. Never negative. */
  carried: number;
  /** What this month can spend before going over: limit + carried. */
  available: number;
  /** First month counted into `carried` (local midnight on the 1st). Equal
   * to the viewed month when nothing was carried because nothing preceded
   * it in the window. */
  startMonth: Date;
};

// Local-time month arithmetic, the same `new Date(year, month, 1)`
// convention budget-date-utils.ts uses — duplicated rather than imported to
// keep this file dependency-free.
//
// UX-134: with a household budget month start day above 1 a "month" is a
// budget period named for the month it ends in (25 Sep to 24 Oct is
// October), so every date is first mapped to the 1st of its period's month.
// Start day 1 maps a date to its own calendar month, as before.
function monthStartOf(date: Date, startDay: number = 1): Date {
  const shift = startDay > 1 && date.getDate() >= startDay ? 1 : 0;
  return new Date(date.getFullYear(), date.getMonth() + shift, 1);
}

function monthIndex(date: Date, startDay: number = 1): number {
  const label = monthStartOf(date, startDay);
  return label.getFullYear() * 12 + label.getMonth();
}

// Money is stored as Float, so a long run of additions can pick up
// 0.1 + 0.2-style noise; round the carry to cents so "12.000000001 carried"
// never reaches the UI.
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The first month whose leftover can count toward `monthStart`'s carry —
 * see this file's header for why it's the later of the category's creation
 * month and January of the viewed year. Can be after `monthStart` (viewing
 * a month before the category existed), which simply means "no months to
 * carry from".
 */
export function rolloverStartMonth(monthStart: Date, createdAt: Date, startDay: number = 1): Date {
  const yearStart = new Date(monthStartOf(monthStart, startDay).getFullYear(), 0, 1);
  const createdMonth = monthStartOf(createdAt, startDay);
  return createdMonth > yearStart ? createdMonth : yearStart;
}

/**
 * Fold a run of months (oldest first) into the balance carried *out of* the
 * last one. After each month the running balance is clamped at zero:
 * overspending eats whatever was saved up, but never creates a debt the
 * next month has to dig out of first. That's the simpler, more forgiving
 * half of true envelope budgeting (YNAB carries overspending forward as a
 * negative), matching the app's "suggest, don't gate" stance on money.
 *
 * Each month carries its own limit, so the fold itself handles a limit that
 * changes over time; the pages just don't have a limit history to feed it
 * (see computeCategoryRollover).
 */
export function carryForward(months: RolloverMonth[]): number {
  let balance = 0;
  for (const month of months) {
    balance = Math.max(0, balance + month.limit - Math.max(month.spent, 0));
  }
  return roundToCents(balance);
}

/**
 * The carried balance and available amount for one category in the month
 * starting at `monthStart`. Returns null when rollover doesn't apply (it's
 * switched off, or there's no usable limit to carry), so callers can fall
 * back to GAP-12's plain limit.
 *
 * `transactions` may be any superset of what's needed — other categories,
 * non-expense rows, and anything outside [start month, monthStart) are
 * ignored — so a page can pass the transaction window it already fetched.
 * A month in the window with no spending at all carries its whole limit.
 * The current `monthlyLimit` is used for every month: there's no stored
 * history of past limits, so raising or lowering the limit re-evaluates
 * the whole (at most 11-month) window at the new figure.
 */
export function computeCategoryRollover({
  category,
  transactions,
  monthStart,
  startDay = 1,
}: {
  category: RolloverCategory;
  transactions: RolloverTransaction[];
  monthStart: Date;
  /** UX-134: the household's budget month start day. */
  startDay?: number;
}): CategoryRollover | null {
  const limit = category.monthlyLimit;
  if (!category.rolloverEnabled) return null;
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return null;

  const viewed = monthStartOf(monthStart, startDay);
  const start = rolloverStartMonth(viewed, category.createdAt, startDay);
  const firstIndex = monthIndex(start);
  const monthCount = monthIndex(viewed) - firstIndex;
  if (monthCount <= 0) {
    return { carried: 0, available: limit, startMonth: viewed };
  }

  const spent = new Array<number>(monthCount).fill(0);
  for (const t of transactions) {
    if (t.categoryId !== category.id || t.type !== "EXPENSE") continue;
    const offset = monthIndex(t.date, startDay) - firstIndex;
    if (offset < 0 || offset >= monthCount) continue;
    spent[offset] += t.amount;
  }

  const carried = carryForward(spent.map((s) => ({ limit, spent: s })));
  return { carried, available: roundToCents(limit + carried), startMonth: start };
}

/**
 * Attach each rollover-enabled category's carried balance to its row in
 * PeriodSummary's expense totals (after `withCategoryLimits` has attached
 * the limit and added the zero-spend capped rows). Rows without rollover —
 * including the personal budget's `shared:` mirror rows, which never match
 * a category id — pass through unchanged, so their bar is drawn against
 * the raw limit exactly as before.
 */
export function withCategoryRollover<Row extends { id: string }>(
  rows: Row[],
  categories: RolloverCategory[],
  transactions: RolloverTransaction[],
  monthStart: Date,
  startDay: number = 1,
): (Row & { carried?: number | null })[] {
  const carriedById = new Map<string, number>();
  for (const category of categories) {
    const rollover = computeCategoryRollover({ category, transactions, monthStart, startDay });
    if (rollover) carriedById.set(category.id, rollover.carried);
  }
  if (carriedById.size === 0) return rows;
  return rows.map((row) =>
    carriedById.has(row.id) ? { ...row, carried: carriedById.get(row.id) } : row,
  );
}
