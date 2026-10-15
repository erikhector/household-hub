"use client";

import { useEffect, useState } from "react";
import { Check, Timer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, type DialogHandle } from "@/components/ui/dialog";
import {
  cookScale,
  formatCookQuantity,
  formatCountdown,
  formatTimerLabel,
  parseStepDuration,
  splitSteps,
} from "@/lib/cook-mode-calc";
import { useScreenWakeLock } from "@/lib/shopping/use-screen-wake-lock";
import { format, plural } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { useUnitLabel } from "@/components/units-provider";

type MealPlanningDict = Dictionary["mealPlanning"];

// Wall-clock time for the step timers. Only called from effects and click
// handlers, never while rendering; a named helper keeps the purity lint rule
// (which can't tell a handler from render code) quiet.
const clockNow = () => Date.now();

// GAP-42 — the "Cook" view: a full-screen read-only take on a recipe for use
// at the stove. Large step text, the ingredients, and steps you tap to
// cross off. The ticks and step timers (GAP-50) are component state only — nothing is saved, so
// closing and reopening starts fresh (no cookie-inventory entry needed).
// `portions` is the meal entry's portion count when opened from the planner,
// which scales the ingredient amounts; null (the recipe list) shows the
// recipe's own amounts.
export function CookModeDialog({
  dict,
  locale,
  recipe,
  portions = null,
  handle,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  recipe: RecipeData;
  portions?: number | null;
  /** Opened from the planner's and recipe list's row sheets (see
   * createDialogHandle), so it has no trigger of its own. */
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen} handle={handle}>
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

  // GAP-50 — step timers. `timers` maps a step to the wall-clock time it ends
  // (an end time, not a counter, so a throttled background tab catches up the
  // moment it wakes); `finished` lists the steps whose timer has rung and
  // not yet been dismissed. All component state: closing the view drops
  // every timer, nothing is stored and nothing runs in the background.
  const [timers, setTimers] = useState<Readonly<Record<number, number>>>({});
  const [finished, setFinished] = useState<readonly number[]>([]);
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    if (Object.keys(timers).length === 0) return;
    const id = setInterval(() => {
      const tick = clockNow();
      setNow(tick);
      const rung = Object.keys(timers)
        .map(Number)
        .filter((index) => timers[index] <= tick);
      if (rung.length === 0) return;
      setTimers((prev) => {
        const next = { ...prev };
        for (const index of rung) delete next[index];
        return next;
      });
      setFinished((list) => [...list, ...rung.filter((index) => !list.includes(index))]);
      // A short buzz where supported (not iOS Safari); the alert is the cue
      // everywhere else.
      navigator.vibrate?.([200, 100, 200]);
    }, 500);
    return () => clearInterval(id);
  }, [timers]);
  const startTimer = (index: number, seconds: number) => {
    const start = clockNow();
    setNow(start);
    setTimers((prev) => ({ ...prev, [index]: start + seconds * 1000 }));
    setFinished((list) => list.filter((i) => i !== index));
  };
  const stopTimer = (index: number) =>
    setTimers((prev) => {
      const next = { ...prev };
      delete next[index];
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

        {/* Sticky so a ring is seen wherever the cook has scrolled to; role
            "alert" announces it to a screen reader. Stays until dismissed:
            a cook with floury hands may not look for a few seconds. */}
        {finished.length > 0 && (
          <div className="sticky top-0 z-10 flex flex-col gap-2">
            {finished.map((index) => (
              <div
                key={index}
                role="alert"
                className="flex items-center gap-3 rounded-xl border border-primary bg-popover p-3 text-base font-medium shadow-md"
              >
                <Timer aria-hidden className="size-5 shrink-0" />
                <span className="min-w-0 flex-1 break-words">{format(dict.cookTimerDone, { step: index + 1 })}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setFinished((list) => list.filter((i) => i !== index))}
                >
                  {dict.cookTimerDismiss}
                </Button>
              </div>
            ))}
          </div>
        )}

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
              const seconds = parseStepDuration(step);
              const endsAt = timers[index];
              const remaining = endsAt == null ? 0 : (endsAt - now) / 1000;
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
                  {seconds != null && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-10">
                      {endsAt != null ? (
                        <>
                          <span
                            role="timer"
                            aria-label={format(dict.cookTimerRemaining, { time: formatCountdown(remaining) })}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-muted px-4 text-lg font-medium tabular-nums"
                          >
                            <Timer aria-hidden className="size-5" />
                            {formatCountdown(remaining)}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11"
                            onClick={() => stopTimer(index)}
                          >
                            <X aria-hidden />
                            {dict.cookTimerStop}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          onClick={() => startTimer(index, seconds)}
                        >
                          <Timer aria-hidden />
                          {format(dict.cookTimerStart, { duration: formatTimerLabel(seconds) })}
                        </Button>
                      )}
                    </div>
                  )}
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
