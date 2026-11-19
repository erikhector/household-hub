"use client";

import { LazyDialog } from "@/components/ui/lazy-dialog";
import {
  loadMarkCookedDialog,
  loadPickMealsDialog,
  loadPlacePickDialog,
  loadSpreadPicksDialog,
} from "@/components/meal-planning/lazy-dialogs";
import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import type { PlanLeftoversRequest } from "@/components/meal-planning/mark-cooked-dialog";
import type { buildWeek, MealPlanningDict } from "@/components/meal-planning/week-planner-helpers";
import type { WeekPicksPlanning } from "@/components/meal-planning/use-week-picks";
import type { RecipeData } from "@/components/meal-planning/types";

type Week = ReturnType<typeof buildWeek>;

// The week picks' dialogs: picking meals for the week, a pick's place
// sheet, Spread and the "Mark as cooked today" review. Each loads on first
// use and is mounted only while open.
export function WeekPicksDialogs({
  dict,
  weekRange,
  weekStartKey,
  recipes,
  recipeCooked,
  placeDays,
  freeDinners,
  planning,
  onPlanLeftovers,
}: {
  dict: MealPlanningDict;
  weekRange: string;
  weekStartKey: string;
  recipes: RecipeData[];
  recipeCooked: Record<string, RecipeCookedStats>;
  placeDays: Week["placeDays"];
  freeDinners: Week["freeDinners"];
  planning: WeekPicksPlanning;
  onPlanLeftovers: (request: PlanLeftoversRequest) => void;
}) {
  const { picks, pickerOpen, setPickerOpen, placeSheet, setPlaceSheet, spreadOpen, setSpreadOpen, cookingEntry, cookHandle } =
    planning;
  return (
    <>
      <LazyDialog loader={loadPickMealsDialog} open={pickerOpen} onLoadError={() => setPickerOpen(false)}>
        {(PickMeals) =>
          pickerOpen && (
            <PickMeals
              dict={dict}
              weekLabel={weekRange}
              weekStartKey={weekStartKey}
              recipes={recipes}
              recipeCooked={recipeCooked}
              pickedRecipeIds={new Set(picks.flatMap((p) => (p.recipeId ? [p.recipeId] : [])))}
              onClose={() => setPickerOpen(false)}
            />
          )
        }
      </LazyDialog>
      <LazyDialog loader={loadPlacePickDialog} open={placeSheet !== null} onLoadError={() => setPlaceSheet(null)}>
        {(PlacePick) =>
          placeSheet && (
            <PlacePick
              key={placeSheet.id}
              dict={dict}
              pick={placeSheet}
              days={placeDays}
              onPlace={(dateKey, mealType, dayLabel) => planning.placePick(placeSheet, dateKey, mealType, dayLabel)}
              onMarkCooked={() => planning.markPickCooked(placeSheet)}
              onRemove={() => planning.removePick(placeSheet)}
              onClose={() => setPlaceSheet(null)}
            />
          )
        }
      </LazyDialog>
      <LazyDialog loader={loadSpreadPicksDialog} open={spreadOpen} onLoadError={() => setSpreadOpen(false)}>
        {(SpreadPicks) =>
          spreadOpen && (
            <SpreadPicks
              dict={dict}
              picks={picks}
              freeDinners={freeDinners}
              onPlaceAll={planning.placeAll}
              onClose={() => setSpreadOpen(false)}
            />
          )
        }
      </LazyDialog>
      <LazyDialog loader={loadMarkCookedDialog} handle={cookHandle}>
        {(MarkCooked) =>
          cookingEntry && (
            <MarkCooked
              key={cookingEntry.id}
              dict={dict}
              entry={cookingEntry}
              onPlanLeftovers={onPlanLeftovers}
              handle={cookHandle}
              onDismissed={() => planning.cookDismissed(cookingEntry)}
            />
          )
        }
      </LazyDialog>
    </>
  );
}
