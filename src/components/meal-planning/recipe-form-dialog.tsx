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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type ComponentRow = { uid: string; componentRecipeId: string; quantity: string };

function componentRowsFromRecipe(recipe: RecipeData | undefined): ComponentRow[] {
  if (!recipe) return [];
  return recipe.components.map((component) => ({
    uid: component.id,
    componentRecipeId: component.componentRecipeId,
    quantity: String(component.quantity),
  }));
}

export function RecipeFormDialog({
  dict,
  mode,
  recipe,
  allRecipes,
  trigger,
}: {
  dict: MealPlanningDict;
  mode: "create" | "edit";
  recipe?: RecipeData;
  allRecipes: RecipeData[];
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 4));
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() => rowsFromRecipe(recipe));
  const [components, setComponents] = useState<ComponentRow[]>(() => componentRowsFromRecipe(recipe));
  const [importUrl, setImportUrl] = useState("");

  // Every other household recipe can be added as a sub-recipe — a brand-new
  // recipe (no `recipe.id` yet) can't be anyone's own descendant, so nothing
  // needs excluding beyond itself in edit mode. The server re-validates for
  // real (see wouldCreateCycle in actions.ts); this only drives the picker.
  const componentCandidates = allRecipes.filter((candidate) => candidate.id !== recipe?.id);

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
        setServings("4");
        setInstructions("");
        setIngredients([blankRow()]);
        setComponents([]);
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
      setServings(String(recipe?.servings ?? 4));
      setInstructions(recipe?.instructions ?? "");
      setIngredients(rowsFromRecipe(recipe));
      setComponents(componentRowsFromRecipe(recipe));
      setImportUrl("");
    }
  };

  const addRow = () => setIngredients((rows) => [...rows, blankRow()]);
  const removeRow = (uid: string) =>
    setIngredients((rows) => (rows.length > 1 ? rows.filter((r) => r.uid !== uid) : rows));
  const updateRow = (uid: string, field: "name" | "quantity" | "unit", value: string) =>
    setIngredients((rows) => rows.map((r) => (r.uid === uid ? { ...r, [field]: value } : r)));

  // A fresh row always starts pointed at a real, not-yet-used recipe (never
  // an empty selection) — addComponentRow is a no-op once every candidate is
  // already in use, and the "Add sub-recipe" button is disabled to match.
  const usedComponentIds = new Set(components.map((c) => c.componentRecipeId));
  const hasAvailableComponentRecipe = componentCandidates.some((c) => !usedComponentIds.has(c.id));
  const addComponentRow = () => {
    const next = componentCandidates.find((c) => !usedComponentIds.has(c.id));
    if (!next) return;
    setComponents((rows) => [...rows, { uid: crypto.randomUUID(), componentRecipeId: next.id, quantity: "1" }]);
  };
  const removeComponentRow = (uid: string) =>
    setComponents((rows) => rows.filter((r) => r.uid !== uid));
  const updateComponentRow = (uid: string, field: "componentRecipeId" | "quantity", value: string) =>
    setComponents((rows) => rows.map((r) => (r.uid === uid ? { ...r, [field]: value } : r)));
  const optionsForComponentRow = (row: ComponentRow) =>
    componentCandidates.filter(
      (c) => c.id === row.componentRecipeId || !components.some((other) => other.uid !== row.uid && other.componentRecipeId === c.id),
    );

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

          <div className="flex gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
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
            <div className="flex w-24 shrink-0 flex-col gap-2">
              <Label htmlFor="recipe-servings">{dict.servingsLabel}</Label>
              <Input
                id="recipe-servings"
                name="servings"
                type="number"
                min={1}
                max={1000}
                step={1}
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                required
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{dict.servingsHint}</p>

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

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>{dict.componentsLabel}</Label>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={addComponentRow}
                disabled={!hasAvailableComponentRecipe}
              >
                <Plus className="size-3" />
                {dict.addComponent}
              </Button>
            </div>
            {components.length === 0 && !hasAvailableComponentRecipe && (
              <p className="text-sm text-muted-foreground">{dict.noAvailableComponentRecipes}</p>
            )}
            <div className="flex flex-col gap-2">
              {components.map((row) => {
                const options = optionsForComponentRow(row);
                return (
                  <div key={row.uid} className="flex items-center gap-1.5">
                    <Select
                      value={row.componentRecipeId}
                      onValueChange={(v) => updateComponentRow(row.uid, "componentRecipeId", String(v))}
                    >
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue>
                          {(v: string) => options.find((o) => o.id === v)?.name ?? v}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input type="hidden" name="componentRecipeId" value={row.componentRecipeId} />
                    <Input
                      name="componentQuantity"
                      type="number"
                      min={0.01}
                      max={1000}
                      step="any"
                      value={row.quantity}
                      onChange={(e) => updateComponentRow(row.uid, "quantity", e.target.value)}
                      placeholder={dict.componentQuantityPlaceholder}
                      className="w-20 shrink-0"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={dict.removeComponentAriaLabel}
                      onClick={() => removeComponentRow(row.uid)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
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
