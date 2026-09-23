// Pure aggregation logic for the household-tasks "weekly recap" (see
// docs/archive/JOY_GAP_BACKLOG.md item 6c) — split out from page.tsx so it's unit-testable
// without Prisma, mirroring meal-variety-calc.ts's shape. Groups this week's
// completed tasks by whoever completed them, framed as coverage rather than
// a score: display names are resolved by the caller (page/component layer),
// and a quiet week is meant to produce an empty array, not a penalty — same
// non-goal as MealVarietyRecap.
//
// Grouping is by first-appearance order (the order `tasks` was given in),
// never by how many tasks a group has — sorting by count would turn this
// into a per-person leaderboard, which the feature explicitly must not be
// (see Guardrails in docs/archive/JOY_GAP_BACKLOG.md). No count is exposed either; the
// caller renders each group's task titles, never a number.

import { getWeekStart } from "@/app/dashboard/meal-planning/date-utils";

export type WeeklyRecapTask = {
  title: string;
  completedAt: Date | null;
  completedByMemberId: string | null;
};

export type WeeklyRecapGroup = {
  completedByMemberId: string | null;
  titles: string[];
};

/**
 * Tasks completed within the Monday-start week containing `now`, grouped by
 * completer's member id (`null` for a task whose completer is unattributed
 * — e.g. the completing member later left the household, see
 * HouseholdTask.completedByMemberId's onDelete: SetNull). Pass `tasks`
 * ordered by `completedAt` ascending if chronological title order within a
 * group matters to the caller.
 */
export function computeWeeklyTaskRecap({
  tasks,
  now,
}: {
  tasks: WeeklyRecapTask[];
  now: Date;
}): WeeklyRecapGroup[] {
  const weekStart = getWeekStart(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const order: (string | null)[] = [];
  const titlesByCompleter = new Map<string | null, string[]>();

  for (const task of tasks) {
    if (task.completedAt === null || task.completedAt < weekStart || task.completedAt >= weekEnd) continue;
    const key = task.completedByMemberId;
    if (!titlesByCompleter.has(key)) {
      titlesByCompleter.set(key, []);
      order.push(key);
    }
    titlesByCompleter.get(key)!.push(task.title);
  }

  return order.map((completedByMemberId) => ({
    completedByMemberId,
    titles: titlesByCompleter.get(completedByMemberId)!,
  }));
}
