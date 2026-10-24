import { prisma } from "@/lib/prisma";
import { getWeekStart, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

// GAP-55: the next few days each recipe is on the plan, for the recipe
// sheet's "Planned: Tue 21 Oct, Sat 25 Oct" line. The upcoming side of
// GAP-46's "last cooked", so a household doesn't plan the same dish twice
// without noticing. One query for the whole household, grouped here, like
// getRecipeCookedStats; a recipe that isn't planned has no key at all.
export const PLANNED_DATES_LIMIT = 3;

export type RecipePlannedDate = {
  // yyyy-mm-dd (UTC day, like every planner date).
  dateKey: string;
  // Monday of that day's week, for the `?week=` link.
  weekStartKey: string;
};

export async function getRecipePlannedDates(
  householdId: string,
  now: Date = new Date(),
): Promise<Record<string, RecipePlannedDate[]>> {
  // Entry dates are UTC midnights, so "today" is too: an entry for today
  // still counts as planned.
  const today = new Date(toDateKey(now));
  const entries = await prisma.mealPlanEntry.findMany({
    where: { mealPlan: { householdId }, recipeId: { not: null }, date: { gte: today } },
    select: { recipeId: true, date: true },
    orderBy: { date: "asc" },
  });
  const planned: Record<string, RecipePlannedDate[]> = {};
  for (const entry of entries) {
    if (entry.recipeId === null) continue;
    const list = (planned[entry.recipeId] ??= []);
    const dateKey = toDateKey(entry.date);
    // A recipe on lunch and dinner the same day names that day once.
    if (list.length >= PLANNED_DATES_LIMIT || list.some((d) => d.dateKey === dateKey)) continue;
    list.push({ dateKey, weekStartKey: toDateKey(getWeekStart(entry.date)) });
  }
  return planned;
}
