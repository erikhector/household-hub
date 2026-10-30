// GAP-52: pure helpers behind meal-plan templates (see
// src/app/dashboard/meal-planning/template-actions.ts). Dependency-free apart
// from the date helpers so the offset mapping and the skip-filled-slots rule
// can be unit-tested without mocking Prisma.
import { addDays, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import type { MealType } from "@/app/dashboard/meal-planning/meal-types";

// A week holds at most 7 days x 4 slots (plus stacked entries), so this only
// stops a crafted restore call from sending an unbounded list.
export const MAX_TEMPLATE_ENTRIES = 100;
// Same limit a shopping-list template's name has.
export const PLAN_TEMPLATE_NAME_MAX_LENGTH = 120;

export type TemplateEntryInput = {
  dayOffset: number;
  mealType: MealType;
  recipeId: string | null;
  freeformName: string | null;
  portions: number;
};

const DAY_MS = 86_400_000;

/**
 * A week's entries → the rows a template stores. A date becomes its offset
 * from the week's Monday (Tuesday is 1), so the template means the same
 * thing on any week. Entries outside the seven days are dropped, as is one
 * with neither a recipe nor a name (a deleted recipe leaves its slot
 * nameless, and a nameless template slot would stamp out nothing useful).
 * `consumedAt` and the prepared batch are deliberately not carried: cooked
 * state belongs to the week it happened in.
 */
export function buildTemplateEntries(
  weekStart: Date,
  entries: {
    date: Date;
    mealType: MealType;
    recipeId: string | null;
    freeformName: string | null;
    portions: number;
  }[],
): TemplateEntryInput[] {
  return entries
    .flatMap((entry) => {
      const dayOffset = Math.round((entry.date.getTime() - weekStart.getTime()) / DAY_MS);
      if (dayOffset < 0 || dayOffset > 6) return [];
      if (!entry.recipeId && !entry.freeformName) return [];
      return [
        {
          dayOffset,
          mealType: entry.mealType,
          recipeId: entry.recipeId,
          freeformName: entry.recipeId ? null : entry.freeformName,
          portions: entry.portions,
        },
      ];
    })
    .sort((a, b) => a.dayOffset - b.dayOffset);
}

export const templateSlotKey = (date: Date, mealType: string) => `${toDateKey(date)}|${mealType}`;

/**
 * A template's entries → MealPlanEntry data for `weekStart`. A slot (date +
 * meal type) that already has anything in it is left alone, like
 * copyWeekAction, so applying after partly filling a week just fills the
 * gaps. A recipe that is no longer the household's (the FK cascades on
 * delete, so this is a belt-and-braces ownership check) drops the entry
 * rather than writing a nameless one.
 */
export function planTemplateRows(
  weekStart: Date,
  templateEntries: TemplateEntryInput[],
  filledSlots: ReadonlySet<string>,
  ownedRecipeIds: ReadonlySet<string>,
) {
  return templateEntries.flatMap((entry) => {
    const date = addDays(weekStart, entry.dayOffset);
    if (filledSlots.has(templateSlotKey(date, entry.mealType))) return [];
    const recipeId = entry.recipeId && ownedRecipeIds.has(entry.recipeId) ? entry.recipeId : null;
    if (!recipeId && !entry.freeformName) return [];
    return [
      {
        date,
        mealType: entry.mealType,
        recipeId,
        freeformName: recipeId ? null : entry.freeformName,
        portions: entry.portions,
      },
    ];
  });
}
