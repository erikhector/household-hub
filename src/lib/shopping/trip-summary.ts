// UX-81: the one-line trip summary on "All done" ("15 items · ≈ 240 kr ·
// 18 min"). Pure so the duration rules are testable without a render.

/** A trip longer than this is two errands sharing a list (ticked at lunch
 * and again that evening), not one shop, so no duration is claimed. */
const MAX_TRIP_MINUTES = 4 * 60;

/**
 * How long the shop took: first check-off to last, rounded to whole minutes.
 * null when it can't be said honestly: fewer than two timestamped ticks
 * (receipt-applied rows and rows ticked before `checkedOffAt` existed carry
 * none), under a minute apart, or implausibly long (MAX_TRIP_MINUTES).
 */
export function tripDurationMinutes(checkedOffAt: (Date | string | null)[]): number | null {
  const times = checkedOffAt.flatMap((value) => {
    if (value == null) return [];
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? [] : [time];
  });
  if (times.length < 2) return null;
  const minutes = Math.round((Math.max(...times) - Math.min(...times)) / 60_000);
  return minutes >= 1 && minutes <= MAX_TRIP_MINUTES ? minutes : null;
}
