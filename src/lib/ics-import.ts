// GAP-92: reads an iCalendar (.ics, RFC 5545) file into rows the household
// calendar can hold, for "Import from file" on /dashboard/calendar
// (src/app/dashboard/calendar/actions.ts). The reading counterpart of the
// writer in src/lib/ical.ts, and just as small: only VEVENTs, and only the
// parts a HouseholdEvent has (a title, a day, an optional start and end time,
// notes and a repeat). A library would bring a full recurrence engine we
// can't use, since a Squirrel event repeats only weekly, monthly or yearly.
// Pure (no Prisma, no request, no clock) so the tests are plain fixtures,
// same convention as household-events.ts.
//
// The output is form-shaped strings on purpose: every row goes through the
// same zod schema as the Add event sheet before anything is saved, so an
// imported event obeys exactly the rules a typed one does.

import { EVENT_TITLE_MAX_LENGTH, type EventRecurrence } from "@/lib/household-events";
import { isTimeZone } from "@/lib/time-zone";

// A school term or a season of fixtures is a few dozen events, a few KB. A
// cap well above that keeps a whole exported personal calendar (years of
// history) from being parsed and reviewed row by row; export a smaller range.
export const ICS_FILE_MAX_BYTES = 256 * 1024;
// One review list a person can still scroll and tick through, and one
// bounded createMany.
export const ICS_MAX_EVENTS = 500;

type IcsEventRow = {
  title: string;
  /** `YYYY-MM-DD`, in the importer's time zone for a zoned time. */
  date: string;
  /** `HH:MM`, or "" for all day. */
  startTime: string;
  /** `HH:MM`, or "" for none. */
  endTime: string;
  /** DESCRIPTION, unescaped; the schema trims it and cuts it at 500. */
  notes: string;
  /** "" for a one-off. */
  recurrence: "" | EventRecurrence;
};

export type IcsFileError = "empty" | "tooLarge" | "unsupported" | "noEvents" | "tooMany";

export type IcsParseResult =
  | {
      ok: true;
      events: IcsEventRow[];
      /** VEVENTs that can't become a row: no usable DTSTART, or cancelled. */
      skipped: number;
    }
  | { ok: false; error: IcsFileError };

type Property = { name: string; params: Record<string, string>; value: string };

type DateParts = { year: number; month: number; day: number };
type TimeParts = { hour: number; minute: number; second: number };
type IcsDateValue = {
  date: DateParts;
  /** null for a DATE (all day). */
  time: TimeParts | null;
  /** "floating" (no zone), "UTC" (a trailing Z), or the TZID. */
  zone: string;
};

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** The file's bytes, read. Size first, so an oversized upload is never decoded. */
export function parseIcsFile(bytes: Uint8Array, timeZone: string): IcsParseResult {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > ICS_FILE_MAX_BYTES) return { ok: false, error: "tooLarge" };
  // RFC 5545's default charset is UTF-8. A stray invalid byte becomes U+FFFD
  // rather than failing the whole file.
  return parseIcs(new TextDecoder("utf-8").decode(bytes), timeZone);
}

/**
 * The VEVENTs of an iCalendar text as rows, oldest-in-file first. `timeZone`
 * is the importer's (the time_zone cookie): HouseholdEvent times are
 * floating wall-clock times, so a time with a zone is moved into the zone of
 * the person importing it, the way their own calendar app would show it.
 */
export function parseIcs(text: string, timeZone: string): IcsParseResult {
  const lines = unfold(text.replace(/^﻿/, ""));
  if (!lines.some((line) => /^BEGIN:VCALENDAR$/i.test(line.trim()))) return { ok: false, error: "unsupported" };

  // Each VEVENT's own properties. Components nested inside one (a VALARM)
  // keep theirs, so an alarm's DESCRIPTION never becomes the event's notes.
  const vevents: Property[][] = [];
  const stack: string[] = [];
  for (const line of lines) {
    const property = parseContentLine(line);
    if (!property) continue;
    if (property.name === "BEGIN") {
      const component = property.value.trim().toUpperCase();
      stack.push(component);
      if (component === "VEVENT") vevents.push([]);
    } else if (property.name === "END") {
      stack.pop();
    } else if (stack.at(-1) === "VEVENT") {
      vevents.at(-1)?.push(property);
    }
  }

  if (vevents.length === 0) return { ok: false, error: "noEvents" };
  if (vevents.length > ICS_MAX_EVENTS) return { ok: false, error: "tooMany" };

  // A series whose days differ from its RRULE's: an EXDATE or RDATE, or an
  // instance moved or cancelled by a VEVENT of its own with the series' UID
  // and a RECURRENCE-ID. Its repeat wouldn't land on the same days in
  // Squirrel, so it imports as a one-off (and a moved instance as its own).
  const changedSeries = new Set<string>();
  for (const props of vevents) {
    const uid = first(props, "UID")?.value;
    if (uid && first(props, "RECURRENCE-ID")) changedSeries.add(uid);
  }

  const events: IcsEventRow[] = [];
  let skipped = 0;
  for (const props of vevents) {
    const row = toRow(props, timeZone, changedSeries);
    if (row) events.push(row);
    else skipped += 1;
  }
  return { ok: true, events, skipped };
}

/** Physical lines joined back into content lines (RFC 5545 3.1): a CRLF and one space or tab continue the line. */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, "")
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0);
}

/** `NAME;PARAM=value;PARAM="quoted:value":VALUE`, or null for a line that isn't one. */
function parseContentLine(line: string): Property | null {
  // The value starts at the first colon outside a quoted parameter value
  // (a TZID or an ALTREP can hold one).
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;

  const head = line.slice(0, colon);
  const parts: string[] = [];
  let current = "";
  inQuotes = false;
  for (const char of head) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === ";" && !inQuotes) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);

  const params: Record<string, string> = {};
  for (const param of parts.slice(1)) {
    const eq = param.indexOf("=");
    if (eq <= 0) continue;
    params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name: parts[0].trim().toUpperCase(), params, value: line.slice(colon + 1) };
}

function first(props: Property[], name: string): Property | undefined {
  return props.find((property) => property.name === name);
}

/** A TEXT value unescaped (RFC 5545 3.3.11), the reverse of escapeIcalText. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

function toRow(props: Property[], timeZone: string, changedSeries: Set<string>): IcsEventRow | null {
  if (first(props, "STATUS")?.value.trim().toUpperCase() === "CANCELLED") return null;

  const dtstart = first(props, "DTSTART");
  const start = dtstart ? parseDateValue(dtstart) : null;
  if (!start) return null;

  const startAt = resolve(start);
  const local = localParts(startAt, timeZone);

  let endTime = "";
  if (start.time) {
    // DTEND, or DTSTART plus DURATION. Kept only when it ends later the same
    // local day: a HouseholdEvent has one day, and an end past midnight
    // can't be written as an "HH:MM" after the start.
    const dtend = first(props, "DTEND");
    const end = dtend ? parseDateValue(dtend) : null;
    const durationMs = parseDuration(first(props, "DURATION")?.value);
    const endAt =
      end && end.time ? resolve(end) : durationMs !== null ? { ...startAt, ms: startAt.ms + durationMs } : null;
    if (endAt) {
      const endLocal = localParts(endAt, timeZone);
      if (endLocal.date === local.date && endLocal.time > local.time) endTime = endLocal.time;
    }
  }

  const uid = first(props, "UID")?.value;
  const changed =
    (uid !== undefined && changedSeries.has(uid)) || Boolean(first(props, "EXDATE")) || Boolean(first(props, "RDATE"));
  const rrule = first(props, "RRULE")?.value;

  // One line, as the sheet's single-line name field holds it, and cut at the
  // cap rather than refused: a long SUMMARY is still the event.
  const title = unescapeText(first(props, "SUMMARY")?.value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EVENT_TITLE_MAX_LENGTH)
    .trim();

  return {
    title,
    date: local.date,
    startTime: start.time ? local.time : "",
    endTime,
    notes: unescapeText(first(props, "DESCRIPTION")?.value ?? ""),
    // A RECURRENCE-ID instance is one day of a series, never a series itself.
    recurrence:
      rrule && !changed && !first(props, "RECURRENCE-ID") ? squirrelRecurrence(rrule, start.date) : "",
  };
}

function isRealDate({ year, month, day }: DateParts): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A DTSTART/DTEND value: `YYYYMMDD` (all day) or `YYYYMMDDTHHMMSS[Z]`, with an optional TZID. */
function parseDateValue(property: Property): IcsDateValue | null {
  const value = property.value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!isRealDate(date)) return null;
  // VALUE=DATE with a time part is malformed; read it as the day it names.
  if (match[4] === undefined || property.params.VALUE?.toUpperCase() === "DATE") {
    return { date, time: null, zone: "floating" };
  }
  const time = { hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0) };
  if (time.hour > 23 || time.minute > 59 || time.second > 60) return null;
  const zone = match[7] ? "UTC" : (property.params.TZID ?? "floating");
  return { date, time, zone };
}

/**
 * The value as milliseconds: a real instant for a zoned time, or the wall
 * clock read as if it were UTC for a floating one (and for a TZID no browser
 * knows, such as Outlook's "W. Europe Standard Time": its wall clock as
 * written is a better guess than moving it by an offset we can't look up).
 */
function resolve(value: IcsDateValue): { ms: number; floating: boolean } {
  const { year, month, day } = value.date;
  const { hour, minute, second } = value.time ?? { hour: 0, minute: 0, second: 0 };
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!value.time || value.zone === "floating") return { ms: wall, floating: true };
  if (value.zone === "UTC") return { ms: wall, floating: false };
  if (!isTimeZone(value.zone)) return { ms: wall, floating: true };
  // The instant whose wall clock in the zone is `wall`: subtract the zone's
  // offset, then once more with the offset at that instant in case the guess
  // crossed a DST change.
  const firstGuess = wall - zoneOffset(wall, value.zone);
  const ms = wall - zoneOffset(firstGuess, value.zone);
  return { ms, floating: false };
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock of instant `ms` in `zone`, as UTC milliseconds. */
function wallClockIn(ms: number, zone: string): number {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(zone, formatter);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formatter.formatToParts(new Date(ms)).find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

/** How far `zone`'s wall clock is ahead of UTC at instant `ms`. */
function zoneOffset(ms: number, zone: string): number {
  return wallClockIn(Math.floor(ms / 1000) * 1000, zone) - Math.floor(ms / 1000) * 1000;
}

/** `YYYY-MM-DD` and `HH:MM` of a resolved value, in the importer's zone unless it's floating. */
function localParts(at: { ms: number; floating: boolean }, timeZone: string): { date: string; time: string } {
  const wall = new Date(at.floating ? at.ms : wallClockIn(at.ms, isTimeZone(timeZone) ? timeZone : "UTC"));
  return { date: wall.toISOString().slice(0, 10), time: wall.toISOString().slice(11, 16) };
}

/** A DURATION value (`PT1H30M`, `P1D`, `P1W`) in milliseconds; null when absent or unreadable. */
function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((n) => Number(n ?? 0));
  return ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

/**
 * The Squirrel repeat an RRULE is, or "" when it isn't one exactly. Squirrel
 * repeats every week, month or year from the first day, forever, and
 * expandEventOccurrences clamps a day a month lacks to its last day where
 * RFC 5545 skips the month, so a rule is taken only where both land on the
 * same days:
 * - FREQ=WEEKLY, with no BYDAY or a BYDAY of DTSTART's own weekday (how
 *   Google and Apple write a weekly event).
 * - FREQ=MONTHLY on day 1–28, or the clamped form eventRrule writes for a
 *   later day: BYMONTHDAY=28,…,<DTSTART's day>;BYSETPOS=-1.
 * - FREQ=YEARLY on any day but 29 February, or eventRrule's clamped form
 *   for it: BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1.
 * INTERVAL=1 and WKST change nothing for these and are allowed. Anything
 * else (COUNT, UNTIL, a longer INTERVAL, any other BY… part, a plain
 * monthly on the 29th–31st or yearly on 29 February) is "".
 *
 * `start` is DTSTART's date as written (before any time zone move), since
 * that is the day the rule's BYDAY and BYMONTHDAY refer to.
 */
function squirrelRecurrence(rrule: string, start: DateParts): "" | EventRecurrence {
  const parts = new Map<string, string>();
  for (const part of rrule.trim().split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return "";
    const key = part.slice(0, eq).trim().toUpperCase();
    if (parts.has(key)) return "";
    parts.set(key, part.slice(eq + 1).trim().toUpperCase());
  }
  const freq = parts.get("FREQ");
  parts.delete("FREQ");
  parts.delete("WKST");
  if (parts.get("INTERVAL") === "1") parts.delete("INTERVAL");

  const rest = [...parts.keys()].sort().join(";");
  const { month, day } = start;
  const candidates = (upTo: number) => Array.from({ length: upTo - 27 }, (_, i) => 28 + i).join(",");

  switch (freq) {
    case "WEEKLY": {
      if (rest === "") return "WEEKLY";
      const weekday = WEEKDAYS[new Date(Date.UTC(start.year, month - 1, day)).getUTCDay()];
      return rest === "BYDAY" && parts.get("BYDAY") === weekday ? "WEEKLY" : "";
    }
    case "MONTHLY":
      if (rest === "") return day <= 28 ? "MONTHLY" : "";
      return rest === "BYMONTHDAY;BYSETPOS" &&
        day >= 28 &&
        parts.get("BYMONTHDAY") === candidates(day) &&
        parts.get("BYSETPOS") === "-1"
        ? "MONTHLY"
        : "";
    case "YEARLY": {
      const leapDay = month === 2 && day === 29;
      if (rest === "") return leapDay ? "" : "YEARLY";
      return rest === "BYMONTH;BYMONTHDAY;BYSETPOS" &&
        leapDay &&
        parts.get("BYMONTH") === "2" &&
        parts.get("BYMONTHDAY") === "28,29" &&
        parts.get("BYSETPOS") === "-1"
        ? "YEARLY"
        : "";
    }
    default:
      return "";
  }
}
