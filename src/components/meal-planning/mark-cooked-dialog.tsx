"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import {
  markMealEntryCookedAction,
  previewCookedIngredientsAction,
  undoMarkMealEntryCookedAction,
} from "@/app/dashboard/meal-planning/cooking-actions";
import { undoAutoAddedItemsAction } from "@/app/dashboard/shopping-list/item-actions";
import { Input } from "@/components/ui/input";
import { suggestLeftoversDayAction } from "@/app/dashboard/meal-planning/planner-actions";
import { toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { format, plural } from "@/lib/i18n/format";
import type { MealPlanEntryData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import {
  CookedIngredientsChecklist,
  toReviewItems,
  type ReviewItem,
} from "@/components/meal-planning/cooked-ingredients-checklist";
import { PendingLabel } from "@/components/ui/pending-label";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};

// GAP-39: what "Plan leftovers" hands up to WeekPlanner, which owns the
// add-to-plan dialog it opens. It can't live here: once the meal is cooked
// the row swaps this component for the cooked badge, which unmounts it
// before the household has had a chance to tap the toast. GAP-49: the
// leftovers are a meal-prep batch now, so the slot it plans eats from it.
export type PlanLeftoversRequest = {
  recipeId: string;
  recipeName: string;
  batchId: string;
  date: string;
  servings: number;
};

export function MarkCookedDialog({
  dict,
  entry,
  onPlanLeftovers,
  handle,
}: {
  dict: MealPlanningDict;
  entry: MealPlanEntryData;
  onPlanLeftovers: (request: PlanLeftoversRequest) => void;
  /** Opened from the planner row's sheet, so no trigger of its own. */
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Controlled (like the quantity inputs) so a rejected submit doesn't wipe
  // what was typed — React resets an uncontrolled form after its action runs.
  const [leftoverServings, setLeftoverServings] = useState("");
  // GAP-49: a meal planned from a meal-prep batch was cooked when the batch
  // was, so "Eaten" only marks it consumed: no ingredient checklist (the
  // batch's own ingredients came off at prep time) and no leftovers field.
  const fromBatch = !!entry.preparedBatchId;

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await markMealEntryCookedAction(prevState, formData);
    if (!result.error && fromBatch) {
      setOpen(false);
      // No item rows on purpose, even if the entry was edited since the
      // dialog opened: nothing was deducted, so Undo must credit nothing back.
      toast.success(dict.prepEatenToast, {
        duration: 8000,
        action: {
          label: dict.undoMarkCooked,
          onClick: () => {
            void undoMarkMealEntryCookedAction(entry.id, [], undefined).then((undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
              else toast.success(dict.prepEatenUndoneToast);
            });
          },
        },
      });
    } else if (!result.error) {
      setOpen(false);

      // Captured from the just-submitted form (not the `items` state, which
      // may have moved on by the time the toast's action fires) so Undo can
      // credit inventory back by the exact amounts that were decremented.
      const itemIds = formData.getAll("itemId").map((v) => String(v));
      const quantities = formData.getAll("itemQuantity").map((v) => Number(v));
      const rows = itemIds.map((itemId, i) => ({ itemId, quantity: quantities[i] }));

      // AUTO-8: anything this cook pushed into low stock was auto-added to
      // "Next shop". Rather than a second toast competing with this one,
      // the message says so and the same Undo takes those rows back off the
      // list too — undoing the cook should undo everything it caused.
      const autoAdded = result.autoAdded ?? [];
      // GAP-8: the leftovers batch this cook created rides along on the
      // same Undo too.
      const leftovers = result.leftovers;
      const leftoverServings = Number(formData.get("leftoverServings")) || 0;
      // One toast, so only one message: the auto-add note wins when both
      // happened, since it's the change on *another* screen the household
      // is least likely to notice on their own.
      const message =
        autoAdded.length > 0
          ? format(plural(autoAdded.length, dict.mealMarkedCookedAutoAddedToast), {
              count: autoAdded.length,
              list: autoAdded[0].listName,
            })
          : leftovers && leftoverServings > 0
            ? format(plural(leftoverServings, dict.mealMarkedCookedLeftoversToast), { count: leftoverServings })
            : dict.mealMarkedCookedToast;

      // GAP-39: offered only when this cook actually recorded leftovers of a
      // recipe. It rides in Sonner's second button slot next to Undo.
      const recipeId = entry.recipeId;
      const planLeftovers =
        leftovers && leftoverServings > 0 && recipeId
          ? {
              label: dict.planLeftoversAction,
              onClick: () => {
                const todayKey = toDateKey(new Date());
                void suggestLeftoversDayAction(entry.date > todayKey ? entry.date : todayKey).then((suggestion) => {
                  if ("error" in suggestion) toast.error(suggestion.error);
                  else {
                    onPlanLeftovers({
                      recipeId,
                      recipeName: entry.recipeName ?? "",
                      batchId: leftovers.batchId,
                      date: suggestion.date,
                      servings: leftoverServings,
                    });
                  }
                });
              },
            }
          : undefined;

      toast.success(message, {
        duration: 8000,
        cancel: planLeftovers,
        action: {
          label: dict.undoMarkCooked,
          onClick: () => {
            void Promise.all([
              undoMarkMealEntryCookedAction(entry.id, rows, leftovers),
              autoAdded.length > 0
                ? undoAutoAddedItemsAction(autoAdded.map((added) => added.shoppingListItemId))
                : Promise.resolve<ActionState>({}),
            ]).then(([undoResult, undoAutoAddResult]) => {
              const error = undoResult.error ?? undoAutoAddResult.error;
              if (error) toast.error(error);
              else toast.success(dict.mealCookedUndoneToast);
            });
          },
        },
      });
    }
    return result;
  }, initialState);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;

    // Always recompute on open — inventory or the meal plan may have
    // changed since this was last shown (mirrors MissingIngredientsDialog).
    setItems(null);
    setPreviewError(null);
    setLeftoverServings("");
    if (fromBatch) return;
    startPreviewTransition(async () => {
      const result = await previewCookedIngredientsAction(entry.id);
      if ("error" in result) {
        setPreviewError(result.error);
      } else {
        setItems(toReviewItems(result.items));
      }
    });
  }

  function toggleItem(key: string) {
    setItems((prev) =>
      prev ? prev.map((item) => (item.key === key ? { ...item, included: !item.included } : item)) : prev,
    );
  }

  function updateQuantity(key: string, quantity: string) {
    setItems((prev) =>
      prev ? prev.map((item) => (item.key === key ? { ...item, quantity } : item)) : prev,
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fromBatch ? dict.prepEatenDialogTitle : dict.markCookedDialogTitle}</DialogTitle>
        </DialogHeader>

        {fromBatch ? (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="entryId" value={entry.id} />
            <p className="text-sm text-muted-foreground">{dict.prepEatenDialogHint}</p>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                <PendingLabel pending={pending} busy={dict.markingCooked} idle={dict.prepEatenSubmit} />
              </Button>
            </DialogFooter>
          </form>
        ) : isPreviewPending || items === null ? (
          <p className="text-sm text-muted-foreground">{previewError ?? dict.loadingCookedIngredients}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="entryId" value={entry.id} />
            <p className="text-sm text-muted-foreground">{dict.markCookedDialogHint}</p>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{dict.noCookedIngredientsLinked}</p>
            ) : (
              <CookedIngredientsChecklist dict={dict} items={items} onToggle={toggleItem} onQuantityChange={updateQuantity} />
            )}

            {/* GAP-8: blank by default — leftovers are only ever recorded
                when the household types a number here (Guardrails: suggest,
                don't silently mutate), never inferred from servings. */}
            <div className="flex flex-col gap-1">
              <label htmlFor={`leftover-servings-${entry.id}`} className="text-sm font-medium">
                {dict.leftoverServingsLabel}
              </label>
              <Input
                enterKeyHint="done"
                id={`leftover-servings-${entry.id}`}
                name="leftoverServings"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                placeholder="0"
                value={leftoverServings}
                onChange={(e) => setLeftoverServings(e.target.value)}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">{dict.leftoverServingsHint}</p>
            </div>

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                <PendingLabel pending={pending} busy={dict.markingCooked} idle={dict.markCookedSubmit} />
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
