"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadMealEntryDialog } from "@/components/meal-planning/lazy-dialogs";
import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import type { MealType } from "@/app/dashboard/meal-planning/meal-types";
import type { MealPlanningDict } from "@/components/meal-planning/week-planner-helpers";
import { format } from "@/lib/i18n/format";
import type { PreparedBatchData, RecipeData, WeekPickData } from "@/components/meal-planning/types";

// PERF-26: a day's "+ Add meal" (or an empty week's "Add first dinner")
// and the meal form behind it. The button stays in the planner's own chunk;
// the form loads on first use, warmed on pointer-enter or focus.
export function AddMealSlot({
  dict,
  weekStartKey,
  dateKey,
  dayLabel,
  mealType,
  recipes,
  recipeCooked,
  batches,
  picks,
  onPlacePick,
  firstDinner = false,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  dateKey: string;
  dayLabel: string;
  mealType: MealType;
  recipes: RecipeData[];
  recipeCooked: Record<string, RecipeCookedStats>;
  batches: PreparedBatchData[];
  /** Week picks offered first in the sheet ("From this week's picks"). */
  picks?: WeekPickData[];
  onPlacePick?: (pick: WeekPickData, mealType: MealType) => void;
  /** The empty week's one next step: a primary button, not the day's row. */
  firstDinner?: boolean;
}) {
  const [handle] = useState(() => createDialogHandle());
  const open = () => openLazyDialog(handle);
  const intent = preloadOnIntent(loadMealEntryDialog);
  return (
    <>
      {firstDinner ? (
        <Button type="button" aria-haspopup="dialog" onClick={open} {...intent}>
          <Plus className="size-4" />
          {dict.addFirstDinner}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          aria-label={format(dict.addMealAriaLabel, { day: dayLabel })}
          aria-haspopup="dialog"
          className="h-9 w-full justify-start gap-1 px-2 text-sm text-muted-foreground max-sm:h-11"
          onClick={open}
          {...intent}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {dict.addMeal}
        </Button>
      )}
      <LazyDialog loader={loadMealEntryDialog} handle={handle}>
        {(MealEntry) => (
          <MealEntry
            dict={dict}
            weekStartKey={weekStartKey}
            dateKey={dateKey}
            dayLabel={dayLabel}
            mealType={mealType}
            recipes={recipes}
            recipeCooked={recipeCooked}
            batches={batches}
            picks={picks}
            onPlacePick={onPlacePick}
            handle={handle}
          />
        )}
      </LazyDialog>
    </>
  );
}
