"use client";

import { useMemo, useState, useTransition } from "react";
import { ChefHat, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RecipeFormDialog } from "@/components/meal-planning/recipe-form-dialog";
import { deleteRecipeAction } from "@/app/dashboard/meal-planning/recipe-actions";
import { format, plural } from "@/lib/i18n/format";
import type { RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

function matchesQuery(recipe: RecipeData, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (recipe.name.toLowerCase().includes(q)) return true;
  if (recipe.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(q))) return true;
  return recipe.components.some((component) =>
    component.componentRecipeName.toLowerCase().includes(q),
  );
}

export function RecipeManager({
  dict,
  recipes,
  ingredientNames,
  ingredientUnits,
}: {
  dict: MealPlanningDict;
  recipes: RecipeData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const filteredRecipes = useMemo(
    () => recipes.filter((recipe) => matchesQuery(recipe, query)),
    [recipes, query],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">{dict.recipesTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.recipesSubtitle}</p>
        </div>
        <RecipeFormDialog
          dict={dict}
          mode="create"
          allRecipes={recipes}
          ingredientNames={ingredientNames}
          ingredientUnits={ingredientUnits}
          trigger={
            <Button type="button">
              <Plus className="size-4" />
              {dict.newRecipe}
            </Button>
          }
        />
      </div>

      {recipes.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {dict.emptyRecipes}
        </p>
      ) : (
        <>
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={dict.searchRecipesPlaceholder}
            aria-label={dict.searchRecipesPlaceholder}
            clearLabel={dict.clearSearch}
          />

          {filteredRecipes.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {dict.noRecipeSearchResults}
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {filteredRecipes.map((recipe) => (
                <RecipeRow
                  key={recipe.id}
                  dict={dict}
                  recipe={recipe}
                  allRecipes={recipes}
                  ingredientNames={ingredientNames}
                  ingredientUnits={ingredientUnits}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecipeRow({
  dict,
  recipe,
  allRecipes,
  ingredientNames,
  ingredientUnits,
}: {
  dict: MealPlanningDict;
  recipe: RecipeData;
  allRecipes: RecipeData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
}) {
  const [isPending, startTransition] = useTransition();
  const ingredientSummary = recipe.ingredients.map((ingredient) => ingredient.name).join(", ");
  const componentSummary = recipe.components.map((component) => component.componentRecipeName).join(", ");
  // Only shown when at least one nutrition field was filled in — see
  // Recipe's doc comment in schema.prisma. Empty recipes (the vast
  // majority, since these fields are optional/manual) render no line here.
  const nutritionParts = [
    recipe.caloriesPerServing != null
      ? format(dict.nutritionCaloriesValue, { value: recipe.caloriesPerServing })
      : null,
    recipe.proteinGramsPerServing != null
      ? format(dict.nutritionProteinValue, { value: recipe.proteinGramsPerServing })
      : null,
    recipe.carbsGramsPerServing != null
      ? format(dict.nutritionCarbsValue, { value: recipe.carbsGramsPerServing })
      : null,
    recipe.fatGramsPerServing != null
      ? format(dict.nutritionFatValue, { value: recipe.fatGramsPerServing })
      : null,
  ].filter((part): part is string => part !== null);
  const nutritionSummary = nutritionParts.join(" · ");

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteRecipeAction(recipe.id);
      if (result.error) toast.error(result.error);
    });
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <ChefHat className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={recipe.name}>
          {recipe.name}
        </p>
        {ingredientSummary && (
          <p className="truncate text-sm text-muted-foreground" title={ingredientSummary}>
            {ingredientSummary}
          </p>
        )}
        {componentSummary && (
          <p
            className="flex items-center gap-1 truncate text-sm text-muted-foreground"
            title={`${dict.includesLabel} ${componentSummary} — ${dict.componentsHint}`}
          >
            <Layers className="size-3 shrink-0" />
            <span className="truncate">
              {dict.includesLabel} {componentSummary}
            </span>
          </p>
        )}
        {nutritionSummary && (
          <p className="truncate text-sm text-muted-foreground" title={nutritionSummary}>
            {nutritionSummary}
          </p>
        )}
      </div>
      <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">
        {format(plural(recipe.servings, dict.servingsCount), { count: recipe.servings })}
        {" · "}
        {format(plural(recipe.ingredients.length, dict.ingredientCount), {
          count: recipe.ingredients.length,
        })}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <RecipeFormDialog
          dict={dict}
          mode="edit"
          recipe={recipe}
          allRecipes={allRecipes}
          ingredientNames={ingredientNames}
          ingredientUnits={ingredientUnits}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={dict.editAriaLabel}>
              <Pencil className="size-3.5" />
            </Button>
          }
        />
        <ConfirmDialog
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={isPending}
              aria-label={dict.deleteAriaLabel}
            >
              <Trash2 className="size-3.5" />
            </Button>
          }
          title={format(dict.confirmDelete.title, { name: recipe.name })}
          description={dict.confirmDelete.description}
          cancelLabel={dict.confirmDelete.cancel}
          confirmLabel={dict.confirmDelete.confirm}
          pendingLabel={dict.confirmDelete.confirming}
          onConfirm={handleDelete}
        />
      </span>
    </div>
  );
}
