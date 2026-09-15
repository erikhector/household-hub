import { ChefHat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AddToPlanDialog } from "@/components/meal-planning/add-to-plan-dialog";
import { format, plural } from "@/lib/i18n/format";
import type { CookableRecipeData, RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

export function CookNowList({
  dict,
  cookableRecipes,
  recipes,
}: {
  dict: MealPlanningDict;
  cookableRecipes: CookableRecipeData[];
  recipes: RecipeData[];
}) {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{dict.cookNowTitle}</h2>
        <p className="text-sm text-muted-foreground">{dict.cookNowSubtitle}</p>
      </div>

      {cookableRecipes.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {dict.emptyCookNow}
        </p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {cookableRecipes.map((recipe) => {
            // Rows only ever come from `recipes` (see cookable-recipes.ts) —
            // the lookup existing is a given, not a real fallback case.
            const fullRecipe = recipesById.get(recipe.recipeId);
            if (!fullRecipe) return null;

            return (
              <div key={recipe.recipeId} className="flex items-center gap-3 px-3 py-2.5">
                <ChefHat className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={recipe.recipeName}>
                    {recipe.recipeName}
                  </p>
                  {recipe.missingIngredientNames.length === 0 ? (
                    <Badge variant="secondary">{dict.readyToCookBadge}</Badge>
                  ) : (
                    <p
                      className="truncate text-sm text-muted-foreground"
                      title={recipe.missingIngredientNames.join(", ")}
                    >
                      {format(
                        plural(recipe.missingIngredientNames.length, dict.missingIngredientCount),
                        { count: recipe.missingIngredientNames.length },
                      )}
                      {": "}
                      {recipe.missingIngredientNames.join(", ")}
                    </p>
                  )}
                </div>
                <AddToPlanDialog
                  dict={dict}
                  recipeId={fullRecipe.id}
                  recipeName={fullRecipe.name}
                  defaultPortions={fullRecipe.servings}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
