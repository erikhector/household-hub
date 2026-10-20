// The visitor's IANA time zone (UX-137), for the few server-side decisions
// that depend on the user's local day, such as when a daily chore reopens.
// The server runs in UTC and has no other way to know it: a client component
// (TimeZoneCookie) writes the browser's zone to this cookie, and the server
// reads it back, falling back to UTC until the first visit has set it.

export const TIME_ZONE_COOKIE = "time_zone";
export const TIME_ZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTimeZone(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
