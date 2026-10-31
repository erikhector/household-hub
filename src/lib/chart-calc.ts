// Pure maths behind the budget charts (UX-39): the per-category spending
// sparkline, the projected end-of-month line on Safe to spend, and the
// count-up easing the animated numbers use. Dependency-free (no Prisma, no
// React) so it's unit-tested with plain fixtures in chart-calc.test.ts and
// can be imported from Server and Client Components alike. The components
// that draw these live in src/components/charts/. See REQUIREMENTS.md,
// "Budget charts".

import { addMonths, periodLabelDate } from "@/lib/budget-date-utils";

/** Whole days since the epoch for a date's local calendar day, so two dates'
 * difference counts calendar days whatever DST did in between. */
function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

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
 *
 * UX-134: with a `startDay` above 1 the "months" are budget periods, and
 * `monthStart` is any date in the viewed one or the 1st of the month it is
 * named for.
 */
export function withSpendHistory<Row extends { id: string }>(
  rows: Row[],
  transactions: HistoryTransaction[],
  monthStart: Date,
  type: HistoryTransaction["type"] = "EXPENSE",
  months: number = SPEND_HISTORY_MONTHS,
  startDay: number = 1,
): (Row & { history?: number[] })[] {
  const viewed = periodLabelDate(monthStart, startDay);
  const windowStart = addMonths(viewed, -(months - 1));
  const ids = new Set(rows.map((r) => r.id));
  const byId = new Map<string, number[]>();
  for (const t of transactions) {
    if (t.type !== type || !ids.has(t.categoryId)) continue;
    const label = periodLabelDate(t.date, startDay);
    const index =
      (label.getFullYear() - windowStart.getFullYear()) * 12 + (label.getMonth() - windowStart.getMonth());
    if (index < 0 || index >= months) continue;
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

/** Chart redesign (Oct 2026): how this month compares with the category's
 * usual, for a breakdown row's "18% more than usual". `history` is a
 * withSpendHistory history (oldest first, this month last). "Usual" is the
 * average of the earlier months that had any spending, so months from before
 * the category was used don't drag it down. Null with no earlier spending to
 * compare against. Within ±10% counts as "same": small wobbles aren't news. */
export function vsUsual(history: number[]): { direction: "more" | "less" | "same"; percent: number } | null {
  if (history.length < 2) return null;
  const current = history[history.length - 1];
  const earlier = history.slice(0, -1).filter((v) => v > 0);
  if (earlier.length === 0) return null;
  const usual = earlier.reduce((sum, v) => sum + v, 0) / earlier.length;
  const percent = Math.round(((current - usual) / usual) * 100);
  if (Math.abs(percent) < 10) return { direction: "same", percent: Math.abs(percent) };
  return { direction: percent > 0 ? "more" : "less", percent: Math.abs(percent) };
}

/** What projectMonthEnd needs from a transaction: the discretionary filter
 * reads the type and the two "is this a recurring bill" flags. */
export type ProjectionTransaction = {
  categoryId?: string;
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
  monthEnd,
  today,
  excludeCategoryIds,
}: {
  safeToSpend: number;
  transactions: ProjectionTransaction[];
  monthStart: Date;
  /** Exclusive end of the period (UX-134: a budget period needn't be a
   * calendar month). Defaults to the 1st of the month after `monthStart`. */
  monthEnd?: Date;
  today: Date;
  /** UX-138: categories with a monthly limit. Their money is already held
   * back as "still budgeted", so buying food from a limited food budget
   * doesn't lower the headline and must not set the pace either. */
  excludeCategoryIds?: ReadonlySet<string>;
}): MonthProjection | null {
  const end = monthEnd ?? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  if (dayNumber(today) < dayNumber(monthStart) || dayNumber(today) >= dayNumber(end)) return null;
  const daysInMonth = dayNumber(end) - dayNumber(monthStart);
  const daysElapsed = dayNumber(today) - dayNumber(monthStart) + 1;

  const perDay = new Array<number>(daysElapsed).fill(0);
  let spent = 0;
  for (const t of transactions) {
    if (t.type !== "EXPENSE" || t.isRecurring || t.recurringTemplateId) continue;
    if (excludeCategoryIds && t.categoryId && excludeCategoryIds.has(t.categoryId)) continue;
    if (dayNumber(t.date) < dayNumber(monthStart) || dayNumber(t.date) >= dayNumber(end)) continue;
    // Something dated later this month is already in the headline number,
    // so it's drawn as spent today rather than dropped from the line.
    perDay[Math.min(dayNumber(t.date) - dayNumber(monthStart) + 1, daysElapsed) - 1] += t.amount;
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

export type DailyAllowance = {
  /** What's safe to spend today, spread evenly over the days left. */
  perDay: number;
  /** Days left in the month, today included (today's money is still unspent). */
  daysLeft: number;
};

/**
 * UX-117: Safe to spend as a daily number — "how much can I spend today?".
 * The headline divided by the days left, today counted, so on the last day
 * the whole amount is today's.
 *
 * Returns null when there's no honest daily figure: a month other than the
 * current one, or nothing left to spend (zero or negative; the card's
 * status line already says so, and "≈ -12 per day" would read as a target).
 * Not rounded here: the card formats it, and rounding twice would drift.
 */
export function dailyAllowance({
  safeToSpend,
  monthStart,
  monthEnd,
  today,
}: {
  safeToSpend: number;
  monthStart: Date;
  /** Exclusive end of the period; see projectMonthEnd. */
  monthEnd?: Date;
  today: Date;
}): DailyAllowance | null {
  const end = monthEnd ?? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  if (dayNumber(today) < dayNumber(monthStart) || dayNumber(today) >= dayNumber(end)) return null;
  // Under half a cent formats as zero, so it's "nothing left" too.
  if (!Number.isFinite(safeToSpend) || safeToSpend < 0.005) return null;
  const daysLeft = dayNumber(end) - dayNumber(today);
  return { perDay: safeToSpend / daysLeft, daysLeft };
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

/** Chart redesign (Oct 2026): the top of a bar chart's scale — the smallest
 * "clean" number (1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten) at
 * or above `value`, so the scale's lines (the top and its half) read as round
 * amounts (30 000 and 15 000, not 27 843) without leaving the tallest bar at
 * half height. 0 for nothing to show. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 0;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    // toPrecision drops float noise (3 × 0.1 is 0.30000000000000004).
    const candidate = Number((step * power).toPrecision(12));
    if (candidate >= value) return candidate;
  }
  return 10 * power;
}

/** The groups from the first one with any non-zero value on, so a chart of
 * the last twelve months doesn't open on months from before anything was
 * logged. Keeps the last group when every one is empty. */
export function trimLeadingEmpty<T extends { values: number[] }>(groups: T[]): T[] {
  const first = groups.findIndex((g) => g.values.some((v) => v !== 0));
  if (first === -1) return groups.slice(-1);
  return groups.slice(first);
}
