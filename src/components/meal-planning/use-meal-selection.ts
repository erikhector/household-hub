"use client";

import { useState, type RefObject } from "react";
import { toast } from "sonner";
import { createDeferredDelete, type DeferredDelete } from "@/components/shared/deferred-delete";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { bulkEditMealEntriesAction } from "@/app/dashboard/meal-planning/bulk-meal-actions";
import type { MealPlanningDict } from "@/components/meal-planning/week-planner-helpers";
import { format, plural } from "@/lib/i18n/format";
import type { MealPlanEntryData } from "@/components/meal-planning/types";

// GAP-56: Select mode. The selection is ids, resolved against what's on
// screen below, so a week change or a meal cooked elsewhere can't leave a
// stale row selected. A bulk Remove hides its rows at once (hiddenIds) and
// sends the delete when its Undo toast closes, like a single Remove meal.
export function useMealSelection(
  dict: MealPlanningDict,
  allEntries: MealPlanEntryData[],
  pendingRemovals: RefObject<DeferredDelete[]>,
) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const entries = allEntries.filter((entry) => !hiddenIds.has(entry.id));
  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.id) && !entry.consumedAt);

  function hideEntry(id: string, hide: boolean) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (hide) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removeSelected() {
    const ids = selectedEntries.map((entry) => entry.id);
    if (ids.length === 0) return;
    setHiddenIds((prev) => new Set([...prev, ...ids]));
    exitSelectMode();
    const deferred = createDeferredDelete({
      run: async () => {
        const result = await settleOptimisticAction(
          () => bulkEditMealEntriesAction({ op: "remove", entryIds: ids }),
          dict.prepConnectionError,
        );
        return result !== null;
      },
      restore: () =>
        setHiddenIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        }),
    });
    pendingRemovals.current.push(deferred);
    toast(format(plural(ids.length, dict.bulkRemovedToast), { count: ids.length }), {
      duration: 5000,
      action: { label: dict.undoDelete, onClick: deferred.undo },
      onAutoClose: deferred.commit,
      onDismiss: deferred.commit,
    });
  }

  return {
    entries,
    selectMode,
    setSelectMode,
    selectedIds,
    selectedEntries,
    hideEntry,
    exitSelectMode,
    toggleSelected,
    removeSelected,
  };
}
