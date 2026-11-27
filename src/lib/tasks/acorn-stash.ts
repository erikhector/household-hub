// Acorn stash: the pure sums behind the opt-in chore game on the Tasks page
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
// Weeks and days are the household's *local* calendar days in `timeZone`,
// the same localDayNumber the task schedule runs on (recurrence.ts, UX-137),
// so a tick at 23:40 on a Sunday counts for the week it happened in.
//
// Members come out in the order they're given (the page passes join order),
// never sorted by count: the card is a set of piles side by side, not a
// ranked table. `leader` marks everyone with this week's highest pile, ties
// included, and nobody in a week with no acorns yet.
//
// Rows whose member has left the household (memberId null after SetNull, or
// an id no longer in `memberIds`) are left out entirely.

import { localDayNumber } from "@/app/dashboard/tasks/recurrence";
import { isTimeZone } from "@/lib/time-zone";

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

/** Consecutive days in `days` ending at `today`, or at yesterday when today has none. */
function currentStreak(days: Set<number>, today: number): number {
  let day = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

export function computeAcornStash({
  memberIds,
  completions,
  now,
  timeZone,
}: {
  /** Current household members, in the order the card lists them. */
  memberIds: string[];
  completions: AcornCompletion[];
  now: Date;
  timeZone: string;
}): AcornStashMember[] {
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const today = localDayNumber(now, zone);
  const weekStart = mondayDayNumber(today);
  const weekEnd = weekStart + 7;

  const stats = new Map(memberIds.map((id) => [id, { week: 0, allTime: 0, days: new Set<number>() }]));
  for (const completion of completions) {
    const entry = completion.memberId === null ? undefined : stats.get(completion.memberId);
    if (!entry) continue;
    const day = localDayNumber(completion.completedAt, zone);
    entry.allTime += completion.acorns;
    entry.days.add(day);
    if (day >= weekStart && day < weekEnd) entry.week += completion.acorns;
  }

  const topWeek = Math.max(0, ...[...stats.values()].map((s) => s.week));
  return memberIds.map((memberId) => {
    const entry = stats.get(memberId)!;
    return {
      memberId,
      week: entry.week,
      allTime: entry.allTime,
      streak: currentStreak(entry.days, today),
      leader: topWeek > 0 && entry.week === topWeek,
    };
  });
}
