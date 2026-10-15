// Day grouping for the budget transaction list (phone pass, Oct 2026): rows
// sit under "Today" / "Yesterday" / "Friday, Oct 9" headers with that day's
// net, the way a bank app shows them, instead of repeating the full date
// (year and all) on every row of a month that's already picked. No "use
// server", no Prisma — safe in Client Components and unit-tested directly.
//
// Two different "days" meet here, on purpose:
//   - A transaction's day is the UTC calendar date of its stored `date`.
//     The forms send a bare "YYYY-MM-DD", which `new Date()` stores as UTC
//     midnight, so the UTC date is exactly the day the user picked, on the
//     server and in every browser alike (formatting it in local time would
//     move it to the day before anywhere west of UTC).
//   - "Today" is the viewer's own local calendar day: the day the
//     transaction dialog defaults a new date to (toDateInputValue).

type TransactionKind = "INCOME" | "EXPENSE" | "SAVINGS";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" of `date`'s UTC calendar day. */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" of `date`'s calendar day in the runtime's own time zone. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export type DayGroup<T> = { key: string; net: number; rows: T[] };

/** Rows (already newest first) grouped by day, in the same order. A day's
 * `net` is income minus expenses and savings: savings leave the money
 * that's safe to spend just as an expense does (see "Safe to spend"). */
export function groupByDay<T extends { date: Date; amount: number; type: TransactionKind }>(
  rows: T[],
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const key = utcDateKey(row.date);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, net: 0, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
    group.net += row.type === "INCOME" ? row.amount : -row.amount;
  }
  return groups;
}

function keyToUtcDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The header for a day: "Today" and "Yesterday" from Intl's own relative
 * wording in the viewer's language (capitalised, since it heads a group),
 * otherwise weekday and date without the year — the month is already the
 * one picked above the list. */
export function dayHeading(key: string, todayKey: string, locale: string): string {
  const daysAgo = Math.round((keyToUtcDate(todayKey).getTime() - keyToUtcDate(key).getTime()) / DAY_MS);
  if (daysAgo === 0 || daysAgo === 1) {
    const word = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-daysAgo, "day");
    return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(keyToUtcDate(key));
}
