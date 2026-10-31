import { prisma } from "@/lib/prisma";
import { addDays, getWeekStart, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { resolveShelfLifeDays } from "@/lib/inventory/shelf-life";
import { habitWeekday, pickFreshness, type Weekday } from "@/lib/week-picks-spread";
import type { WeekPickData } from "@/components/meal-planning/types";

// Week picks' reads (REQUIREMENTS.md, "Week picks"): the carry-over that
// runs when the planner loads, and the shape the tray is drawn from. The
// writes are in pick-actions.ts.

/**
 * Carry-over: picks still in the tray when their week ended move to the
 * tray of the week containing today, marked with the week they came from
 * ("From last week"). It runs on read, when the meal planning page loads,
 * rather than on a schedule: a household only sees its tray there, so
 * that's the first moment the move matters, and it needs no cron. It's
 * idempotent: each move is guarded on the pick still sitting in a past
 * week, so two loads at once (two members, two tabs) move each pick once,
 * and once moved there's nothing left to find. A pick carried twice keeps
 * the first week it came from. Returns how many moved on this call, for the
 * "N meals moved over from last week" toast.
 */
export async function carryOverPastPicks(householdId: string, now: Date): Promise<number> {
  const weekStartDate = getWeekStart(now);
  const stale = await prisma.mealPlanPick.findMany({
    where: { mealPlan: { householdId, weekStartDate: { lt: weekStartDate } } },
    select: { id: true, carriedFromWeek: true, mealPlan: { select: { weekStartDate: true } } },
  });
  if (stale.length === 0) return 0;

  return await prisma.$transaction(async (tx) => {
    const plan = await tx.mealPlan.upsert({
      where: { householdId_weekStartDate: { householdId, weekStartDate } },
      update: {},
      create: { householdId, weekStartDate },
      select: { id: true },
    });
    let moved = 0;
    for (const pick of stale) {
      const result = await tx.mealPlanPick.updateMany({
        where: { id: pick.id, mealPlan: { householdId, weekStartDate: { lt: weekStartDate } } },
        data: { mealPlanId: plan.id, carriedFromWeek: pick.carriedFromWeek ?? pick.mealPlan.weekStartDate },
      });
      moved += result.count;
    }
    return moved;
  });
}

// How far back cooking history counts for a habit: half a year of weeks,
// long enough to see a "pea soup on Thursdays" pattern, short enough that
// last year's routine doesn't decide this week.
const HABIT_HISTORY_DAYS = 26 * 7;

type PickRow = {
  id: string;
  recipeId: string | null;
  freeformName: string | null;
  portions: number;
  carriedFromWeek: Date | null;
  createdByUserId: string | null;
  recipe: { name: string } | null;
};

type RecipeForFreshness = {
  id: string;
  ingredients: { name: string; inventoryItemId: string | null; untracked: boolean }[];
};

type InventoryForFreshness = {
  id: string;
  name: string;
  quantity: number;
  expiresAt: Date | null;
  shelfLifeDays: number | null;
  category: string;
};

/**
 * The tray's picks with what the planner shows and Spread needs: the name,
 * "Picked by …" when another member picked it, the recipe's habit weekday
 * (from this household's cooked meals) and how perishable its ingredients
 * are (from the pantry, see pickFreshness). One query for the history and
 * one for member names, both skipped when there's nothing to ask.
 */
export async function loadWeekPicks({
  householdId,
  userId,
  picks,
  recipes,
  inventoryItems,
  now,
}: {
  householdId: string;
  userId: string;
  picks: PickRow[];
  recipes: RecipeForFreshness[];
  inventoryItems: InventoryForFreshness[];
  now: Date;
}): Promise<WeekPickData[]> {
  if (picks.length === 0) return [];
  const recipeIds = [...new Set(picks.flatMap((p) => (p.recipeId ? [p.recipeId] : [])))];
  const otherPickers = [
    ...new Set(picks.flatMap((p) => (p.createdByUserId && p.createdByUserId !== userId ? [p.createdByUserId] : []))),
  ];

  const [cooked, members] = await Promise.all([
    recipeIds.length > 0
      ? prisma.mealPlanEntry.findMany({
          where: {
            mealPlan: { householdId },
            recipeId: { in: recipeIds },
            consumedAt: { not: null },
            date: { gte: addDays(now, -HABIT_HISTORY_DAYS) },
          },
          select: { recipeId: true, date: true },
        })
      : [],
    otherPickers.length > 0
      ? prisma.householdMember.findMany({
          where: { householdId, userId: { in: otherPickers } },
          select: { userId: true, user: { select: { displayName: true } } },
        })
      : [],
  ]);

  const cookedDates = new Map<string, string[]>();
  for (const entry of cooked) {
    if (!entry.recipeId) continue;
    const list = cookedDates.get(entry.recipeId) ?? [];
    list.push(toDateKey(entry.date));
    cookedDates.set(entry.recipeId, list);
  }
  const nameByUser = new Map(members.map((member) => [member.userId, member.user.displayName]));
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));

  return picks.flatMap((pick) => {
    const name = pick.recipe?.name ?? pick.freeformName;
    if (!name) return [];
    const recipe = pick.recipeId ? recipeById.get(pick.recipeId) : undefined;
    const habit: Weekday | null = pick.recipeId ? habitWeekday(cookedDates.get(pick.recipeId) ?? []) : null;
    const freshness = recipe
      ? pickFreshness(
          recipe.ingredients
            .filter((ingredient) => !ingredient.untracked)
            .map((ingredient) => {
              const item = ingredient.inventoryItemId ? itemById.get(ingredient.inventoryItemId) : undefined;
              return {
                name: ingredient.name,
                item: item
                  ? {
                      name: item.name,
                      quantity: item.quantity,
                      expiresAt: item.expiresAt,
                      shelfLifeDays: resolveShelfLifeDays(item.shelfLifeDays, item.category),
                    }
                  : null,
              };
            }),
          now,
        )
      : null;
    return [
      {
        id: pick.id,
        recipeId: pick.recipeId,
        name,
        portions: pick.portions,
        carriedFromWeek: pick.carriedFromWeek ? toDateKey(pick.carriedFromWeek) : null,
        createdByUserId: pick.createdByUserId,
        pickedBy: pick.createdByUserId ? (nameByUser.get(pick.createdByUserId) ?? null) : null,
        habitWeekday: habit,
        freshness,
      },
    ];
  });
}
