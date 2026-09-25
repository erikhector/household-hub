// Minimal, dependency-free iCalendar (RFC 5545) writer for the read-only
// household calendar feed (GAP-3, src/app/api/calendar/[token]/route.ts).
// It only emits what that feed needs: one VCALENDAR of all-day VEVENTs. A
// library would be overkill for that, and the parts calendar apps are
// actually strict about (CRLF line endings, 75-octet folding, TEXT escaping)
// are small enough to pin down with unit tests here instead. Kept pure (no
// Prisma, no request) so the tests are plain fixtures, same convention as
// recurring-template-calc.ts.

export type IcalAllDayEvent = {
  // Must be globally unique and stable across fetches: calendar apps use it
  // to update an event in place instead of duplicating it on every refresh.
  uid: string;
  // The day the event falls on. Only its UTC year/month/day are used — see
  // formatIcalDate for why.
  date: Date;
  summary: string;
  description?: string;
};

export type IcalCalendar = {
  // Shown by Apple/Google/Outlook as the subscribed calendar's name.
  name: string;
  events: IcalAllDayEvent[];
  // DTSTAMP for every event. Passed in rather than read from the clock so the
  // output is deterministic in tests.
  now: Date;
  // How often we'd like clients to re-fetch, as an RFC 5545 DURATION
  // (e.g. "PT6H"). Clients treat it as a hint at best.
  refreshInterval?: string;
};

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;

/**
 * Escapes a value for an RFC 5545 TEXT property (section 3.3.11): backslash,
 * semicolon and comma get a backslash, and any line break becomes the
 * literal two characters `\n`. Other control characters aren't allowed in
 * TEXT at all, so they're dropped rather than escaped; that only matters for
 * pasted junk in a meal or bill name, and dropping it can't break the feed.
 */
export function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, "");
}

/**
 * Folds one content line so no physical line is longer than 75 octets
 * (section 3.1). Continuation lines start with a single space, which counts
 * towards their 75. Octets, not characters: Swedish names are full of
 * two-byte å/ä/ö, so counting characters would overshoot. We only ever break
 * between code points, never inside a multi-byte UTF-8 sequence, because
 * some clients decode each physical line on its own and would show a broken
 * character otherwise.
 */
export function foldIcalLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  // The first line may use all 75 octets; every later one loses one to the
  // leading space.
  let limit = MAX_LINE_OCTETS;

  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);

  return parts.join(`${CRLF} `);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * A DATE value (YYYYMMDD). Read in UTC because every date the feed deals
 * with is a UTC-midnight calendar day already (MealPlanEntry.date, see
 * REQUIREMENTS.md's "Weekly planner"), and a DATE value has no time zone:
 * reading local fields would move a meal to the previous day on a server
 * running west of UTC.
 */
export function formatIcalDate(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** A UTC DATE-TIME value (YYYYMMDDTHHMMSSZ), as DTSTAMP requires. */
export function formatIcalUtcDateTime(date: Date): string {
  return (
    `${formatIcalDate(date)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

function nextUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function eventLines(event: IcalAllDayEvent, dtstamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${formatIcalDate(event.date)}`,
    // DTEND is exclusive, so a one-day all-day event ends the next day.
    // Spelled out rather than left implicit because Outlook has been known to
    // treat a DATE DTSTART with no DTEND as zero-length.
    `DTEND;VALUE=DATE:${formatIcalDate(nextUtcDay(event.date))}`,
    `SUMMARY:${escapeIcalText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcalText(event.description)}`);
  // A planned dinner or a bill's due date shouldn't make anyone show as busy
  // for the whole day in their work calendar's free/busy view.
  lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

/**
 * The whole feed as one string: CRLF after every line (including the last,
 * which RFC 5545 requires and some parsers enforce), and every line folded.
 */
export function buildIcalCalendar({ name, events, now, refreshInterval }: IcalCalendar): string {
  const dtstamp = formatIcalUtcDateTime(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Squirrel//Household calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcalText(name)}`,
  ];
  if (refreshInterval) {
    // REFRESH-INTERVAL is the RFC 7986 property; X-PUBLISHED-TTL is the
    // older Microsoft/Apple spelling several clients still only read.
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${refreshInterval}`, `X-PUBLISHED-TTL:${refreshInterval}`);
  }
  for (const event of events) lines.push(...eventLines(event, dtstamp));
  lines.push("END:VCALENDAR");

  return lines.map(foldIcalLine).join(CRLF) + CRLF;
}
