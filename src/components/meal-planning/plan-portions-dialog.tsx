"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PendingLabel } from "@/components/ui/pending-label";
import { PortionStepper } from "@/components/meal-planning/portion-stepper";
import {
  assignBatchPortionsAction,
  loadPlanSlotsAction,
  type PlanSlotEntry,
} from "@/app/dashboard/meal-planning/prep-actions";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { addDays, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { MAX_LEFTOVER_SERVINGS } from "@/app/dashboard/meal-planning/leftover-constants";
import { format, plural } from "@/lib/i18n/format";
import type { PreparedBatchData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

type MealTypeLabelKey = "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack";

const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

// A slot is one day's meal, the unit assignBatchPortionsAction hands
// portions to. Keyed as `yyyy-mm-dd|MEALTYPE`.
const slotKey = (date: string, mealType: MealType) => `${date}|${mealType}`;

// The same rule as assignInTx (prep-assign.ts), which re-checks it on save:
// an empty slot, or one that only plans this dish fresh, can eat from the
// batch. Anything else there is the household's plan and stays put.
function isSelectable(entries: PlanSlotEntry[], recipeId: string): boolean {
  return entries.every(
    (entry) => entry.recipeId === recipeId && entry.preparedBatchId === null && !entry.consumed,
  );
}

// GAP-49: spreads a batch's portions over the planner, a week at a time.
// Opened from a batch card's "Plan portions" (and the Record prep toast) by
// PrepTab, which mounts it per batch with `controlled.open` true and
// unmounts it on close, so every opening starts from a clean selection.
// The weeks are read with loadPlanSlotsAction rather than the page's
// ?week= param, so paging here never moves the Planner tab. Selections are
// kept across weeks: one save can plan this week's dinners and next
// Monday's lunch, and the counter covers all of them.
export function PlanPortionsDialog({
  dict,
  locale,
  batch,
  initialWeekStartKey,
  controlled,
}: {
  dict: MealPlanningDict;
  locale: string;
  batch: PreparedBatchData;
  initialWeekStartKey: string;
  controlled: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const router = useRouter();
  const [weekStartKey, setWeekStartKey] = useState(initialWeekStartKey);
  // Each week's entries once loaded; a week missing here is still loading.
  const [weeks, setWeeks] = useState<Record<string, PlanSlotEntry[]>>({});
  const [loadError, setLoadError] = useState<{ week: string; message: string } | null>(null);
  // Selected slot → portions.
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  // Callers clear any earlier loadError first; the mount-time load has none.
  function load(week: string) {
    startLoad(async () => {
      // A request that never arrives (offline, weak signal) rejects rather
      // than answering { error }; caught here so it lands in this dialog's
      // error state instead of the page's error boundary (M8). Next's own
      // redirect signals (an expired session) still go through.
      let result: Awaited<ReturnType<typeof loadPlanSlotsAction>>;
      try {
        result = await loadPlanSlotsAction(week);
      } catch (error) {
        unstable_rethrow(error);
        setLoadError({ week, message: dict.prepConnectionError });
        return;
      }
      if ("error" in result) {
        setLoadError({ week, message: result.error });
        return;
      }
      setWeeks((prev) => ({ ...prev, [week]: result.entries }));
      // A slot picked before a reload (after "That meal slot already has
      // something planned") may be taken now; drop it rather than send it
      // again and fail the same way.
      setSelected((prev) => {
        const next = { ...prev };
        for (const entry of result.entries) {
          const key = slotKey(entry.date, entry.mealType);
          if (key in next && !isSelectable(entriesInSlot(result.entries, key), batch.recipeId)) delete next[key];
        }
        return next;
      });
    });
  }

  // The opening week. The dialog is mounted fresh per opening.
  useEffect(() => {
    load(initialWeekStartKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  function reload(week: string) {
    setLoadError(null);
    load(week);
  }

  function goToWeek(offset: number) {
    const week = toDateKey(addDays(parseDateKey(weekStartKey), offset * 7));
    setWeekStartKey(week);
    if (!(week in weeks)) reload(week);
  }

  const total = Object.values(selected).reduce((sum, portions) => sum + portions, 0);
  const left = batch.remainingPortions - total;

  function toggle(key: string, checked: boolean) {
    setSaveError(null);
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[key] = 1;
      else delete next[key];
      return next;
    });
  }

  function save() {
    setSaveError(null);
    const slots = Object.entries(selected)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, portions]) => {
        const [date, mealType] = key.split("|") as [string, MealType];
        return { date, mealType, portions };
      });
    startSave(async () => {
      let result: Awaited<ReturnType<typeof assignBatchPortionsAction>>;
      try {
        result = await assignBatchPortionsAction({ batchId: batch.id, slots });
      } catch (error) {
        // As in load(): the request never arrived, so nothing was written
        // and the selection is still good to retry.
        unstable_rethrow(error);
        setSaveError(dict.prepConnectionError);
        return;
      }
      if (result.error) {
        setSaveError(result.error);
        // Nothing was written (all or nothing), but someone else changed
        // the plan or the batch: show the slots and portions as they are now.
        setWeeks({});
        reload(weekStartKey);
        router.refresh();
        return;
      }
      toast.success(format(plural(total, dict.prepPlannedToast), { count: total }));
      controlled.onOpenChange(false);
      // No router.refresh() on success: the action revalidated the page.
      // The error path above refreshes on purpose, as nothing was.
    });
  }

  const weekStart = parseDateKey(weekStartKey);
  // Formatted in UTC like the planner's own week range (week-planner.tsx,
  // UX-15/UX-32): date keys are UTC midnights, and Node and Safari disagree
  // on the spaces around the dash.
  const weekRange = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
    .formatRange(weekStart, addDays(weekStart, 6))
    .replace(/[  ]/g, " ");
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  // UTC like every planner date key, as week-planner computes today.
  const todayKey = toDateKey(new Date());
  const entries = weeks[weekStartKey];
  const weekError = loadError?.week === weekStartKey ? loadError.message : null;
  // Days before today are left out (prepped food can't be eaten in the
  // past), so the list opens on today's meals instead of a screenful of
  // dead rows. The earliest week with anything pickable is today's, so
  // Previous stops there. Compare the week's start, not its end: the end is
  // on or after today for every later week too, which would lock Previous
  // week as soon as Next week was clicked. The dialog never opens before
  // today's week (prep-tab starts at the later of now and the cook date).
  const isFirstWeek = toDateKey(weekStart) <= todayKey;
  const days = Array.from({ length: 7 }, (_, i) => toDateKey(addDays(weekStart, i))).filter((date) => date >= todayKey);
  // The first slot that can be ticked in the shown week. When today's early
  // meals are taken it can sit below the fold, so it is scrolled into view
  // once the week has loaded.
  const firstFreeKey = entries
    ? days
        .flatMap((date) => MEAL_TYPES.map((mealType) => slotKey(date, mealType)))
        .find((key) => isSelectable(entriesInSlot(entries, key), batch.recipeId))
    : undefined;
  const firstFreeRef = useRef<HTMLLIElement | null>(null);
  const weekLoaded = entries !== undefined;
  useEffect(() => {
    firstFreeRef.current?.scrollIntoView({ block: "nearest" });
  }, [weekStartKey, weekLoaded]);

  return (
    <Dialog open={controlled.open} onOpenChange={controlled.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(dict.prepPlanDialogTitle, { recipe: batch.recipeName })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{dict.prepPlanDialogHint}</p>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={dict.previousWeek}
            disabled={isFirstWeek}
            onClick={() => goToWeek(-1)}
          >
            <ChevronLeft />
          </Button>
          <p className="text-center text-sm font-semibold tabular-nums" aria-live="polite">
            {weekRange}
          </p>
          <Button type="button" variant="outline" size="icon-sm" aria-label={dict.nextWeek} onClick={() => goToWeek(1)}>
            <ChevronRight />
          </Button>
        </div>

        {weekError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {weekError}
            </p>
            <Button type="button" variant="outline" onClick={() => reload(weekStartKey)}>
              {dict.prepRetry}
            </Button>
          </div>
        ) : !entries ? (
          // M8: the loading state holds roughly a day's height in place.
          <div role="status" aria-label={dict.prepLoadingWeek} className="flex min-h-48 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {days.map((date) => {
              const day = dayFormat.format(parseDateKey(date));
              const headingId = `plan-portions-${date}`;
              return (
                // M6: 28 slots is a long list on a phone, so it's grouped by
                // day under a small heading that also names each checkbox's
                // group for a screen reader.
                <section key={date} role="group" aria-labelledby={headingId} className="flex flex-col">
                  <h3 id={headingId} className="text-xs font-semibold text-muted-foreground uppercase">
                    {day}
                  </h3>
                  {/* M3: gap-2 keeps neighbouring rows' 44px targets 8px apart. */}
                  <ul className="flex flex-col gap-2">
                    {MEAL_TYPES.map((mealType) => {
                      const key = slotKey(date, mealType);
                      const inSlot = entriesInSlot(entries, key);
                      const selectable = isSelectable(inSlot, batch.recipeId);
                      const portions = selected[key];
                      const isSelected = portions !== undefined;
                      const mealLabel = dict[mealTypeDictKey[mealType]];
                      const dishes = inSlot.map((entry) => entry.label).filter(Boolean).join(", ");
                      return (
                        <li
                          key={mealType}
                          ref={key === firstFreeKey ? firstFreeRef : undefined}
                          className="flex min-h-11 items-center gap-3"
                        >
                          {/* M3: the whole label is the 44px tap target. */}
                          <label
                            className={
                              selectable
                                ? "flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3"
                                : "flex min-h-11 min-w-0 flex-1 cursor-not-allowed items-center gap-3 text-muted-foreground"
                            }
                          >
                            <Checkbox
                              checked={isSelected}
                              disabled={!selectable || saving}
                              onChange={(e) => toggle(key, e.target.checked)}
                            />
                            <span className="flex min-w-0 flex-col">
                              <span>{mealLabel}</span>
                              {dishes && (
                                <span className="truncate text-xs text-muted-foreground" title={dishes}>
                                  {dishes}
                                </span>
                              )}
                            </span>
                          </label>
                          {/* Taken is said in words, not only by greying
                              (DESIGN.md: never colour alone). */}
                          {!selectable && (
                            <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {dict.prepSlotTakenBadge}
                            </span>
                          )}
                          {isSelected && (
                            <PortionStepper
                              value={portions}
                              min={1}
                              // Up to what's left, so the stepper alone can't
                              // overdraw the batch; ticking more slots still
                              // can, and the footer says so.
                              max={Math.min(MAX_LEFTOVER_SERVINGS, portions + Math.max(0, left))}
                              onChange={(value) => setSelected((prev) => ({ ...prev, [key]: value }))}
                              label={format(dict.prepSlotPortions, { meal: mealLabel, day })}
                              decreaseLabel={dict.prepDecreasePortions}
                              increaseLabel={dict.prepIncreasePortions}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        {/* M2: the footer sticks to the sheet's bottom on phones (and, with
            sm:sticky here, to the centred dialog's), so Save and the live
            count stay in reach however far down the week the user is. */}
        <DialogFooter className="flex-row items-center justify-between sm:sticky sm:-bottom-4 sm:z-10 sm:justify-between sm:bg-popover">
          <p aria-live="polite" className="min-w-0 flex-1 text-sm tabular-nums">
            {left < 0 ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {format(plural(-left, dict.prepTooManyPortions), {
                  count: -left,
                  remaining: batch.remainingPortions,
                })}
              </span>
            ) : (
              format(dict.prepLeftAfter, { left, remaining: batch.remainingPortions })
            )}
          </p>
          <Button type="button" className="shrink-0" disabled={total === 0 || left < 0 || saving} onClick={save}>
            <PendingLabel pending={saving} busy={dict.prepPlanning} idle={dict.prepPlanSubmit} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function entriesInSlot(entries: PlanSlotEntry[], key: string): PlanSlotEntry[] {
  return entries.filter((entry) => slotKey(entry.date, entry.mealType) === key);
}
