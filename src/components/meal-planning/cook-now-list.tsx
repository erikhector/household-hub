import Link from "next/link";
import { ChefHat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";
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
  plannerWeekStartKey,
}: {
  dict: MealPlanningDict;
  cookableRecipes: CookableRecipeData[];
  recipes: RecipeData[];
  // The week currently shown in the Planner tab — passed through so
  // AddToPlanDialog can tell the user when its date picker (free-ranging,
  // unlike the planner grid's fixed per-slot dates) saves outside it. See D3
  // in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.
  plannerWeekStartKey: string;
}) {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{dict.cookNowTitle}</h2>
        <p className="text-sm text-muted-foreground">{dict.cookNowSubtitle}</p>
      </div>

      {cookableRecipes.length === 0 ? (
        // UX-50: the mascot and one next step, like every other tab. With no
        // recipes the step is to add one (the Recipes tab holds the form);
        // with recipes but none close to ready, it is stocking up.
        <MascotEmptyState
          alt={dict.mascotAlt}
          action={
            recipes.length === 0 ? (
              <Button
               
                render={<Link href={`/dashboard/meal-planning?tab=recipes&week=${plannerWeekStartKey}`} />}
              >
                <Plus className="size-4" />
                {dict.cookNowAddRecipe}
              </Button>
            ) : (
              <Button render={<Link href="/dashboard/inventory" />}>
                {dict.cookNowOpenInventory}
              </Button>
            )
          }
        >
          <p className="text-sm text-muted-foreground">
            {recipes.length === 0 ? dict.emptyCookNowNoRecipes : dict.emptyCookNow}
          </p>
        </MascotEmptyState>
      ) : (
        <div className="list-bleed flex flex-col divide-y rounded-md border">
          {cookableRecipes.map((recipe) => {
            // Rows only ever come from `recipes` (see cookable-recipes.ts) —
            // the lookup existing is a given, not a real fallback case.
            const fullRecipe = recipesById.get(recipe.recipeId);
            if (!fullRecipe) return null;

            return (
              <div key={recipe.recipeId} className="flex items-center gap-3 px-3 py-2.5">
                <ChefHat className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words sm:line-clamp-1 font-medium" title={recipe.recipeName}>
                    {recipe.recipeName}
                  </p>
                  {recipe.missingIngredientNames.length === 0 ? (
                    <Badge variant="secondary">{dict.readyToCookBadge}</Badge>
                  ) : (
                    <p
                      className="line-clamp-2 break-words sm:line-clamp-1 text-sm text-muted-foreground"
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
                  plannerWeekStartKey={plannerWeekStartKey}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
