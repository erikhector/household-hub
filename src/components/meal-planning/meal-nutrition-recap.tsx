"use client";

// Small, dismissible recap (BACKLOG GAP-2) mirroring MealVarietyRecap's shape
// (dashed-border row, icon, one-line summary, dismiss button) — a soft
// "here's your week" summary of the nutrition info already entered on
// recipes, never a goal/target tracker: there's no macro target here to
// compare against and no over/under framing, deliberately, since goal-setting
// is a separate, larger, opt-in feature to consider only if this gets used
// (see REQUIREMENTS.md's "Weekly nutrition recap"). The caller only renders
// this when `totals.contributingEntryCount > 0`, so a week with no nutrition
// data entered (or an empty week) shows nothing, same as MealVarietyRecap's
// `count > 0` gate.
//
// Dismissal persists via localStorage, keyed by `weekStartKey` — the week
// currently shown in the planner, already the source of truth for "which
// week" elsewhere on this page — rather than by a rolling value like
// MealVarietyRecap's dismissed-count. The totals here are inherently
// per-week (unlike variety's trailing-30-day window), so switching weeks (or
// coming back to a previously-dismissed one) should show/hide its own recap
// independently. Same per-week-key reasoning as TasksWeeklyRecap
// (src/components/tasks/tasks-weekly-recap.tsx), just keyed off the
// planner's own week param instead of recomputing "this week" client-side.

import { Flame, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDismissedLocalStorage } from "@/components/shared/use-dismissed-local-storage";
import { NUTRITION_RECAP_DISMISSED_STORAGE_KEY } from "@/lib/cookie-inventory";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { NutritionRecapTotals } from "@/app/dashboard/meal-planning/nutrition-recap-calc";

export function MealNutritionRecap({
  totals,
  weekStartKey,
  dict,
}: {
  totals: NutritionRecapTotals;
  weekStartKey: string;
  dict: Dictionary["mealPlanning"];
}) {
  const [dismissedWeek, setDismissedWeek] = useDismissedLocalStorage(NUTRITION_RECAP_DISMISSED_STORAGE_KEY);

  if (dismissedWeek === weekStartKey) return null;

  // Reuses the same per-field value templates RecipeManager's nutrition line
  // uses (dict.nutritionCaloriesValue etc.) so the units read identically in
  // both places, joining only the fields actually set — mirrors
  // RecipeRow's nutritionSummary in recipe-manager.tsx.
  const parts = [
    totals.totalCalories !== null ? format(dict.nutritionCaloriesValue, { value: totals.totalCalories }) : null,
    totals.totalProteinGrams !== null
      ? format(dict.nutritionProteinValue, { value: totals.totalProteinGrams })
      : null,
    totals.totalCarbsGrams !== null ? format(dict.nutritionCarbsValue, { value: totals.totalCarbsGrams }) : null,
    totals.totalFatGrams !== null ? format(dict.nutritionFatValue, { value: totals.totalFatGrams }) : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <Flame className="size-4 shrink-0" />
      <p className="flex-1">{format(dict.nutritionRecap, { summary: parts.join(" · ") })}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground max-sm:size-11 pointer-coarse:size-11"
        aria-label={dict.nutritionRecapDismissAriaLabel}
        onClick={() => setDismissedWeek(weekStartKey)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
