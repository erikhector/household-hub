// "What calendar day is it on the viewer's clock?" as a `YYYY-MM-DD` string,
// for `<input type="date">` defaults. No "use server": safe from Server and
// Client Components alike (in practice it runs in the browser, so "local" is
// the user's timezone).
//
// This is deliberately the opposite of meal-planning/date-utils.ts's
// `toDateKey`, which reads the UTC calendar day (its dates are normalised to
// UTC midnight). Use that one for stored, UTC-midnight dates and this one for
// an instant that should read as the user's own wall-clock date: at 23:30 in
// UTC-5 `toDateKey` already says tomorrow, this still says today.

/** The local-calendar `YYYY-MM-DD` of `date`. */
export function toLocalDateKey(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/** Today's local-calendar `YYYY-MM-DD`. */
export function todayLocalDateKey(): string {
  return toLocalDateKey(new Date());
}
