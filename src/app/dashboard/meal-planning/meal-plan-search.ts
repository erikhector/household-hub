// GAP-59: "when did we last have lasagna?" without paging the planner week by
// week. A plain module (no "use server"), like cook-soon.ts: the action in
// search-actions.ts is the only caller, and the unit test drives it directly.
import { prisma } from "@/lib/prisma";
import { addDays, getWeekStart, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { MEAL_SEARCH_MIN_CHARS, type MealType } from "@/app/dashboard/meal-planning/meal-types";

export const MEAL_SEARCH_LIMIT = 20;
// A year either side of today: far enough for "last Christmas" and "next
// Easter", short enough that the date filter keeps the scan small for a
// household that has planned for years.
export const MEAL_SEARCH_WINDOW_DAYS = 365;
// The field is a free-text box, so cap what reaches the database.
export const MEAL_SEARCH_MAX_CHARS = 100;

export type MealSearchResult = {
  id: string;
  /** yyyy-mm-dd of the planned day. */
  dateKey: string;
  mealType: MealType;
  name: string;
  /** yyyy-mm-dd of the Monday of that day's week: the planner's `?week=`. */
  weekStartKey: string;
};

/**
 * Planned meals whose recipe title or freeform name contains `query`
 * (case-insensitive), within a year either side of `today`, newest first and
 * capped at 20. One household-scoped query; nothing is written.
 */
export async function searchMealPlan(
  householdId: string,
  query: string,
  today: Date = new Date(),
): Promise<MealSearchResult[]> {
  const term = query.trim().slice(0, MEAL_SEARCH_MAX_CHARS);
  if (term.length < MEAL_SEARCH_MIN_CHARS) return [];

  // Entry dates are UTC midnight (date-utils.ts), so anchor the window there.
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      mealPlan: { householdId },
      date: { gte: addDays(day, -MEAL_SEARCH_WINDOW_DAYS), lte: addDays(day, MEAL_SEARCH_WINDOW_DAYS) },
      OR: [
        { freeformName: { contains: term, mode: "insensitive" } },
        { recipe: { name: { contains: term, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      date: true,
      mealType: true,
      freeformName: true,
      recipe: { select: { name: true } },
    },
    // Dinner before lunch within a day: the enum is declared in day order,
    // so descending is the same "newest first" the days use.
    orderBy: [{ date: "desc" }, { mealType: "desc" }, { id: "asc" }],
    take: MEAL_SEARCH_LIMIT,
  });

  return entries.map((entry) => ({
    id: entry.id,
    dateKey: toDateKey(entry.date),
    mealType: entry.mealType,
    name: entry.recipe?.name ?? entry.freeformName ?? "",
    weekStartKey: toDateKey(getWeekStart(entry.date)),
  }));
}
