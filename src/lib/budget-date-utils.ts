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
