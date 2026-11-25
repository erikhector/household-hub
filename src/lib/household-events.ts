// GAP-35: the household calendar's events, everything about them that isn't
// I/O. The calendar page, Home's "Coming up" line and the .ics feed all read
// recurrence through here, so an event lands on the same days in the app and
// in a subscribed calendar. Pure (no Prisma, no clock), same convention as
// recurring-template-calc.ts. See REQUIREMENTS.md's "Household calendar".
//
// Every date here is a calendar day held as the UTC midnight of that day,
// which is how Postgres `@db.Date` columns come back from Prisma
// (HouseholdEvent.date, like HouseholdTask.dueDate). Only the UTC fields are
// ever read, so a server or browser west of UTC can't move an event to the
// day before.

export type EventRecurrence = "WEEKLY" | "MONTHLY" | "YEARLY";

// Same caps as a task's title and notes (tasks/actions.ts), for the same
// reasons: a title is one line on a row, notes are a few lines of detail.
export const EVENT_TITLE_MAX_LENGTH = 120;
export const EVENT_NOTES_MAX_LENGTH = 500;

// How far ahead the calendar page lists. Two months covers the school term's
// next few events and the next birthdays without the agenda turning into a
// year of repeats of the same weekly class.
export const AGENDA_DAYS = 60;

// How far ahead Home looks for its "Coming up" line: this week's events, not
// the whole agenda (Home is "what needs me now?").
export const HOME_EVENT_DAYS = 7;
export const HOME_EVENT_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC midnight of `date`'s UTC day. */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** `date`'s calendar day as days since 1970-01-01 (the unit task-due.ts uses). */
export function eventDayNumber(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

/** The UTC midnight of a day number. */
export function dayNumberToDate(day: number): Date {
  return new Date(day * DAY_MS);
}

/** `YYYY-MM-DD` of a calendar day, the date field's value and the agenda's group key. */
export function eventDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` form value as the UTC midnight the column stores; null when it isn't a real date. */
export function parseEventDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = utcDay(year, month - 1, day);
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date : null;
}

/** True for a 24-hour `HH:MM` (what `<input type="time">` submits). */
export function isEventTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * The day a MONTHLY or YEARLY event falls on in a given month. The event
 * keeps its own day (the 31st stays the 31st), clamped to the month's last
 * day only where the month is shorter, so a monthly event on the 31st is on
 * 30 April and back on 31 May rather than drifting to the 30th for good.
 * A birthday on 29 February is on the 28th in a year without one.
 */
function clampedDay(base: Date, year: number, month: number): Date {
  return utcDay(year, month, Math.min(base.getUTCDate(), daysInMonth(year, month)));
}

/**
 * Every day in [from, to] (both inclusive, calendar days) that an event
 * falls on, oldest first. A one-off is its own date if it's in the window; a
 * repeat starts on its date and never before it.
 */
export function expandEventOccurrences(
  event: { date: Date; recurrence: EventRecurrence | null },
  from: Date,
  to: Date,
): Date[] {
  const base = eventDayNumber(event.date);
  const first = Math.max(base, eventDayNumber(from));
  const last = eventDayNumber(to);
  if (first > last) return [];

  switch (event.recurrence) {
    case null:
      return base >= first && base <= last ? [dayNumberToDate(base)] : [];
    case "WEEKLY": {
      // The first week on or after the window's start, then every 7 days.
      const start = base + Math.ceil((first - base) / 7) * 7;
      const days: Date[] = [];
      for (let day = start; day <= last; day += 7) days.push(dayNumberToDate(day));
      return days;
    }
    case "MONTHLY": {
      const days: Date[] = [];
      const startDate = dayNumberToDate(first);
      let year = startDate.getUTCFullYear();
      let month = startDate.getUTCMonth();
      for (;;) {
        const day = eventDayNumber(clampedDay(event.date, year, month));
        if (day > last) break;
        if (day >= first) days.push(dayNumberToDate(day));
        month += 1;
        if (month === 12) {
          month = 0;
          year += 1;
        }
      }
      return days;
    }
    case "YEARLY": {
      const days: Date[] = [];
      for (let year = dayNumberToDate(first).getUTCFullYear(); ; year += 1) {
        const day = eventDayNumber(clampedDay(event.date, year, event.date.getUTCMonth()));
        if (day > last) break;
        if (day >= first) days.push(dayNumberToDate(day));
      }
      return days;
    }
  }
}

/**
 * The RFC 5545 RRULE for an event's repeat, or null for a one-off. Written to
 * land on exactly the days expandEventOccurrences does, clamping included:
 * a plain FREQ=MONTHLY on the 31st would skip every shorter month (RFC 5545
 * drops invalid dates), so a day past the 28th lists every candidate day up
 * to it and keeps the last one that exists in each month (BYSETPOS=-1). The
 * same trick puts a 29 February birthday on the 28th in other years.
 */
export function eventRrule(event: { date: Date; recurrence: EventRecurrence | null }): string | null {
  const day = event.date.getUTCDate();
  const candidates = (upTo: number) =>
    Array.from({ length: upTo - 27 }, (_, i) => 28 + i).join(",");
  switch (event.recurrence) {
    case null:
      return null;
    case "WEEKLY":
      return "FREQ=WEEKLY";
    case "MONTHLY":
      return day > 28 ? `FREQ=MONTHLY;BYMONTHDAY=${candidates(day)};BYSETPOS=-1` : "FREQ=MONTHLY";
    case "YEARLY":
      return event.date.getUTCMonth() === 1 && day === 29
        ? "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1"
        : "FREQ=YEARLY";
  }
}

export type AgendaEvent = {
  id: string;
  title: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  recurrence: EventRecurrence | null;
};

export type AgendaDay<E extends AgendaEvent> = {
  /** `YYYY-MM-DD`. */
  key: string;
  date: Date;
  /** This day's occurrences: all-day ones first, then by start time, then by title. */
  events: E[];
};

/**
 * Lays events out as an agenda: one group per day in [from, to] that has
 * anything on it, oldest first, with repeats expanded. Each occurrence is the
 * event itself with `date` set to the day it falls on, so a row can show its
 * time and edit the event it came from.
 */
export function buildAgenda<E extends AgendaEvent>(events: readonly E[], from: Date, to: Date): AgendaDay<E>[] {
  const byDay = new Map<string, { date: Date; events: E[] }>();
  for (const event of events) {
    for (const date of expandEventOccurrences(event, from, to)) {
      const key = eventDateKey(date);
      const day = byDay.get(key) ?? { date, events: [] };
      day.events.push({ ...event, date });
      byDay.set(key, day);
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, day]) => ({ key, date: day.date, events: day.events.sort(compareOccurrences) }));
}

function compareOccurrences(a: AgendaEvent, b: AgendaEvent): number {
  // "" sorts before any "HH:MM", so all-day events lead the day.
  const byTime = (a.startTime ?? "").localeCompare(b.startTime ?? "");
  if (byTime !== 0) return byTime;
  const byTitle = a.title.localeCompare(b.title);
  return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
}
