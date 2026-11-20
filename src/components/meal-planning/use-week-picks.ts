"use client";

import { useEffect, useState, useTransition, type DragEvent, type RefObject } from "react";
import { toast } from "sonner";
import { createDeferredDelete, type DeferredDelete } from "@/components/shared/deferred-delete";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { createDialogHandle } from "@/components/ui/dialog";
import { openLazyDialog } from "@/components/ui/lazy-dialog";
import { usePointerPlanning } from "@/components/meal-planning/week-picks-tray";
import {
  placePickAction,
  placePicksAction,
  removePickAction,
  unplaceEntriesAction,
} from "@/app/dashboard/meal-planning/pick-actions";
import { moveMealEntryAction } from "@/app/dashboard/meal-planning/planner-actions";
import type { MealType } from "@/app/dashboard/meal-planning/meal-types";
import { mealTypeDictKey, type MealPlanningDict } from "@/components/meal-planning/week-planner-helpers";
import { format, plural } from "@/lib/i18n/format";
import type { MealPlanEntryData, WeekPickData } from "@/components/meal-planning/types";
import type { Locale } from "@/lib/i18n/locales";

type Drag = { kind: "pick"; pick: WeekPickData } | { kind: "entry"; entry: MealPlanEntryData };

// Week picks. A pick being placed or removed leaves the tray at tap time
// (hiddenPickIds), before the server answers, and comes back if it says
// no (M5). On a desktop a chip can be lifted (click-to-lift) or dragged,
// and planned meals dragged between days and back to the tray.
export function useWeekPicks({
  dict,
  locale,
  weekStartKey,
  allPicks,
  carriedCount,
  isCurrentWeek,
  todayKey,
  hideEntry,
  pendingRemovals,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  weekStartKey: string;
  allPicks: WeekPickData[];
  carriedCount: number;
  isCurrentWeek: boolean;
  todayKey: string;
  hideEntry: (id: string, hide: boolean) => void;
  pendingRemovals: RefObject<DeferredDelete[]>;
}) {
  const wp = dict.weekPicks;
  const [hiddenPickIds, setHiddenPickIds] = useState<ReadonlySet<string>>(new Set());
  const picks = allPicks.filter((pick) => !hiddenPickIds.has(pick.id));
  const pointer = usePointerPlanning();
  const [lifted, setLifted] = useState<WeekPickData | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [placeSheet, setPlaceSheet] = useState<WeekPickData | null>(null);
  // "Mark as cooked today" on a pick: placed on today's dinner, then the
  // usual Mark as cooked review runs on the new entry, which may sit in a
  // week other than the one on screen, so the review lives here.
  const [cookingEntry, setCookingEntry] = useState<MealPlanEntryData | null>(null);
  const [cookingPick, setCookingPick] = useState<WeekPickData | null>(null);
  const [cookHandle] = useState(() => createDialogHandle());
  const [, startPicking] = useTransition();
  // "Every pick is on a day." is only said when it's true: this week had
  // picks while the planner was open and they've all been placed. After a
  // reload, or for a household that never picked, the tray invites instead.
  const [pickedWeek, setPickedWeek] = useState<string | null>(allPicks.length > 0 ? weekStartKey : null);
  if (allPicks.length > 0 && pickedWeek !== weekStartKey) setPickedWeek(weekStartKey);

  useEffect(() => {
    if (cookingEntry) openLazyDialog(cookHandle);
  }, [cookingEntry, cookHandle]);

  // Carry-over's one-off note. The id keeps a re-run effect from stacking a
  // second toast.
  useEffect(() => {
    // Only on the week the picks moved into, where the dashed chips are.
    if (carriedCount > 0 && isCurrentWeek) {
      toast(format(plural(carriedCount, wp.carriedToast), { count: carriedCount }), { id: "week-picks-carried" });
    }
  }, [carriedCount, isCurrentWeek, wp]);

  // Escape puts a lifted pick down again.
  useEffect(() => {
    if (!lifted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLifted(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lifted]);

  function hidePicks(ids: string[]) {
    setHiddenPickIds((prev) => new Set([...prev, ...ids]));
  }
  function showPicks(ids: string[]) {
    setHiddenPickIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // What a place's Undo hands back so the pick returns as it was.
  const originOf = (pick: WeekPickData, entryId: string) => ({
    entryId,
    createdByUserId: pick.createdByUserId,
    carriedFromWeek: pick.carriedFromWeek,
    // The tray only shows the visible week's picks.
    weekStartDate: weekStartKey,
  });

  function placePick(pick: WeekPickData, dateKey: string, mealType: MealType, dayLabel: string) {
    setLifted(null);
    setPlaceSheet(null);
    hidePicks([pick.id]);
    startPicking(async () => {
      const result = await settleOptimisticAction(
        () => placePickAction(pick.id, dateKey, mealType),
        dict.prepConnectionError,
      );
      if (!result?.entryId) {
        showPicks([pick.id]);
        return;
      }
      const entryId = result.entryId;
      toast.success(
        format(wp.placedToast, { slot: dict[mealTypeDictKey[mealType]].toLocaleLowerCase(locale), day: dayLabel }),
        {
          duration: 8000,
          action: {
            label: wp.undo,
            onClick: () => {
              void settleOptimisticAction(
                () => unplaceEntriesAction([entryId], [originOf(pick, entryId)]),
                dict.prepConnectionError,
              );
            },
          },
        },
      );
    });
  }

  function placeAll(rows: { pickId: string; dateKey: string }[]) {
    setSpreadOpen(false);
    const ids = rows.map((row) => row.pickId);
    hidePicks(ids);
    startPicking(async () => {
      const result = await settleOptimisticAction(
        () => placePicksAction(rows.map((row) => ({ pickId: row.pickId, date: row.dateKey }))),
        dict.prepConnectionError,
      );
      if (!result?.placed) {
        showPicks(ids);
        return;
      }
      const placed = result.placed;
      const skipped = result.skipped ?? 0;
      // A dinner planned since the preview kept its pick in the tray.
      const placedIds = new Set(placed.map((row) => row.pickId));
      showPicks(ids.filter((id) => !placedIds.has(id)));
      if (skipped > 0) toast.warning(format(plural(skipped, wp.spreadSkippedToast), { count: skipped }));
      if (placed.length === 0) return;
      const byId = new Map(picks.map((pick) => [pick.id, pick]));
      const entryIds = placed.map((row) => row.entryId);
      const origins = placed.flatMap((row) => {
        const pick = byId.get(row.pickId);
        return pick ? [originOf(pick, row.entryId)] : [];
      });
      toast.success(format(plural(placed.length, wp.spreadToast), { count: placed.length }), {
        duration: 8000,
        action: {
          label: wp.undo,
          onClick: () => {
            void settleOptimisticAction(() => unplaceEntriesAction(entryIds, origins), dict.prepConnectionError);
          },
        },
      });
    });
  }

  function removePick(pick: WeekPickData) {
    setPlaceSheet(null);
    setLifted(null);
    hidePicks([pick.id]);
    const deferred = createDeferredDelete({
      run: async () =>
        (await settleOptimisticAction(() => removePickAction(pick.id), dict.prepConnectionError)) !== null,
      restore: () => showPicks([pick.id]),
    });
    pendingRemovals.current.push(deferred);
    toast(format(wp.removedToast, { name: pick.name }), {
      duration: 5000,
      action: { label: wp.undo, onClick: deferred.undo },
      onAutoClose: deferred.commit,
      onDismiss: deferred.commit,
    });
  }

  function markPickCooked(pick: WeekPickData) {
    setPlaceSheet(null);
    hidePicks([pick.id]);
    startPicking(async () => {
      const result = await settleOptimisticAction(
        () => placePickAction(pick.id, todayKey, "DINNER"),
        dict.prepConnectionError,
      );
      if (!result?.entryId) {
        showPicks([pick.id]);
        return;
      }
      setCookingPick(pick);
      setCookingEntry({
        id: result.entryId,
        date: todayKey,
        mealType: "DINNER",
        recipeId: pick.recipeId,
        recipeName: pick.name,
        freeformName: null,
        freeformIngredients: null,
        note: null,
        portions: pick.portions,
        consumedAt: null,
        preparedBatchId: null,
      });
    });
  }

  // The owner's call: a pick can be cooked without placing it. Closing the
  // review without cooking takes it back off today, as it was.
  function cookDismissed(entry: MealPlanEntryData) {
    const pick = cookingPick;
    setCookingPick(null);
    void settleOptimisticAction(
      () =>
        unplaceEntriesAction(
          [entry.id],
          pick ? [originOf(pick, entry.id)] : undefined,
        ),
      dict.prepConnectionError,
    );
  }

  // "Back to picks" on a planned meal (its sheet, or a drag onto the tray).
  function backToPicks(entry: MealPlanEntryData, label: string) {
    hideEntry(entry.id, true);
    startPicking(async () => {
      const result = await settleOptimisticAction(() => unplaceEntriesAction([entry.id]), dict.prepConnectionError);
      if (!result) {
        hideEntry(entry.id, false);
        return;
      }
      const pickId = result.pickIds?.[0];
      toast.success(
        format(wp.backToPicksToast, { name: label }),
        pickId
          ? {
              duration: 8000,
              action: {
                label: wp.undo,
                onClick: () => {
                  void settleOptimisticAction(
                    () => placePickAction(pickId, entry.date, entry.mealType),
                    dict.prepConnectionError,
                  );
                },
              },
            }
          : undefined,
      );
    });
  }

  // A planned meal dragged onto another day: the same move as its Move
  // dialog, keeping its slot.
  function moveEntry(entry: MealPlanEntryData, dateKey: string, dayLabel: string) {
    const move = (date: string) => {
      const formData = new FormData();
      formData.set("entryId", entry.id);
      formData.set("date", date);
      formData.set("mealType", entry.mealType);
      return settleOptimisticAction(() => moveMealEntryAction({}, formData), dict.prepConnectionError);
    };
    startPicking(async () => {
      if (!(await move(dateKey))) return;
      toast.success(format(wp.movedToast, { name: entry.recipeName ?? entry.freeformName ?? "", day: dayLabel }), {
        duration: 8000,
        action: { label: wp.undo, onClick: () => void move(entry.date) },
      });
    });
  }

  function onPickClick(pick: WeekPickData) {
    if (pointer) setLifted((current) => (current?.id === pick.id ? null : pick));
    else setPlaceSheet(pick);
  }

  function startDrag(event: DragEvent<HTMLElement>, next: Drag, label: string) {
    event.dataTransfer.effectAllowed = "move";
    // Some browsers only start a drag that carries data.
    event.dataTransfer.setData("text/plain", label);
    setLifted(null);
    setDrag(next);
  }
  function endDrag() {
    setDrag(null);
    setDropTarget(null);
  }
  // Drop handlers for a target ("tray", or a day's key). `accepts` says
  // whether what's being dragged can land there.
  function dropZone(target: string, accepts: boolean, onDrop: () => void) {
    if (!pointer) return {};
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!drag || !accepts) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropTarget !== target) setDropTarget(target);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropTarget((current) => (current === target ? null : current));
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!drag || !accepts) return;
        event.preventDefault();
        endDrag();
        onDrop();
      },
    };
  }

  return {
    picks,
    pointer,
    lifted,
    setLifted,
    drag,
    dropTarget,
    pickerOpen,
    setPickerOpen,
    spreadOpen,
    setSpreadOpen,
    placeSheet,
    setPlaceSheet,
    cookingEntry,
    cookHandle,
    allPlaced: pickedWeek === weekStartKey,
    placePick,
    placeAll,
    removePick,
    markPickCooked,
    cookDismissed,
    backToPicks,
    moveEntry,
    onPickClick,
    startDrag,
    endDrag,
    dropZone,
  };
}

export type WeekPicksPlanning = ReturnType<typeof useWeekPicks>;
