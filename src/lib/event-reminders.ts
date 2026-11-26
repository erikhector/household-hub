// GAP-88a: day-ahead push reminders for household calendar events. A member
// sets "The morning of" or "The day before" on an event
// (HouseholdEvent.reminder, the event sheet); every member who turned on
// User.eventReminderNudge (Profile) gets a push for it from the daily
// `/api/cron/sync-notifications` run. Push only, never a bell entry: the
// bell badge means something needs fixing, and a birthday doesn't.
//
// Event times are floating wall-clock dates (src/lib/household-events.ts),
// so "the morning of" means the run on the event's day in the recipient's
// own zone and "the day before" the run on the day before. The zone is the
// one the recipient's push devices report (PushSubscription.timeZone, UTC
// when none does), since the push is what goes to those devices. A run's
// "today" for a recipient is the later of their local date and the UTC
// date, the rule syncTaskDueNudge uses: the run is at 06:00 UTC, still the
// evening before west of UTC, and a push then about an event that day is
// a day early rather than useful. A run that finds the day already past
// (a missed run) sends nothing late: dueReminderOccurrence only ever
// matches today.
//
// Each push is claimed first with an EventReminderSend row keyed by
// recipient, event and occurrence day, the WeeklyDigestSend pattern: a
// doubled or retried run hits the unique and skips instead of pushing
// twice. A claim whose push is then silenced by quiet hours stays claimed,
// as every other push here is lossy under quiet hours (src/lib/push.ts).

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { sendPushToHouseholdMembers } from "@/lib/push";
import { isTimeZone } from "@/lib/time-zone";
import { todayDayNumber } from "@/app/dashboard/tasks/task-due";
import { dayNumberToDate, describeEventTime, dueReminderOccurrence, eventDayNumber } from "@/lib/household-events";
import { getDictionaryForLocale } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale } from "@/lib/i18n/locales";
import { format } from "@/lib/i18n/format";

/**
 * Sends the household's due event reminders to its opted-in members. Trusts
 * `householdId` (the cron's own candidate lookup), like the syncs in
 * src/lib/notifications.ts; every query here is scoped by it, and the push
 * goes through the household's memberships.
 */
export async function syncEventReminders(householdId: string, now: Date = new Date()): Promise<void> {
  const utcToday = todayDayNumber(now);

  // Claims for days already past can't matter to any later run (no
  // recipient's "today" is before the UTC date), so drop them here.
  await prisma.eventReminderSend.deleteMany({
    where: { event: { householdId }, occurrenceDate: { lt: dayNumberToDate(utcToday) } },
  });

  const users = await prisma.user.findMany({
    where: { eventReminderNudge: true, memberships: { some: { householdId } } },
    select: { id: true, locale: true },
  });
  if (users.length === 0) return;

  const zones = await getRecipientTimeZones(users.map((user) => user.id));
  const recipients = users.map((user) => {
    const timeZone = zones.get(user.id) ?? "UTC";
    return { ...user, today: Math.max(todayDayNumber(now, timeZone), utcToday) };
  });

  // One query for every recipient's window: from the earliest "today" to
  // the day after the latest (the day before's occurrence).
  const from = Math.min(...recipients.map((r) => r.today));
  const to = Math.max(...recipients.map((r) => r.today)) + 1;
  const events = await prisma.householdEvent.findMany({
    where: {
      householdId,
      reminder: { not: null },
      date: { lte: dayNumberToDate(to) },
      OR: [{ recurrence: { not: null } }, { date: { gte: dayNumberToDate(from) } }],
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { id: true, title: true, date: true, startTime: true, endTime: true, recurrence: true, reminder: true },
  });
  if (events.length === 0) return;

  for (const recipient of recipients) {
    const locale = isLocale(recipient.locale) ? recipient.locale : defaultLocale;
    const dict = getDictionaryForLocale(locale).calendar;
    for (const event of events) {
      const occurrence = dueReminderOccurrence(event, recipient.today);
      if (!occurrence) continue;

      try {
        await prisma.eventReminderSend.create({
          data: { userId: recipient.id, eventId: event.id, occurrenceDate: occurrence },
        });
      } catch (error) {
        // P2002: already sent for this occurrence (an earlier or racing run).
        if (isUniqueViolation(error)) continue;
        throw error;
      }

      const day = eventDayNumber(occurrence) === recipient.today ? dict.today : dict.tomorrow;
      await sendPushToHouseholdMembers(householdId, [recipient.id], {
        title: event.title,
        // "Today" for an all-day event, "Today, 14:30" (or a range) otherwise.
        body: event.startTime
          ? format(dict.reminderPushBody, { day, time: describeEventTime(event, locale, dict) })
          : day,
        url: "/dashboard/calendar",
      });
    }
  }
}

// Each recipient's zone: the one most of their push devices report (the
// newest device breaks a tie, since the rows come newest first), skipping
// unknown names. A user whose devices report none is left out, and the
// caller falls back to UTC. Per user rather than one per household like
// the task nudge's (getTaskDueTimeZone), because a reminder is a push per
// person with no shared bell entry to agree on a day for.
async function getRecipientTimeZones(userIds: string[]): Promise<Map<string, string>> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds }, timeZone: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { userId: true, timeZone: true },
  });
  const counts = new Map<string, Map<string, number>>();
  for (const { userId, timeZone } of subscriptions) {
    if (!isTimeZone(timeZone)) continue;
    const userCounts = counts.get(userId) ?? new Map<string, number>();
    userCounts.set(timeZone, (userCounts.get(timeZone) ?? 0) + 1);
    counts.set(userId, userCounts);
  }
  const zones = new Map<string, string>();
  for (const [userId, userCounts] of counts) {
    let best = "";
    let bestCount = 0;
    for (const [zone, count] of userCounts) {
      if (count > bestCount) [best, bestCount] = [zone, count];
    }
    zones.set(userId, best);
  }
  return zones;
}

/**
 * The candidate filter for findHouseholdIdsWithSyncCandidates
 * (src/lib/notifications.ts), side by side with the sync's own query so the
 * two can't drift. Never narrower than syncEventReminders: a recipient's
 * "today" is at most a day past the UTC date (no zone is more than +14 h),
 * and "the day before" looks one day further, hence two extra days.
 */
export function eventReminderCandidateWhere(now: Date): Prisma.HouseholdWhereInput {
  const utcToday = todayDayNumber(now);
  return {
    members: { some: { user: { eventReminderNudge: true } } },
    events: {
      some: {
        reminder: { not: null },
        date: { lte: dayNumberToDate(utcToday + 2) },
        OR: [{ recurrence: { not: null } }, { date: { gte: dayNumberToDate(utcToday) } }],
      },
    },
  };
}
