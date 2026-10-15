// Pure maths behind the budget charts (UX-39): the per-category spending
// sparkline, the projected end-of-month line on Safe to spend, and the
// count-up easing the animated numbers use. Dependency-free (no Prisma, no
// React) so it's unit-tested with plain fixtures in chart-calc.test.ts and
// can be imported from Server and Client Components alike. The components
// that draw these live in src/components/charts/. See REQUIREMENTS.md,
// "Budget charts".

import { addMonths } from "@/lib/budget-date-utils";

/** How many months a category's sparkline covers, the viewed month last.
 * Six is enough to see a trend at a glance and still fits beside the bar on
 * a 412 px phone; the household page's lookback window holds twelve. */
export const SPEND_HISTORY_MONTHS = 6;

/** Only the fields the history reads, so either Prisma transaction model
 * fits (same trick as RolloverTransaction in budget-rollover-calc.ts). */
export type HistoryTransaction = {
  categoryId: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  amount: number;
  date: Date;
};

/**
 * Attach each row's spending per month for the `months` months ending at
 * `monthStart` (oldest first, the viewed month last) as `history`. Rows
 * with nothing spent in the whole window get no history, so a capped
 * category nobody has used yet (or a shared mirror row whose id matches no
 * category) doesn't draw a flat line that says nothing.
 *
 * Counts every transaction of the row's own type — expense rows sum
 * EXPENSE transactions, savings rows SAVINGS — so the line always matches
 * what the bar beside it measures.
 */
export function withSpendHistory<Row extends { id: string }>(
  rows: Row[],
  transactions: HistoryTransaction[],
  monthStart: Date,
  type: HistoryTransaction["type"] = "EXPENSE",
  months: number = SPEND_HISTORY_MONTHS,
): (Row & { history?: number[] })[] {
  const windowStart = addMonths(monthStart, -(months - 1));
  const windowEnd = addMonths(monthStart, 1);
  const ids = new Set(rows.map((r) => r.id));
  const byId = new Map<string, number[]>();
  for (const t of transactions) {
    if (t.type !== type || !ids.has(t.categoryId)) continue;
    if (t.date < windowStart || t.date >= windowEnd) continue;
    const index =
      (t.date.getFullYear() - windowStart.getFullYear()) * 12 +
      (t.date.getMonth() - windowStart.getMonth());
    let history = byId.get(t.categoryId);
    if (!history) {
      history = new Array<number>(months).fill(0);
      byId.set(t.categoryId, history);
    }
    history[index] += t.amount;
  }
  return rows.map((row) => {
    const history = byId.get(row.id);
    return history && history.some((v) => v > 0) ? { ...row, history } : row;
  });
}

/** Short month names ("May", "jun") for the `months` entries of a
 * withSpendHistory history ending at `monthStart`, in the same order. */
export function historyMonthLabels(
  monthStart: Date,
  locale: string,
  months: number = SPEND_HISTORY_MONTHS,
): string[] {
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short" });
  return Array.from({ length: months }, (_, i) =>
    monthFormat.format(addMonths(monthStart, i - (months - 1))),
  );
}

/** What projectMonthEnd needs from a transaction: the discretionary filter
 * reads the type and the two "is this a recurring bill" flags. */
export type ProjectionTransaction = {
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  amount: number;
  date: Date;
  isRecurring: boolean;
  recurringTemplateId: string | null;
};

export type MonthProjection = {
  daysInMonth: number;
  /** Today's day of the month; today counts as elapsed. */
  daysElapsed: number;
  /** Safe to spend before any of this month's day-to-day spending. */
  start: number;
  /** Safe to spend at the end of each elapsed day, day 1 first. The last
   * entry is today's figure, the headline number. */
  actual: number[];
  /** Day-to-day spending per elapsed day so far. */
  dailyPace: number;
  /** Safe to spend at month end if that pace holds. */
  projected: number;
};

/**
 * Where Safe to spend lands at month end if this month's day-to-day
 * spending carries on at the same daily pace.
 *
 * Only *discretionary* spending sets the pace: EXPENSE transactions that
 * neither came from a recurring item nor were ticked "this repeats". Bills
 * are already in the headline number (logged, or subtracted while still
 * due), so letting the rent paid on the 1st set the pace would project it
 * again every day of the month.
 *
 * Returns null when there's nothing honest to project: a month other than
 * the current one (a past month is settled, a future one has no pace yet)
 * or no day-to-day spending so far.
 */
export function projectMonthEnd({
  safeToSpend,
  transactions,
  monthStart,
  today,
}: {
  safeToSpend: number;
  transactions: ProjectionTransaction[];
  monthStart: Date;
  today: Date;
}): MonthProjection | null {
  if (
    today.getFullYear() !== monthStart.getFullYear() ||
    today.getMonth() !== monthStart.getMonth()
  ) {
    return null;
  }
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const daysElapsed = today.getDate();

  const perDay = new Array<number>(daysElapsed).fill(0);
  let spent = 0;
  for (const t of transactions) {
    if (t.type !== "EXPENSE" || t.isRecurring || t.recurringTemplateId) continue;
    if (
      t.date.getFullYear() !== monthStart.getFullYear() ||
      t.date.getMonth() !== monthStart.getMonth()
    ) {
      continue;
    }
    // Something dated later this month is already in the headline number,
    // so it's drawn as spent today rather than dropped from the line.
    perDay[Math.min(t.date.getDate(), daysElapsed) - 1] += t.amount;
    spent += t.amount;
  }
  if (spent <= 0) return null;

  const start = safeToSpend + spent;
  const actual: number[] = [];
  let running = start;
  for (const amount of perDay) {
    running -= amount;
    actual.push(running);
  }
  // Pin the last point to the headline number so float drift never shows
  // the line ending a cent away from the big figure above it.
  actual[actual.length - 1] = safeToSpend;

  const dailyPace = spent / daysElapsed;
  return {
    daysInMonth,
    daysElapsed,
    start,
    actual,
    dailyPace,
    projected: safeToSpend - dailyPace * (daysInMonth - daysElapsed),
  };
}

/** How long a number takes to count to its new value. Long enough to read
 * as movement, short enough not to hold up the eye. */
export const COUNT_UP_MS = 600;

/** The value `progress` (0–1) of the way from `from` to `to`, eased out
 * (fast start, gentle landing) like Copilot Money's balances. Clamped, so a
 * late animation frame never overshoots the target. */
export function countUpValue(from: number, to: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const eased = 1 - Math.pow(1 - p, 3);
  return p === 1 ? to : from + (to - from) * eased;
}

/** A bar's height as a percentage of the tallest. Anything above zero gets
 * at least 3% so a small month still shows as a sliver, not as nothing. */
export function barHeightPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max((value / max) * 100, 3);
}
