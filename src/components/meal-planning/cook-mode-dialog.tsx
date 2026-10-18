"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Timer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  createDialogHandle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import {
  cookScale,
  currentStepIndex,
  formatCookQuantity,
  formatCountdown,
  formatTimerLabel,
  hasCookProgress,
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
//
// UX-94 — closing with a running timer or a ticked step asks first (the
// content reports its progress up; a back gesture, swipe, Escape and the
// Close button all go through onOpenChange, so one check covers them), and
// when opened from a planned meal `onDone` adds a primary "Done — mark as
// cooked" once the last step is ticked.
export function CookModeDialog({
  dict,
  locale,
  recipe,
  portions = null,
  handle,
  onDone,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  recipe: RecipeData;
  portions?: number | null;
  /** Opened from the planner's and recipe list's row sheets (see
   * createDialogHandle), so it has no trigger of its own. */
  handle: DialogHandle;
  /** Opens the meal's mark-as-cooked review. Only passed for a planned,
   * not yet cooked meal; the recipe list has nothing to mark. */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Written by the content (an effect), read when a close is requested, so
  // it needs no re-render of this component.
  const progress = useRef({ steps: 0, timers: 0 });
  const onProgress = useCallback((steps: number, timers: number) => {
    progress.current = { steps, timers };
  }, []);
  const [confirmHandle] = useState(() => createDialogHandle());
  const [timerRunning, setTimerRunning] = useState(false);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next, eventDetails) => {
          if (!next && hasCookProgress(progress.current.steps, progress.current.timers)) {
            // Keep the view open and ask. Cancelling also makes the dialog
            // re-arm its history entry, so a second back gesture still works.
            eventDetails.cancel();
            setTimerRunning(progress.current.timers > 0);
            confirmHandle.open(null);
            return;
          }
          setOpen(next);
        }}
        handle={handle}
      >
        {/* Rendered only while open, so the wake lock is released and the
            ticked steps are dropped the moment the view closes. */}
        {open && (
          <CookModeContent
            dict={dict}
            locale={locale}
            recipe={recipe}
            portions={portions}
            onProgress={onProgress}
            onDone={
              onDone
                ? () => {
                    // Deliberate: no "stop cooking?" prompt on the way to
                    // recording the meal.
                    progress.current = { steps: 0, timers: 0 };
                    setOpen(false);
                    onDone();
                  }
                : undefined
            }
          />
        )}
      </Dialog>
      <ConfirmDialog
        handle={confirmHandle}
        title={dict.cookStopConfirm.title}
        description={timerRunning ? dict.cookStopConfirm.descriptionTimer : dict.cookStopConfirm.descriptionSteps}
        cancelLabel={dict.cookStopConfirm.cancel}
        confirmLabel={dict.cookStopConfirm.confirm}
        pendingLabel={dict.cookStopConfirm.confirming}
        onConfirm={() => {
          progress.current = { steps: 0, timers: 0 };
          setOpen(false);
        }}
      />
    </>
  );
}

function CookModeContent({
  dict,
  locale,
  recipe,
  portions,
  onProgress,
  onDone,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  recipe: RecipeData;
  portions: number | null;
  onProgress: (doneSteps: number, runningTimers: number) => void;
  onDone?: () => void;
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
  const timerCount = Object.keys(timers).length;
  useEffect(() => {
    onProgress(done.size, timerCount);
  }, [done, timerCount, onProgress]);

  // UX-94 — the step the cook is on is outlined, "Next step" ticks it and
  // scrolls to the one after. `scrollTarget` is set by the click and consumed
  // by the effect once the new highlight has rendered.
  const current = currentStepIndex(steps.length, done);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const scrollTarget = useRef<number | null>(null);
  useEffect(() => {
    const target = scrollTarget.current;
    if (target == null) return;
    scrollTarget.current = null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stepRefs.current[target]?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [done]);
  const nextStep = () => {
    if (current == null) return;
    const next = new Set(done).add(current);
    scrollTarget.current = currentStepIndex(steps.length, next);
    setDone(next);
  };
  // Ingredients tick off while prepping; like the steps, component state only.
  const [gathered, setGathered] = useState<ReadonlySet<string>>(new Set());
  const toggleIngredient = (id: string) =>
    setGathered((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
            <ul className="flex flex-col gap-1 text-base">
              {recipe.ingredients.map((ingredient) => {
                const isGathered = gathered.has(ingredient.id);
                return (
                  <li key={ingredient.id}>
                    {/* Whole row is the target (M3); aria-pressed plus the
                        check and strike-through carry the state (M5). */}
                    <button
                      type="button"
                      aria-pressed={isGathered}
                      onClick={() => toggleIngredient(ingredient.id)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:bg-muted",
                        isGathered && "opacity-50",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md border",
                          isGathered && "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {isGathered && <Check className="size-4" />}
                      </span>
                      <span className={cn("min-w-0 break-words", isGathered && "line-through")}>
                        {ingredient.quantity > 0 && (
                          <span className="font-medium">
                            {formatCookQuantity(ingredient.quantity, scale, locale)}
                            {ingredient.unit ? ` ${unitLabel(ingredient.unit)}` : ""}{" "}
                          </span>
                        )}
                        {ingredient.name}
                        {ingredient.note && <span className="text-muted-foreground"> ({ingredient.note})</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
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
              const isCurrent = index === current;
              return (
                <li
                  key={index}
                  ref={(el) => {
                    stepRefs.current[index] = el;
                  }}
                  aria-current={isCurrent ? "step" : undefined}
                  className="scroll-mt-16 scroll-mb-32"
                >
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
                      isCurrent && "border-2 border-primary bg-muted/50",
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
                    <span className={cn("min-w-0 break-words", isDone && "line-through")}>
                      {/* aria-current says it to a screen reader; the label
                          keeps the outline from being colour alone (M5). */}
                      {isCurrent && (
                        <span aria-hidden className="mb-1 block text-xs font-semibold tracking-wide uppercase text-primary">
                          {dict.cookCurrentStep}
                        </span>
                      )}
                      {step}
                    </span>
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
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 bg-popover px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8">
          {/* UX-94: the one primary action is whatever comes next. Mid-recipe
              it ticks the current step and moves on; after the last step,
              from a planned meal, it records the meal. */}
          {current != null && (
            <Button type="button" size="lg" className="min-h-14 w-full text-lg" onClick={nextStep}>
              {dict.cookNextStep}
            </Button>
          )}
          {current == null && steps.length > 0 && onDone && (
            <Button type="button" size="lg" className="min-h-14 w-full text-lg" onClick={onDone}>
              <Check aria-hidden />
              {dict.cookDone}
            </Button>
          )}
          <DialogClose render={<Button type="button" size="lg" variant="outline" className="min-h-11 w-full" />}>
            {dict.cookModeClose}
          </DialogClose>
        </div>
      </div>
    </DialogContent>
  );
}
