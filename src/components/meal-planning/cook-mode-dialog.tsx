"use client";

import { useState, type ReactElement } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cookScale, formatCookQuantity, splitSteps } from "@/lib/cook-mode-calc";
import { useScreenWakeLock } from "@/lib/shopping/use-screen-wake-lock";
import { format, plural } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { useUnitLabel } from "@/components/units-provider";

type MealPlanningDict = Dictionary["mealPlanning"];

// GAP-42 — the "Cook" view: a full-screen read-only take on a recipe for use
// at the stove. Large step text, the ingredients, and steps you tap to
// cross off. The ticks are component state only — nothing is saved, so
// closing and reopening starts fresh (no cookie-inventory entry needed).
// `portions` is the meal entry's portion count when opened from the planner,
// which scales the ingredient amounts; null (the recipe list) shows the
// recipe's own amounts.
export function CookModeDialog({
  dict,
  locale,
  recipe,
  portions = null,
  trigger,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  recipe: RecipeData;
  portions?: number | null;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      {/* Rendered only while open, so the wake lock is released and the
          ticked steps are dropped the moment the view closes. */}
      {open && <CookModeContent dict={dict} locale={locale} recipe={recipe} portions={portions} />}
    </Dialog>
  );
}

function CookModeContent({
  dict,
  locale,
  recipe,
  portions,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  recipe: RecipeData;
  portions: number | null;
}) {
  const unitLabel = useUnitLabel();
  // Reuses the shopping list's hook (AUTO-3): the lock is requested when this
  // mounts (the view opens) and released when it unmounts (it closes).
  useScreenWakeLock(true);

  const steps = splitSteps(recipe.instructions);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const toggle = (index: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const scale = cookScale(recipe.servings, portions);
  const shownPortions = portions ?? recipe.servings;

  return (
    <DialogContent
      showCloseButton={false}
      // Fills the screen on every size: overrides the bottom-sheet / centred
      // modal geometry. The dialog stays the one scroll container.
      className="inset-0 h-dvh max-h-none content-start gap-6 rounded-none p-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-0 sm:h-dvh sm:max-h-none sm:w-full sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-8 sm:pb-8"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <DialogTitle className="text-2xl font-semibold break-words">
            {format(dict.cookModeTitle, { name: recipe.name })}
          </DialogTitle>
          <p className="mt-1 text-base text-muted-foreground">
            {format(plural(shownPortions, dict.entryPortionsCount), { count: shownPortions })}
          </p>
        </div>

        {recipe.ingredients.length > 0 && (
          <section aria-labelledby="cook-ingredients" className="flex flex-col gap-2">
            <h3 id="cook-ingredients" className="font-heading text-lg font-semibold">
              {dict.cookModeIngredients}
            </h3>
            <ul className="flex flex-col gap-1.5 text-base">
              {recipe.ingredients.map((ingredient) => (
                <li key={ingredient.id}>
                  {ingredient.quantity > 0 && (
                    <span className="font-medium">
                      {formatCookQuantity(ingredient.quantity, scale, locale)}
                      {ingredient.unit ? ` ${unitLabel(ingredient.unit)}` : ""}{" "}
                    </span>
                  )}
                  {ingredient.name}
                  {ingredient.note && <span className="text-muted-foreground"> ({ingredient.note})</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="cook-steps" className="flex flex-col gap-2">
          <h3 id="cook-steps" className="font-heading text-lg font-semibold">
            {dict.cookModeSteps}
          </h3>
          <ol className="flex flex-col gap-3">
            {steps.map((step, index) => {
              const isDone = done.has(index);
              return (
                <li key={index}>
                  {/* The whole card is the tap target (M3); aria-pressed
                      carries the done state for screen readers, with the
                      dimming, strike-through and check as the visible cues
                      (never colour alone, M5). */}
                  <button
                    type="button"
                    aria-pressed={isDone}
                    onClick={() => toggle(index)}
                    className={cn(
                      "flex min-h-14 w-full items-start gap-3 rounded-xl border p-4 text-left text-xl leading-snug transition-opacity focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:bg-muted",
                      isDone && "opacity-50",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
                        isDone && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {isDone ? <Check className="size-4" /> : index + 1}
                    </span>
                    <span className={cn("min-w-0 break-words", isDone && "line-through")}>{step}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Sticky at the bottom of the scroller, where a thumb is (M2): the
            one way out stays reachable however long the recipe is, and clears
            the home indicator (M9) because the bar pads itself by the inset. */}
        <div className="sticky bottom-0 -mx-4 bg-popover px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8">
          <DialogClose render={<Button type="button" size="lg" variant="outline" className="min-h-11 w-full" />}>
            {dict.cookModeClose}
          </DialogClose>
        </div>
      </div>
    </DialogContent>
  );
}
