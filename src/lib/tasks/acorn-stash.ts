// Acorn stash: the sums behind the opt-in chore game on the Tasks page
// (Household.acornStashEnabled; design in
// docs/superpowers/specs/2026-11-27-acorn-stash-design.md). Every tick of a
// household task writes a TaskCompletion row worth one acorn; this turns
// those rows into what the stash card shows for each current member:
//  - `week`: acorns from ticks in this Monday-start week,
//  - `allTime`: every acorn they have,
//  - `streak`: how many local days in a row, ending today or yesterday,
//    they ticked at least one task. Yesterday counts so a streak doesn't read
//    as gone first thing in the morning; a run that has ended is simply 0,
//    never a "lost" state (no loss framing, per the design's guardrails).
// Weeks and days are local calendar days in the visitor's time zone (the
// time-zone cookie, getTimeZone), the same localDayNumber the task schedule
// runs on (recurrence.ts, UX-137), so a tick at 23:40 on a Sunday counts for
// the week it happened in.
//
// Members come out in the order they're given (the page passes join order),
// never sorted by count: the card is a set of piles side by side, not a
// ranked table. `leader` marks everyone with this week's highest pile, ties
// included, and nobody in a week with no acorns yet.
//
// Rows whose member has left the household (memberId null after SetNull, or
// an id no longer in `memberIds`) are left out entirely.
//
// What it reads is bounded, so a Tasks page render (and every tick, which
// revalidates it) costs the same in a household's fifth year as in its
// first: loadAcornStash sums the all-time totals in the database (a
// groupBy by member) and fetches rows only from the last
// ACORN_STREAK_CAP_DAYS, which covers this week and any streak up to the
// cap. A run longer than that reads as the cap ("365 days in a row"): still
// true, and a number nobody checks against a calendar.

import { localDayNumberIn } from "@/app/dashboard/tasks/recurrence";
import { prisma } from "@/lib/prisma";
import { isTimeZone } from "@/lib/time-zone";

/** The longest streak the card counts to (see the header). */
export const ACORN_STREAK_CAP_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AcornCompletion = {
  memberId: string | null;
  completedAt: Date;
  acorns: number;
};

export type AcornStashMember = {
  memberId: string;
  week: number;
  allTime: number;
  streak: number;
  leader: boolean;
};

/** Monday of the week `day` (days since 1970-01-01) falls in. */
function mondayDayNumber(day: number): number {
  // 1970-01-01 was a Thursday, three days after its week's Monday.
  return day - ((((day + 3) % 7) + 7) % 7);
}

/**
 * Consecutive days in `days` ending at `today`, or at yesterday when today
 * has none, counted up to ACORN_STREAK_CAP_DAYS.
 */
function currentStreak(days: Set<number>, today: number): number {
  let day = days.has(today) ? today : today - 1;
  let streak = 0;
  while (streak < ACORN_STREAK_CAP_DAYS && days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

export function computeAcornStash({
  memberIds,
  allTime,
  completions,
  now,
  timeZone,
}: {
  /** Current household members, in the order the card lists them. */
  memberIds: string[];
  /** Each member's all-time acorn total (missing reads as 0). */
  allTime: ReadonlyMap<string, number>;
  /**
   * Completions from at least the last ACORN_STREAK_CAP_DAYS local days
   * (older ones are harmless, just unneeded): the week and streak come
   * from these.
   */
  completions: AcornCompletion[];
  now: Date;
  timeZone: string;
}): AcornStashMember[] {
  const dayOf = localDayNumberIn(isTimeZone(timeZone) ? timeZone : "UTC");
  const today = dayOf(now);
  const weekStart = mondayDayNumber(today);
  const weekEnd = weekStart + 7;

  const stats = new Map(memberIds.map((id) => [id, { week: 0, days: new Set<number>() }]));
  for (const completion of completions) {
    const entry = completion.memberId === null ? undefined : stats.get(completion.memberId);
    if (!entry) continue;
    const day = dayOf(completion.completedAt);
    entry.days.add(day);
    if (day >= weekStart && day < weekEnd) entry.week += completion.acorns;
  }

  const topWeek = Math.max(0, ...[...stats.values()].map((s) => s.week));
  return memberIds.map((memberId) => {
    const entry = stats.get(memberId)!;
    return {
      memberId,
      week: entry.week,
      allTime: allTime.get(memberId) ?? 0,
      streak: currentStreak(entry.days, today),
      leader: topWeek > 0 && entry.week === topWeek,
    };
  });
}

/**
 * The stash for `memberIds` (current members, in card order), read for one
 * household only. Two queries in parallel: the all-time sums, and the rows
 * of the streak window. The window starts two days before the cap so that
 * every row on the earliest local day a capped streak can reach is in it,
 * whatever the zone's offset or a DST change does to the day's length.
 */
export async function loadAcornStash({
  householdId,
  memberIds,
  now,
  timeZone,
}: {
  householdId: string;
  memberIds: string[];
  now: Date;
  timeZone: string;
}): Promise<AcornStashMember[]> {
  const where = { householdId, memberId: { in: memberIds } };
  const since = new Date(now.getTime() - (ACORN_STREAK_CAP_DAYS + 2) * MS_PER_DAY);
  const [totals, completions] = await Promise.all([
    prisma.taskCompletion.groupBy({ by: ["memberId"], where, _sum: { acorns: true } }),
    prisma.taskCompletion.findMany({
      where: { ...where, completedAt: { gte: since } },
      select: { memberId: true, completedAt: true, acorns: true },
    }),
  ]);
  const allTime = new Map<string, number>();
  for (const total of totals) {
    if (total.memberId !== null) allTime.set(total.memberId, total._sum.acorns ?? 0);
  }
  return computeAcornStash({ memberIds, allTime, completions, now, timeZone });
}
