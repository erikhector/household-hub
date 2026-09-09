"use client";

import { useActionState, useState } from "react";
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
import { addMealEntryAction } from "@/app/dashboard/meal-planning/actions";
import { CUSTOM_RECIPE_SENTINEL, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import type { RecipeData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};

export function AddMealDialog({
  dict,
  weekStartKey,
  dateKey,
  mealType,
  recipes,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  dateKey: string;
  mealType: MealType;
  recipes: RecipeData[];
}) {
  const [open, setOpen] = useState(false);
  const [recipeChoice, setRecipeChoice] = useState(CUSTOM_RECIPE_SENTINEL);
  const [portions, setPortions] = useState("4");
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await addMealEntryAction(prevState, formData);
    if (!result.error) {
      setOpen(false);
      setRecipeChoice(CUSTOM_RECIPE_SENTINEL);
      setPortions("4");
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
          <Button type="button" variant="ghost" size="icon-xs" aria-label={dict.addMeal}>
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.addMealDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="weekStartDate" value={weekStartKey} />
          <input type="hidden" name="date" value={dateKey} />
          <input type="hidden" name="mealType" value={mealType} />

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
                id="freeformName"
                name="freeformName"
                placeholder={dict.customMealNamePlaceholder}
                maxLength={120}
                autoFocus
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="portions">{dict.portionsLabel}</Label>
              <Input
                id="portions"
                name="portions"
                type="number"
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
              {pending ? dict.adding : dict.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
