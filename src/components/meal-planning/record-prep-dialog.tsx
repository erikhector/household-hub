"use client";

import { useActionState, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PendingLabel } from "@/components/ui/pending-label";
import {
  previewPrepIngredientsAction,
  recordPrepAction,
  undoRecordPrepAction,
} from "@/app/dashboard/meal-planning/prep-actions";
import { undoAutoAddedItemsAction } from "@/app/dashboard/shopping-list/actions";
import { LEFTOVERS_SHELF_LIFE_DAYS, MAX_LEFTOVER_SERVINGS } from "@/app/dashboard/meal-planning/leftover-constants";
import { PortionStepper } from "@/components/meal-planning/portion-stepper";
import {
  CookedIngredientsChecklist,
  toReviewItems,
  type ReviewItem,
} from "@/components/meal-planning/cooked-ingredients-checklist";
import { format, plural } from "@/lib/i18n/format";
import type { RecipeData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

type DishRow = {
  // Stable React key — rows can be removed from the middle.
  key: number;
  recipeId: string;
  portions: number;
  // yyyy-mm-dd, or "" for the default eat-by date.
  expiry: string;
};

const initialState: ActionState = {};

let nextDishKey = 0;
function newDish(): DishRow {
  nextDishKey += 1;
  return { key: nextDishKey, recipeId: "", portions: 1, expiry: "" };
}

// GAP-49: two steps in one dialog, like Mark as cooked's review. Step 1
// lists the dishes cooked (recipe, portions, optional eat-by); "Next" asks
// the server what those dishes take out of inventory, and step 2 is the
// same editable checklist Mark as cooked uses, inside the form that records
// the prep — so the household confirms every decrement before it happens.
export function RecordPrepDialog({
  dict,
  recipes,
  maxDishes,
  onPlanPortions,
  handle,
}: {
  dict: MealPlanningDict;
  recipes: RecipeData[];
  // MAX_PREP_DISHES, handed down by the page rather than imported here:
  // prepared-batch-calc.ts pulls in the server error helpers (Sentry, the
  // English dictionary), which have no business in the client bundle.
  maxDishes: number;
  // Opens the Plan portions dialog for a batch this prep just recorded.
  onPlanPortions: (batchId: string) => void;
  // Opened by the Prep tab's "Record prep" button, which stays in the tab's
  // own chunk so this dialog can load on first use (PERF-26).
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [dishes, setDishes] = useState<DishRow[]>(() => [newDish()]);
  // null while on step 1; the reviewed ingredients once on step 2.
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();

  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const allChosen = dishes.every((dish) => dish.recipeId !== "");

  const [state, formAction, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    // M8: a dropped connection rejects the action. Caught here (as
    // plan-portions-dialog.tsx does) so the dialog shows the error and the
    // reviewed checklist stays filled in, instead of the error boundary
    // replacing the tab.
    let result: Awaited<ReturnType<typeof recordPrepAction>>;
    try {
      result = await recordPrepAction(prevState, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: dict.prepConnectionError };
    }
    if (!result.error && result.undo) {
      setOpen(false);
      const { undo } = result;
      const portions = result.portions ?? 0;
      const dishCount = result.dishCount ?? 0;
      // Planning the portions is the natural next step, offered in Sonner's
      // second button slot (as Mark as cooked offers "Plan leftovers") when
      // there's one batch to plan. With several dishes there's no one batch
      // the button could mean; each card has its own Plan portions.
      const [onlyBatchId] = undo.batchIds;
      const planPortions =
        undo.batchIds.length === 1
          ? { label: dict.prepPlanPortions, onClick: () => onPlanPortions(onlyBatchId) }
          : undefined;
      toast.success(
        format(plural(portions, dict.prepRecordedToast), {
          dishes: format(plural(dishCount, dict.prepDishCount), { count: dishCount }),
          portions,
        }),
        {
          duration: 8000,
          cancel: planPortions,
          action: {
            label: dict.prepUndo,
            onClick: () => {
              // As Mark as cooked: undoing the prep also takes anything it
              // pushed onto "Next shop" (AUTO-8) back off the list. In
              // sequence, not in parallel: the prep undo can be refused
              // (a portion is planned already), and then the prep stands
              // and its items are still low, so their rows must stay.
              void (async () => {
                // Offline, a failed undo would otherwise fail silently.
                let undoResult: ActionState;
                try {
                  undoResult = await undoRecordPrepAction(undo);
                } catch (error) {
                  unstable_rethrow(error);
                  toast.error(dict.prepConnectionError);
                  return;
                }
                if (undoResult.error) {
                  toast.error(undoResult.error);
                  return;
                }
                let undoAutoAddResult: ActionState = {};
                try {
                  if (undo.autoAdded.length > 0) {
                    undoAutoAddResult = await undoAutoAddedItemsAction(
                      undo.autoAdded.map((added) => added.shoppingListItemId),
                    );
                  }
                } catch (error) {
                  unstable_rethrow(error);
                  undoAutoAddResult = { error: dict.prepConnectionError };
                }
                if (undoAutoAddResult.error) toast.error(undoAutoAddResult.error);
                else toast.success(dict.prepRecordUndoneToast);
                // The prep itself was undone either way. No refresh: the
                // undo action revalidated the page and its response already
                // carries the re-render.
              })();
            },
          },
        },
      );
    }
    return result;
  }, initialState);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    // A fresh prep every time: last session's dishes are already recorded.
    setDishes([newDish()]);
    setItems(null);
    setPreviewError(null);
  }

  function updateDish(key: number, patch: Partial<DishRow>) {
    setDishes((prev) => prev.map((dish) => (dish.key === key ? { ...dish, ...patch } : dish)));
  }

  function chooseRecipe(key: number, recipeId: string) {
    // Default the portions to what the recipe makes — the usual answer, and
    // one tap less than starting from 1.
    const servings = recipesById.get(recipeId)?.servings ?? 1;
    updateDish(key, { recipeId, portions: Math.min(MAX_LEFTOVER_SERVINGS, Math.max(1, servings)) });
  }

  function goToReview() {
    setPreviewError(null);
    startPreviewTransition(async () => {
      // M8: offline, the rejection would reach the error boundary and lose
      // the dishes entered so far; show it in the dialog instead.
      let result: Awaited<ReturnType<typeof previewPrepIngredientsAction>>;
      try {
        result = await previewPrepIngredientsAction(
          dishes.map((dish) => ({ recipeId: dish.recipeId, portions: dish.portions })),
        );
      } catch (error) {
        unstable_rethrow(error);
        setPreviewError(dict.prepConnectionError);
        return;
      }
      if ("error" in result) setPreviewError(result.error);
      else setItems(toReviewItems(result.items));
    });
  }

  function toggleItem(key: string) {
    setItems((prev) =>
      prev ? prev.map((item) => (item.key === key ? { ...item, included: !item.included } : item)) : prev,
    );
  }

  function updateQuantity(key: string, quantity: string) {
    setItems((prev) => (prev ? prev.map((item) => (item.key === key ? { ...item, quantity } : item)) : prev));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.prepRecordDialogTitle}</DialogTitle>
        </DialogHeader>

        {recipes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.prepNoRecipes}</p>
        ) : items === null ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{dict.prepRecordDialogHint}</p>

            {dishes.map((dish, index) => {
              const number = index + 1;
              const idPrefix = `prep-dish-${dish.key}`;
              return (
                <div
                  key={dish.key}
                  role="group"
                  aria-labelledby={`${idPrefix}-title`}
                  className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 id={`${idPrefix}-title`} className="text-sm font-semibold">
                      {format(dict.prepDishLabel, { number })}
                    </h3>
                    {dishes.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={format(dict.prepRemoveDish, { number })}
                        onClick={() => setDishes((prev) => prev.filter((d) => d.key !== dish.key))}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${idPrefix}-recipe`}>{dict.prepRecipeLabel}</Label>
                    <Select value={dish.recipeId || null} onValueChange={(v) => v && chooseRecipe(dish.key, v)}>
                      <SelectTrigger id={`${idPrefix}-recipe`} className="w-full">
                        <SelectValue placeholder={dict.prepRecipePlaceholder}>
                          {(value: string | null) =>
                            (value && recipesById.get(value)?.name) || dict.prepRecipePlaceholder
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {recipes.map((recipe) => (
                          <SelectItem key={recipe.id} value={recipe.id}>
                            {recipe.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* M1: the stepper and the date are short enough to share a
                      row from `sm`; below it they stack. */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{dict.prepPortionsLabel}</span>
                      <PortionStepper
                        value={dish.portions}
                        min={1}
                        max={MAX_LEFTOVER_SERVINGS}
                        onChange={(portions) => updateDish(dish.key, { portions })}
                        label={dict.prepPortionsLabel}
                        decreaseLabel={dict.prepDecreasePortions}
                        increaseLabel={dict.prepIncreasePortions}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Label htmlFor={`${idPrefix}-expiry`}>{dict.prepExpiryLabel}</Label>
                      <Input
                        id={`${idPrefix}-expiry`}
                        type="date"
                        value={dish.expiry}
                        onChange={(e) => updateDish(dish.key, { expiry: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        {format(dict.prepExpiryHint, { days: LEFTOVERS_SHELF_LIFE_DAYS })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}

            {dishes.length < maxDishes && (
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => setDishes((prev) => [...prev, newDish()])}
              >
                <Plus />
                {dict.prepAddDish}
              </Button>
            )}

            {previewError && <p className="text-sm text-destructive">{previewError}</p>}
            <DialogFooter>
              <Button type="button" disabled={!allChosen || isPreviewPending} onClick={goToReview}>
                <PendingLabel pending={isPreviewPending} busy={dict.loadingCookedIngredients} idle={dict.prepNext} />
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            {dishes.map((dish) => (
              <span key={dish.key} hidden>
                <input type="hidden" name="dishRecipeId" value={dish.recipeId} />
                <input type="hidden" name="dishPortions" value={dish.portions} />
                <input type="hidden" name="dishExpiry" value={dish.expiry} />
              </span>
            ))}
            <p className="text-sm text-muted-foreground">{dict.prepReviewHint}</p>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{dict.noCookedIngredientsLinked}</p>
            ) : (
              <CookedIngredientsChecklist
                dict={dict}
                items={items}
                onToggle={toggleItem}
                onQuantityChange={updateQuantity}
              />
            )}

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setItems(null)}>
                {dict.prepBack}
              </Button>
              <Button type="submit" disabled={pending}>
                <PendingLabel pending={pending} busy={dict.prepRecording} idle={dict.prepRecordSubmit} />
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
