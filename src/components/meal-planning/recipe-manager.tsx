"use client";

import { useMemo, useState, useTransition } from "react";
import { ChefHat, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RecipeFormDialog } from "@/components/meal-planning/recipe-form-dialog";
import { deleteRecipeAction } from "@/app/dashboard/meal-planning/actions";
import { format, plural } from "@/lib/i18n/format";
import type { RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

function matchesQuery(recipe: RecipeData, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (recipe.name.toLowerCase().includes(q)) return true;
  return recipe.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(q));
}

export function RecipeManager({ dict, recipes }: { dict: MealPlanningDict; recipes: RecipeData[] }) {
  const [query, setQuery] = useState("");
  const filteredRecipes = useMemo(
    () => recipes.filter((recipe) => matchesQuery(recipe, query)),
    [recipes, query],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">{dict.recipesTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.recipesSubtitle}</p>
        </div>
        <RecipeFormDialog
          dict={dict}
          mode="create"
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
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dict.searchRecipesPlaceholder}
              aria-label={dict.searchRecipesPlaceholder}
              className="pl-8"
            />
          </div>

          {filteredRecipes.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {dict.noRecipeSearchResults}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRecipes.map((recipe) => (
                <RecipeCard key={recipe.id} dict={dict} recipe={recipe} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecipeCard({ dict, recipe }: { dict: MealPlanningDict; recipe: RecipeData }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <ChefHat className="size-4 shrink-0 text-primary" />
            <span className="truncate" title={recipe.name}>
              {recipe.name}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <RecipeFormDialog
              dict={dict}
              mode="edit"
              recipe={recipe}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={dict.editAriaLabel}
                >
                  <Pencil className="size-3.5" />
                </Button>
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={isPending}
              aria-label={dict.deleteAriaLabel}
              onClick={() => startTransition(() => deleteRecipeAction(recipe.id))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {format(plural(recipe.ingredients.length, dict.ingredientCount), {
            count: recipe.ingredients.length,
          })}
        </p>
        {recipe.ingredients.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-sm">
            {recipe.ingredients.map((ingredient) => (
              <li key={ingredient.id} className="truncate text-muted-foreground">
                {ingredient.name}
                {" — "}
                {ingredient.quantity} {ingredient.unit}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
