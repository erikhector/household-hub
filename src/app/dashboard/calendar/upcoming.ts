import "server-only";

// GAP-35: the next days' household events, for the calendar page's agenda
// and Home's "Coming up" card, plus the two labels both of them show. The
// recurrence maths is src/lib/household-events.ts; this is the query and
// the words.

import { prisma } from "@/lib/prisma";
import { buildAgenda, dayNumberToDate, type AgendaDay, type EventRecurrence } from "@/lib/household-events";
import type { Locale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";

export type UpcomingEvent = {
  id: string;
  title: string;
  /** The day this occurrence falls on. */
  date: Date;
  /** The series' own first day (`HouseholdEvent.date`). */
  seriesDate: Date;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  forMemberId: string | null;
  recurrence: EventRecurrence | null;
};

/**
 * The household's events from `today` for `days` days (local day numbers,
 * see task-due.ts), as an agenda. `hasEvents` says whether the household has
 * any event at all, so the page can tell "nothing yet" (the empty state)
 * from "nothing soon". Home has no empty state, so it passes
 * `checkAny: false` and skips that second query.
 */
export async function loadUpcomingEvents(
  householdId: string,
  today: number,
  days: number,
  { checkAny = true }: { checkAny?: boolean } = {},
): Promise<{ days: AgendaDay<UpcomingEvent>[]; hasEvents: boolean }> {
  const from = dayNumberToDate(today);
  const to = dayNumberToDate(today + days - 1);
  const rows = await prisma.householdEvent.findMany({
    // A one-off inside the window, or a repeat that has started by its end.
    where: { householdId, date: { lte: to }, OR: [{ recurrence: { not: null } }, { date: { gte: from } }] },
    select: {
      id: true,
      title: true,
      date: true,
      startTime: true,
      endTime: true,
      notes: true,
      forMemberId: true,
      recurrence: true,
    },
  });
  const agenda = buildAgenda(
    rows.map((row) => ({ ...row, seriesDate: row.date })),
    from,
    to,
  );
  const hasEvents =
    rows.length > 0 ||
    (checkAny &&
      (await prisma.householdEvent.findFirst({ where: { householdId }, select: { id: true } })) !== null);
  return { days: agenda, hasEvents };
}

/** An "HH:MM" in the locale's own clock (14:30, 2:30 PM). */
function formatTime(time: string, locale: Locale): string {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(1970, 0, 1, hours, minutes)),
  );
}

/** "All day", "14:30" or "14:30–15:15". */
export function describeEventTime(
  event: { startTime: string | null; endTime: string | null },
  locale: Locale,
  dict: { allDay: string; timeRange: string },
): string {
  if (!event.startTime) return dict.allDay;
  const start = formatTime(event.startTime, locale);
  return event.endTime ? format(dict.timeRange, { start, end: formatTime(event.endTime, locale) }) : start;
}

/**
 * A day's heading: "Today, Thursday 3 December", "Tomorrow, …", or just the
 * date. `short` is Home's "Thu 3 Dec". The year shows only when it isn't
 * this year's. Read in UTC, since the day is a UTC midnight; capitalised
 * because a Swedish weekday is lowercase.
 */
export function upcomingDayHeading(
  date: Date,
  today: number,
  locale: Locale,
  dict: { today: string; tomorrow: string },
  style: "long" | "short",
): string {
  const day = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  const otherYear = date.getUTCFullYear() !== dayNumberToDate(today).getUTCFullYear();
  const dateText = new Intl.DateTimeFormat(locale, {
    weekday: style,
    day: "numeric",
    month: style,
    ...(otherYear && { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
  const relative = day === today ? dict.today : day === today + 1 ? dict.tomorrow : null;
  const text = relative ? `${relative}, ${dateText}` : dateText;
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
