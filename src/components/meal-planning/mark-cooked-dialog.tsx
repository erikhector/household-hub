"use client";

import { useActionState, useState, useTransition } from "react";
import { ChefHat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  markMealEntryCookedAction,
  previewCookedIngredientsAction,
  undoMarkMealEntryCookedAction,
} from "@/app/dashboard/meal-planning/cooking-actions";
import { format } from "@/lib/i18n/format";
import type { CookedIngredientData, MealPlanEntryData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

type ReviewItem = CookedIngredientData & { included: boolean; quantity: number };

const initialState: ActionState = {};

export function MarkCookedDialog({ dict, entry }: { dict: MealPlanningDict; entry: MealPlanEntryData }) {
  const [open, setOpen] = useState(false);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await markMealEntryCookedAction(prevState, formData);
    if (!result.error) {
      setOpen(false);

      // Captured from the just-submitted form (not the `items` state, which
      // may have moved on by the time the toast's action fires) so Undo can
      // credit inventory back by the exact amounts that were decremented.
      const itemIds = formData.getAll("itemId").map((v) => String(v));
      const quantities = formData.getAll("itemQuantity").map((v) => Number(v));
      const rows = itemIds.map((itemId, i) => ({ itemId, quantity: quantities[i] }));

      toast.success(dict.mealMarkedCookedToast, {
        duration: 8000,
        action: {
          label: dict.undoMarkCooked,
          onClick: () => {
            void undoMarkMealEntryCookedAction(entry.id, rows).then((undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
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
    startPreviewTransition(async () => {
      const result = await previewCookedIngredientsAction(entry.id);
      if ("error" in result) {
        setPreviewError(result.error);
      } else {
        setItems(
          result.items.map((item) => ({ ...item, included: true, quantity: item.suggestedQuantity })),
        );
      }
    });
  }

  function toggleItem(key: string) {
    setItems((prev) =>
      prev ? prev.map((item) => (item.key === key ? { ...item, included: !item.included } : item)) : prev,
    );
  }

  function updateQuantity(key: string, quantity: number) {
    setItems((prev) =>
      prev ? prev.map((item) => (item.key === key ? { ...item, quantity } : item)) : prev,
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={dict.markCookedAriaLabel}
          >
            <ChefHat className="size-3" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.markCookedDialogTitle}</DialogTitle>
        </DialogHeader>

        {isPreviewPending || items === null ? (
          <p className="text-sm text-muted-foreground">{previewError ?? dict.loadingCookedIngredients}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="entryId" value={entry.id} />
            <p className="text-sm text-muted-foreground">{dict.markCookedDialogHint}</p>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{dict.noCookedIngredientsLinked}</p>
            ) : (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.key} className="flex flex-col gap-1 rounded-md bg-muted px-2 py-1.5 text-sm">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={item.included}
                        onChange={() => toggleItem(item.key)}
                      />
                      <span className="min-w-0 flex-1 truncate" title={item.name}>
                        {item.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(dict.onHandQuantityLabel, { quantity: item.onHandQuantity, unit: item.unit })}
                      </span>
                    </label>
                    <div className="flex items-center gap-2 pl-6">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                        value={item.quantity}
                        disabled={!item.included}
                        onChange={(e) => updateQuantity(item.key, Number(e.target.value))}
                        aria-label={format(dict.cookedQuantityAriaLabel, { name: item.name })}
                      />
                      <span className="text-xs text-muted-foreground">{item.unit}</span>
                      {item.unitMismatch && (
                        <span className="text-xs text-amber-600 dark:text-amber-500">
                          {format(dict.cookedIngredientUnitMismatchNote, {
                            quantity: item.requiredQuantity,
                            unit: item.requiredUnit,
                          })}
                        </span>
                      )}
                    </div>
                    {item.included && (
                      <>
                        <input type="hidden" name="itemId" value={item.inventoryItemId} />
                        <input type="hidden" name="itemQuantity" value={item.quantity} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? dict.markingCooked : dict.markCookedSubmit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
