// Squirrel Wrapped (the household's year in review): which year it shows and
// when Home points at it. Pure date maths on the viewer's own clock, so it
// is unit-tested without a database and safe in Server and Client
// Components alike.
//
// The year is the local calendar year to date, except in January: a review
// of eleven days is no review, and January is when people look back, so the
// whole of January still shows the year that just ended. Home's card only
// shows around the turn of the year (1 December to 15 January), when a
// look back is what people want; the page itself is reachable all year from
// the More menu.

/** The viewer's local year, month (1-12) and day of month at `now`. */
function localParts(now: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/** The year Wrapped shows at `now`: this local year, or last year in January. */
export function wrappedYear(now: Date, timeZone: string): number {
  const { year, month } = localParts(now, timeZone);
  return month === 1 ? year - 1 : year;
}

/** The last day of January on which Home still offers Wrapped. */
const WRAPPED_SEASON_LAST_JANUARY_DAY = 15;

/** Whether Home shows its Wrapped card at `now`: 1 December to 15 January, local time. */
export function isWrappedSeason(now: Date, timeZone: string): boolean {
  const { month, day } = localParts(now, timeZone);
  return month === 12 || (month === 1 && day <= WRAPPED_SEASON_LAST_JANUARY_DAY);
}
