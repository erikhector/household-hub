// Plain date helpers for the weekly planner — no "use server", safe to
// import from Server and Client Components alike. Weeks are Monday-start;
// every date is normalized to UTC midnight so it round-trips cleanly
// through the `yyyy-mm-dd` search param and Prisma's `DateTime` columns
// without local-timezone drift shifting it to a neighboring day.

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC calendar day of `date`, not the local one. For a user's local
 * wall-clock day use `toLocalDateKey` (src/lib/local-date.ts). */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_KEY_RE.test(value);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// Returns UTC midnight of the Monday on or before `date`.
export function getWeekStart(date: Date): Date {
  const dayOfWeek = date.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
}

/**
 * GAP-85: the `?week=` key for a date picked in the planner's "Choose week"
 * field, or null while there's nothing to go to yet. The field is a native
 * `<input type="date">`, and desktop Chrome fires `change` on every digit
 * typed into its year segment (2 → year 0002, 20 → 0020, …), so a year
 * before 1000 means the user is still typing, not that they want the
 * Roman empire's meal plan. An empty or impossible value is also null.
 */
export function weekKeyForPickedDate(value: string): string | null {
  if (!isDateKey(value) || Number(value.slice(0, 4)) < 1000) return null;
  const date = parseDateKey(value);
  // "2026-02-31" isn't a day; Date would roll it into March.
  if (toDateKey(date) !== value) return null;
  return toDateKey(getWeekStart(date));
}
