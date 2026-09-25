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

import { useState, useSyncExternalStore } from "react";
import { Flame, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { NutritionRecapTotals } from "@/app/dashboard/meal-planning/nutrition-recap-calc";

const DISMISSED_WEEK_STORAGE_KEY = "mealPlanning.nutritionRecapDismissedWeek";

// No-op subscribe: nothing external notifies this of changes — a dismissal
// made in this tab flows through the `justDismissed` state below instead,
// same reasoning as MealVarietyRecap's identical no-op subscribe.
function subscribe() {
  return () => {};
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(DISMISSED_WEEK_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

export function MealNutritionRecap({
  totals,
  weekStartKey,
  dict,
}: {
  totals: NutritionRecapTotals;
  weekStartKey: string;
  dict: Dictionary["mealPlanning"];
}) {
  // Same useSyncExternalStore convention as MealVarietyRecap: getServerSnapshot
  // always returns null so SSR and the first client render agree (no
  // hydration mismatch), and React reconciles the real, possibly-dismissed
  // value right after hydration.
  const dismissedWeek = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [justDismissed, setJustDismissed] = useState(false);

  if (justDismissed || dismissedWeek === weekStartKey) return null;

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

  function handleDismiss() {
    setJustDismissed(true);
    try {
      localStorage.setItem(DISMISSED_WEEK_STORAGE_KEY, weekStartKey);
    } catch {
      // localStorage unavailable (private browsing, blocked site data) —
      // dismiss still works for this render via justDismissed, just won't
      // persist across navigation.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <Flame className="size-4 shrink-0" />
      <p className="flex-1">{format(dict.nutritionRecap, { summary: parts.join(" · ") })}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground"
        aria-label={dict.nutritionRecapDismissAriaLabel}
        onClick={handleDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
