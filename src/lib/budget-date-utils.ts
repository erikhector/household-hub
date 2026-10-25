// Plain date helpers for the budget page's month navigation — no "use
// server", safe to import from Server and Client Components alike. Shared
// between the household budget (src/app/dashboard/budget) and the personal
// budget (src/app/dashboard/personal-budget), which both navigate by month
// the same way meal-planning/date-utils.ts navigates by week. Months are
// kept in local time (not UTC) to match the rest of the budget page's
// existing `new Date(year, month, 1)` convention (see the monthStart/
// monthEnd it replaces in both pages).

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function parseMonthKey(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_RE.test(value);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Local midnight of the 1st of `date`'s month. */
export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Local midnight of the 1st of the month after `date`'s — an exclusive
 * upper bound, matching the `t.date < monthEnd` convention used throughout
 * the budget pages. */
export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

// --- Budget periods that start on payday (UX-134) -----------------------------
//
// Household.budgetMonthStartDay (1 to 28) moves the household budget's month
// boundary: with 25, a "month" runs from the 25th to the 24th. A period is
// keyed and named by the calendar month it ENDS in, so "2026-10" with day 25
// is 25 Sep to 24 Oct: the pay that lands on 25 Sep funds October's bills. With
// day 1 every function below is the calendar month, identical to the helpers
// above. Local time, like the rest of this file.

/** Smallest and largest allowed start day. 28 so every month has the day. */
export const MIN_BUDGET_MONTH_START_DAY = 1;
export const MAX_BUDGET_MONTH_START_DAY = 28;

/** A stored or submitted start day as a usable one: an integer in 1..28,
 * else 1 (the calendar month). */
export function normalizeStartDay(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_BUDGET_MONTH_START_DAY &&
    value <= MAX_BUDGET_MONTH_START_DAY
    ? value
    : 1;
}

/** The key ("YYYY-MM") of the budget period `date` falls in. */
export function periodKeyOf(date: Date, startDay: number = 1): string {
  const shift = startDay > 1 && date.getDate() >= startDay ? 1 : 0;
  return toMonthKey(new Date(date.getFullYear(), date.getMonth() + shift, 1));
}

/** The 1st of the month a date's period is named for. Handy for logic that
 * buckets by calendar month: map each date through this and it buckets by
 * period instead. */
export function periodLabelDate(date: Date, startDay: number = 1): Date {
  return parseMonthKey(periodKeyOf(date, startDay));
}

/** Local-midnight `[start, end)` of the period `key` names. */
export function periodBounds(key: string, startDay: number = 1): { start: Date; end: Date } {
  const label = parseMonthKey(key);
  const y = label.getFullYear();
  const m = label.getMonth();
  if (startDay <= 1) return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  return { start: new Date(y, m - 1, startDay), end: new Date(y, m, startDay) };
}

/** The date of day-of-month `day` inside the period `key` names, clamped to
 * the month's last day (a bill "due on the 31st" lands on 30 Apr). Where a
 * Due item's Log dialog starts its date. */
export function dateInPeriod(key: string, startDay: number, day: number): Date {
  const { start } = periodBounds(key, startDay);
  const y = start.getFullYear();
  const m = start.getMonth();
  if (day >= start.getDate()) return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  // Before the start day the date falls in the next calendar month.
  return new Date(y, m + 1, Math.min(day, new Date(y, m + 2, 0).getDate()));
}

/** "25 Sep – 24 Oct" style range for a period, or null for a calendar month
 * (the name already says it). */
export function periodRangeLabel(key: string, startDay: number, locale: string): string | null {
  if (startDay <= 1) return null;
  const { start, end } = periodBounds(key, startDay);
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  return `${fmt.format(start)} – ${fmt.format(lastDay)}`;
}
