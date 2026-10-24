"use server";

import { requireHousehold } from "@/lib/session";
import {
  MEAL_SEARCH_MAX_CHARS,
  searchMealPlan,
  type MealSearchResult,
} from "@/app/dashboard/meal-planning/meal-plan-search";

// GAP-59: read-only, so no revalidation. The household comes from the
// session; the client only sends the text. A non-string (a forged call) is
// treated as an empty search rather than thrown on.
export async function searchMealPlanAction(query: string): Promise<MealSearchResult[]> {
  const { household } = await requireHousehold();
  if (typeof query !== "string") return [];
  return searchMealPlan(household.id, query.slice(0, MEAL_SEARCH_MAX_CHARS));
}
