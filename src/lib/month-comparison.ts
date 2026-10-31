// "{Month} at a glance" (budget redesign, Oct 2026): the month so far against
// the month before, for the budget Overview's quick comparison. Pure, so it's
// unit-tested without Prisma, like safe-to-spend-calc.ts; both budget pages
// feed it their own transactions (the personal page adds the user's share of
// shared household bills, as its totals do).
//
// The comparison is like for like: while the viewed month is still running,
// the previous month is cut at the same day of its period (day 12 against
// day 12), since a month twelve days in would otherwise always look cheap
// against a whole one.

import { vsUsual } from "@/lib/chart-calc";

export type MonthTotals = { income: number; expense: number; savings: number; left: number };

export type ComparisonEntry = { type: "INCOME" | "EXPENSE" | "SAVINGS"; amount: number; date: Date };

const DAY = 24 * 60 * 60 * 1000;

/** Income, expenses, savings and what's left of the income after both. */
export function totalsOf(entries: { type: ComparisonEntry["type"]; amount: number }[]): MonthTotals {
  let income = 0;
  let expense = 0;
  let savings = 0;
  for (const e of entries) {
    if (e.type === "INCOME") income += e.amount;
    else if (e.type === "EXPENSE") expense += e.amount;
    else savings += e.amount;
  }
  return { income, expense, savings, left: income - expense - savings };
}

/** Where to cut the previous period so it covers as many days as the
 * current one has so far. `partial` is false for a month that's over (or
 * not started), which is compared with the whole previous month. */
export function previousCutoff({
  current,
  previous,
  today,
}: {
  current: { start: Date; end: Date };
  previous: { start: Date; end: Date };
  today: Date;
}): { end: Date; partial: boolean } {
  if (today < current.start || today >= current.end) return { end: previous.end, partial: false };
  // Days of the current period so far, today included.
  const daysSoFar = Math.floor((today.getTime() - current.start.getTime()) / DAY) + 1;
  const cut = new Date(previous.start.getTime() + daysSoFar * DAY);
  return cut >= previous.end ? { end: previous.end, partial: false } : { end: cut, partial: true };
}

export type Change = { direction: "more" | "less" | "same" | "new"; percent: number };

/** How `current` compares with `previous`, in whole percent. Within ±5% is
 * "same"; something from nothing is "new" (no percentage to give). */
export function changeOf(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { direction: "same", percent: 0 } : { direction: "new", percent: 0 };
  const percent = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (Math.abs(percent) < 5) return { direction: "same", percent: Math.abs(percent) };
  return { direction: percent > 0 ? "more" : "less", percent: Math.abs(percent) };
}

export type StandOut = { name: string; direction: "more" | "less"; percent: number };

/** "What stands out": the expense category furthest above its usual and the
 * one furthest below it (vsUsual, so a change under 10% never makes it),
 * biggest first. At most `limit` of them. */
export function standOuts(rows: { name: string; history?: number[] }[], limit = 2): StandOut[] {
  const moves: StandOut[] = [];
  for (const row of rows) {
    if (!row.history) continue;
    const usual = vsUsual(row.history);
    if (usual && usual.direction !== "same") moves.push({ name: row.name, direction: usual.direction, percent: usual.percent });
  }
  const top = (direction: StandOut["direction"]) =>
    moves.filter((m) => m.direction === direction).sort((a, b) => b.percent - a.percent)[0];
  return [top("more"), top("less")]
    .filter((m): m is StandOut => m !== undefined)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit);
}
