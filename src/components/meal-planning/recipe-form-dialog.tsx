"use client";

import { useActionState, useState, type ReactElement } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createRecipeAction,
  importRecipeFromUrlAction,
  updateRecipeAction,
  type ImportRecipeState,
} from "@/app/dashboard/meal-planning/actions";
import type { RecipeData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};
const initialImportState: ImportRecipeState = {};

type IngredientRow = { uid: string; name: string; quantity: string; unit: string };

function blankRow(): IngredientRow {
  return { uid: crypto.randomUUID(), name: "", quantity: "1", unit: "pcs" };
}

function rowsFromRecipe(recipe: RecipeData | undefined): IngredientRow[] {
  if (!recipe || recipe.ingredients.length === 0) return [blankRow()];
  return recipe.ingredients.map((ingredient) => ({
    uid: ingredient.id,
    name: ingredient.name,
    quantity: String(ingredient.quantity),
    unit: ingredient.unit,
  }));
}

export function RecipeFormDialog({
  dict,
  mode,
  recipe,
  trigger,
}: {
  dict: MealPlanningDict;
  mode: "create" | "edit";
  recipe?: RecipeData;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(recipe?.name ?? "");
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() => rowsFromRecipe(recipe));
  const [importUrl, setImportUrl] = useState("");

  const action = mode === "create" ? createRecipeAction : updateRecipeAction;
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await action(prevState, formData);
    if (!result.error) {
      setOpen(false);
      if (mode === "create") {
        setName("");
        setInstructions("");
        setIngredients([blankRow()]);
        setImportUrl("");
      }
    }
    return result;
  }, initialState);

  // Pre-fills the manual fields from a successful import, for the user to
  // review/edit before saving — never auto-saves. Mirrors the main form's
  // action wrapper above: state updates happen right after the action
  // resolves, not in a useEffect (which would set state synchronously
  // during a render pass).
  const [importState, importFormAction, importPending] = useActionState(async (
    prevState: ImportRecipeState,
    formData: FormData,
  ) => {
    const result = await importRecipeFromUrlAction(prevState, formData);
    if (result.recipe) {
      if (result.recipe.name) setName(result.recipe.name);
      if (result.recipe.instructions) setInstructions(result.recipe.instructions);
      if (result.recipe.ingredients.length > 0) {
        setIngredients(
          result.recipe.ingredients.map((ingredient) => ({
            uid: crypto.randomUUID(),
            name: ingredient.name,
            quantity: String(ingredient.quantity),
            unit: ingredient.unit,
          })),
        );
      }
    }
    return result;
  }, initialImportState);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setName(recipe?.name ?? "");
      setInstructions(recipe?.instructions ?? "");
      setIngredients(rowsFromRecipe(recipe));
      setImportUrl("");
    }
  };

  const addRow = () => setIngredients((rows) => [...rows, blankRow()]);
  const removeRow = (uid: string) =>
    setIngredients((rows) => (rows.length > 1 ? rows.filter((r) => r.uid !== uid) : rows));
  const updateRow = (uid: string, field: "name" | "quantity" | "unit", value: string) =>
    setIngredients((rows) => rows.map((r) => (r.uid === uid ? { ...r, [field]: value } : r)));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? dict.newRecipeDialogTitle : dict.editRecipeDialogTitle}
          </DialogTitle>
        </DialogHeader>
        {/* A sibling form, not nested inside the create/edit form below (HTML
            forms can't nest) — importing just populates the manual fields'
            state for review, it never saves anything itself. */}
        <form
          action={importFormAction}
          className="flex flex-col gap-2 rounded-md border border-dashed p-3"
        >
          <Label htmlFor="recipe-import-url">{dict.importUrlLabel}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="recipe-import-url"
              name="url"
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder={dict.importUrlPlaceholder}
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="outline" disabled={importPending || !importUrl.trim()}>
              <Link2 className="size-3.5" />
              {importPending ? dict.importing : dict.importButton}
            </Button>
          </div>
          {importState.error && <p className="text-sm text-destructive">{importState.error}</p>}
          {!importState.error && importState.recipe && (
            <p className="text-sm text-chart-5">{dict.importSuccess}</p>
          )}
        </form>

        <form action={formAction} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          {mode === "edit" && recipe && (
            <input type="hidden" name="recipeId" value={recipe.id} />
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="recipe-name">{dict.recipeNameLabel}</Label>
            <Input
              id="recipe-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="recipe-instructions">{dict.instructionsLabel}</Label>
            <Textarea
              id="recipe-instructions"
              name="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={dict.instructionsPlaceholder}
              maxLength={4000}
              rows={4}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>{dict.ingredientsLabel}</Label>
              <Button type="button" variant="outline" size="xs" onClick={addRow}>
                <Plus className="size-3" />
                {dict.addIngredient}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {ingredients.map((row) => (
                <div key={row.uid} className="flex items-center gap-1.5">
                  <Input
                    name="ingredientName"
                    value={row.name}
                    onChange={(e) => updateRow(row.uid, "name", e.target.value)}
                    placeholder={dict.ingredientNamePlaceholder}
                    maxLength={120}
                    className="min-w-0 flex-1"
                  />
                  <Input
                    name="ingredientQuantity"
                    type="number"
                    min={0.01}
                    max={1000000}
                    step="any"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.uid, "quantity", e.target.value)}
                    placeholder={dict.ingredientQuantityPlaceholder}
                    className="w-16 shrink-0"
                  />
                  <Input
                    name="ingredientUnit"
                    value={row.unit}
                    onChange={(e) => updateRow(row.uid, "unit", e.target.value)}
                    placeholder={dict.ingredientUnitPlaceholder}
                    maxLength={20}
                    className="w-16 shrink-0"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={dict.removeIngredientAriaLabel}
                    onClick={() => removeRow(row.uid)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? mode === "create"
                  ? dict.creating
                  : dict.saving
                : mode === "create"
                  ? dict.create
                  : dict.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
