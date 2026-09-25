// Pure quiet-hours check for push notifications (GAP-14). Used by
// sendPushToHousehold (src/lib/push.ts) to decide whether to skip one
// PushSubscription, and by src/lib/actions/push.ts to validate a browser's
// time zone before storing it. Kept free of Prisma/web-push imports so it can
// be unit-tested with a fixed `now` instead of faking the system clock.

// The browser's IANA zone name comes straight from the client, so it's
// untrusted input. Intl.DateTimeFormat throws a RangeError for anything it
// doesn't recognise — that's the cheapest authoritative validator available
// on the server without shipping a zone list.
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The wall-clock hour (0-23) at `now` in `timeZone`, or null if the zone
// isn't usable. `hourCycle: "h23"` rather than `hour12: false` because the
// latter renders midnight as "24" in some ICU builds.
export function localHourIn(timeZone: string | null | undefined, now: Date): number | null {
  if (!timeZone) return null;
  try {
    const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value;
    const parsed = Number(hour);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null;
  } catch {
    return null;
  }
}

export function isValidQuietHour(hour: unknown): hour is number {
  return typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

// True when `now`, in `timeZone`, falls inside the half-open window
// [start, end). Half-open so "22 → 7" silences 22:00 through 06:59 and a
// push at 07:00 goes through — matching how people read "quiet until 7".
//
// Everything that isn't a well-formed window fails *open* (not quiet):
// either hour null, start === end, an out-of-range hour, or a missing or
// unrecognised time zone. Wrongly sending a push is a minor annoyance;
// wrongly swallowing one (e.g. a subscription created before GAP-14, which
// has no stored zone) would silently break a feature the user turned on.
export function isWithinQuietHours(
  start: number | null | undefined,
  end: number | null | undefined,
  timeZone: string | null | undefined,
  now: Date,
): boolean {
  if (!isValidQuietHour(start) || !isValidQuietHour(end) || start === end) return false;
  const hour = localHourIn(timeZone, now);
  if (hour === null) return false;
  // A window that wraps midnight (start > end, e.g. 22 → 7) is the union of
  // [start, 24) and [0, end).
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
