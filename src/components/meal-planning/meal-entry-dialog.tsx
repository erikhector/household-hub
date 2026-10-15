"use client";

import { useActionState, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogHandle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addMealEntryAction, updateMealEntryAction } from "@/app/dashboard/meal-planning/planner-actions";
import { CUSTOM_RECIPE_SENTINEL, MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { PortionStepper } from "@/components/meal-planning/portion-stepper";
import type { MealPlanEntryData, PreparedBatchData, RecipeData } from "@/components/meal-planning/types";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};

// GAP-49: the third source in the dish select, next to "Custom meal" and the
// recipes. Client-only: picking it posts `preparedBatchId`, never this value.
const FROM_PREP_SENTINEL = "__prep__";

// Nothing picked yet (a new meal when there are recipes to pick from). Posts
// as an empty recipeId, which the server rejects with a field error.
const NO_CHOICE = "";

type CommonProps = {
  dict: MealPlanningDict;
  recipes: RecipeData[];
};

// "create" adds a new entry to a given day/slot; "edit" (an existing entry's
// own dish/portions) reuses the same form — see MealEntryDialog below.
type CreateProps = CommonProps & {
  mode?: "create";
  weekStartKey: string;
  dateKey: string;
  // UX-21: each day has one "+ Add meal" (not one per slot), so the dialog
  // asks which slot; this is the preselected one.
  mealType: MealType;
  // GAP-49: the household's active meal-prep batches. Those with portions
  // left are offered as "From meal prep"; none left, no such option.
  batches?: PreparedBatchData[];
};

type MealTypeLabelKey = "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack";

const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

type EditProps = CommonProps & {
  mode: "edit";
  entry: MealPlanEntryData;
  // Opened from the planner row's sheet, so no trigger of its own.
  handle: DialogHandle;
};

export function MealEntryDialog(props: CreateProps | EditProps) {
  const { dict, recipes } = props;
  const isEdit = props.mode === "edit";

  const [open, setOpen] = useState(false);
  const freeformNameRef = useRef<HTMLInputElement>(null);
  // M4 (pick, don't type): when there's a recipe or a meal-prep batch to
  // pick, a new meal starts on the picker with nothing chosen, rather than
  // on "Custom meal…" and an empty name field. Nothing to pick, it's the
  // name field straight away. Submitting with nothing chosen gets the
  // server's "Choose a recipe or enter a meal name".
  const somethingToPick =
    recipes.length > 0 || (!isEdit && (props.batches ?? []).some((b) => b.remainingPortions > 0));
  const initialChoice = somethingToPick ? NO_CHOICE : CUSTOM_RECIPE_SENTINEL;
  const [recipeChoice, setRecipeChoice] = useState(
    isEdit ? (props.entry.recipeId ?? CUSTOM_RECIPE_SENTINEL) : initialChoice,
  );
  // Favourites first (GAP-18), otherwise the list's own order, so the
  // household's go-to meals are at the top of the picker.
  const pickerRecipes = [...recipes].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite));
  const [portions, setPortions] = useState(isEdit ? String(props.entry.portions) : "4");
  const [mealType, setMealType] = useState<MealType>(isEdit ? props.entry.mealType : props.mealType);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [prepPortions, setPrepPortions] = useState(1);

  // Only when adding: editing a meal into a batch slot isn't a thing
  // updateMealEntryAction does (Plan portions on the Prep tab is). The batch
  // shown falls back to the first one (soonest eat-by) whenever the picked
  // one runs out or goes, and the source to "Custom meal" when they all do,
  // so a refresh never leaves the form pointing at something that's gone.
  const availableBatches = isEdit ? [] : (props.batches ?? []).filter((b) => b.remainingPortions > 0);
  const chosenBatch = availableBatches.find((b) => b.id === batchId) ?? availableBatches[0];
  const choice = recipeChoice === FROM_PREP_SENTINEL && !chosenBatch ? CUSTOM_RECIPE_SENTINEL : recipeChoice;
  const prepPortionsValue = chosenBatch ? Math.min(prepPortions, chosenBatch.remainingPortions) : 1;

  const action = isEdit ? updateMealEntryAction : addMealEntryAction;
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await action(prevState, formData);
    if (!result.error) {
      setOpen(false);
      if (!isEdit) {
        setRecipeChoice(initialChoice);
        setPortions("4");
        setBatchId(null);
        setPrepPortions(1);
      }
    }
    return result;
  }, initialState);

  const recipeLabel = (value: string | null) =>
    !value
      ? dict.chooseMealPlaceholder
      : value === CUSTOM_RECIPE_SENTINEL
        ? dict.customMealOption
        : value === FROM_PREP_SENTINEL
          ? dict.prepFromPrepOption
          : (recipes.find((r) => r.id === value)?.name ?? value);

  // Base UI's SelectValue renders the raw value (a batch id) unless mapped.
  const batchLabel = (value: string) => {
    const batch = availableBatches.find((b) => b.id === value);
    return batch ? format(dict.prepBatchOption, { recipe: batch.recipeName, left: batch.remainingPortions }) : "";
  };

  // Re-picking a recipe resets portions to its own serving size (i.e. "one
  // full recipe") — the common case — while still leaving it freely
  // editable, e.g. down to 2 when only cooking half a batch for one slot.
  const handleRecipeChoiceChange = (value: string) => {
    setRecipeChoice(value);
    const recipe = recipes.find((r) => r.id === value);
    if (recipe) setPortions(String(recipe.servings));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} handle={isEdit ? props.handle : undefined}>
      {/* Editing opens from the meal's sheet (`handle`); adding is the
          day's one "+ Add meal". */}
      {!isEdit && (
        <DialogTrigger
          render={
            <Button type="button" variant="ghost" className="h-9 w-full justify-start gap-1 px-2 text-sm text-muted-foreground max-sm:h-11">
              <Plus className="size-3.5" aria-hidden="true" />
              {dict.addMeal}
            </Button>
          }
        />
      )}
      <DialogContent
        initialFocus={freeformNameRef}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? dict.editMealDialogTitle : dict.addMealDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {isEdit ? (
            <input type="hidden" name="entryId" value={props.entry.id} />
          ) : (
            <>
              <input type="hidden" name="weekStartDate" value={props.weekStartKey} />
              <input type="hidden" name="date" value={props.dateKey} />
              <input type="hidden" name="mealType" value={mealType} />
            </>
          )}

          {!isEdit && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="mealTypeSelect">{dict.mealSlotLabel}</Label>
              <Select value={mealType} onValueChange={(v) => v && setMealType(v as MealType)}>
                <SelectTrigger id="mealTypeSelect" className="w-full">
                  <SelectValue>{(value: MealType) => dict[mealTypeDictKey[value]]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MEAL_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {dict[mealTypeDictKey[type]]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="recipeId">{dict.recipeLabel}</Label>
            <Select
              value={choice || null}
              onValueChange={(v) => v && handleRecipeChoiceChange(v)}
            >
              <SelectTrigger id="recipeId" className="w-full">
                <SelectValue placeholder={dict.chooseMealPlaceholder}>{recipeLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM_RECIPE_SENTINEL}>{dict.customMealOption}</SelectItem>
                {availableBatches.length > 0 && (
                  <SelectItem value={FROM_PREP_SENTINEL}>{dict.prepFromPrepOption}</SelectItem>
                )}
                {pickerRecipes.map((recipe) => (
                  <SelectItem key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {choice !== FROM_PREP_SENTINEL && <input type="hidden" name="recipeId" value={choice} />}
          </div>

          {choice === FROM_PREP_SENTINEL && chosenBatch ? (
            <>
              {/* M1: the select gets its own row; the stepper sits under it. */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="preparedBatchSelect">{dict.prepBatchLabel}</Label>
                <Select
                  value={chosenBatch.id}
                  onValueChange={(v) => {
                    if (!v) return;
                    setBatchId(v);
                    setPrepPortions(1);
                  }}
                >
                  <SelectTrigger id="preparedBatchSelect" className="w-full">
                    <SelectValue>{batchLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableBatches.map((batch) => (
                      <SelectItem key={batch.id} value={batch.id}>
                        {batchLabel(batch.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="preparedBatchId" value={chosenBatch.id} />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{dict.prepPortionsLabel}</span>
                <PortionStepper
                  value={prepPortionsValue}
                  min={1}
                  max={chosenBatch.remainingPortions}
                  onChange={setPrepPortions}
                  label={dict.prepPortionsLabel}
                  decreaseLabel={dict.prepDecreasePortions}
                  increaseLabel={dict.prepIncreasePortions}
                />
                <input type="hidden" name="portions" value={prepPortionsValue} />
                <p className="text-xs text-muted-foreground">{dict.prepFromPrepHint}</p>
              </div>
            </>
          ) : choice === CUSTOM_RECIPE_SENTINEL ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="freeformName">{dict.customMealNameLabel}</Label>
              <Input
                autoComplete="off"
                ref={freeformNameRef}
                id="freeformName"
                name="freeformName"
                placeholder={dict.customMealNamePlaceholder}
                maxLength={120}
                defaultValue={isEdit ? (props.entry.freeformName ?? "") : undefined}
              />
            </div>
          ) : choice === NO_CHOICE ? null : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="portions">{dict.portionsLabel}</Label>
              <Input
                enterKeyHint="done"
                id="portions"
                name="portions"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                step={1}
                value={portions}
                onChange={(e) => setPortions(e.target.value)}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">{dict.portionsHint}</p>
            </div>
          )}

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              <PendingLabel
                pending={pending}
                busy={isEdit ? dict.saving : dict.adding}
                idle={isEdit ? dict.save : dict.add}
              />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
