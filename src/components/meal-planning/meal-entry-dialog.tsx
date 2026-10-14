"use client";

import { useActionState, useRef, useState, type ReactElement } from "react";
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
import type { MealPlanEntryData, RecipeData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};

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
  mealType: MealType;
  // UX-5: an empty slot is one full-width row (this label on the left, "+ Add
  // meal" on the right) instead of a label, a "Nothing planned" line and a
  // tiny "+" button. Omitted, the trigger is the compact icon button that
  // sits beside a slot's existing entries.
  slotLabel?: string;
  // UX-21: a day with nothing planned shows one "+ Add meal" for the whole
  // day, so the dialog asks which slot (`mealType` is the preselected one).
  askSlot?: boolean;
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
  trigger: ReactElement;
};

export function MealEntryDialog(props: CreateProps | EditProps) {
  const { dict, recipes } = props;
  const isEdit = props.mode === "edit";

  const [open, setOpen] = useState(false);
  const freeformNameRef = useRef<HTMLInputElement>(null);
  const [recipeChoice, setRecipeChoice] = useState(
    isEdit ? (props.entry.recipeId ?? CUSTOM_RECIPE_SENTINEL) : CUSTOM_RECIPE_SENTINEL,
  );
  const [portions, setPortions] = useState(isEdit ? String(props.entry.portions) : "4");
  const [mealType, setMealType] = useState<MealType>(isEdit ? props.entry.mealType : props.mealType);

  const action = isEdit ? updateMealEntryAction : addMealEntryAction;
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await action(prevState, formData);
    if (!result.error) {
      setOpen(false);
      if (!isEdit) {
        setRecipeChoice(CUSTOM_RECIPE_SENTINEL);
        setPortions("4");
      }
    }
    return result;
  }, initialState);

  const recipeLabel = (value: string) =>
    value === CUSTOM_RECIPE_SENTINEL
      ? dict.customMealOption
      : (recipes.find((r) => r.id === value)?.name ?? value);

  // Re-picking a recipe resets portions to its own serving size (i.e. "one
  // full recipe") — the common case — while still leaving it freely
  // editable, e.g. down to 2 when only cooking half a batch for one slot.
  const handleRecipeChoiceChange = (value: string) => {
    setRecipeChoice(value);
    const recipe = recipes.find((r) => r.id === value);
    if (recipe) setPortions(String(recipe.servings));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            props.trigger
          ) : props.askSlot ? (
            <Button type="button" variant="ghost" className="h-9 w-full justify-start gap-1 px-2 text-sm text-muted-foreground max-sm:h-11">
              <Plus className="size-3.5" aria-hidden="true" />
              {dict.addMeal}
            </Button>
          ) : props.slotLabel ? (
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full justify-between px-2 text-xs font-medium uppercase text-muted-foreground max-sm:h-11"
            >
              <span>{props.slotLabel}</span>
              <span className="flex items-center gap-1 font-normal normal-case">
                <Plus className="size-3.5" aria-hidden="true" />
                {dict.addMeal}
              </span>
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon-xs" aria-label={dict.addMeal}>
              <Plus className="size-3.5" />
            </Button>
          )
        }
      />
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

          {!isEdit && props.askSlot && (
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
              value={recipeChoice}
              onValueChange={(v) => handleRecipeChoiceChange(v ?? CUSTOM_RECIPE_SENTINEL)}
            >
              <SelectTrigger id="recipeId" className="w-full">
                <SelectValue>{recipeLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM_RECIPE_SENTINEL}>{dict.customMealOption}</SelectItem>
                {recipes.map((recipe) => (
                  <SelectItem key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="recipeId" value={recipeChoice} />
          </div>

          {recipeChoice === CUSTOM_RECIPE_SENTINEL ? (
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
          ) : (
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
