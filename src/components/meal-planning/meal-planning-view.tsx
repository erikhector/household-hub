"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WeekPlanner } from "@/components/meal-planning/week-planner";
import { RecipeManager } from "@/components/meal-planning/recipe-manager";
import { CookNowList } from "@/components/meal-planning/cook-now-list";
import { MealVarietyRecap } from "@/components/meal-planning/meal-variety-recap";
import type {
  ActiveShoppingListOption,
  CookableRecipeData,
  MealPlanEntryData,
  RecipeData,
} from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Tab = "planner" | "recipes" | "cook";

export function MealPlanningView({
  dict,
  weekStartKey,
  recipes,
  entries,
  activeShoppingLists,
  varietyCount,
  cookableRecipes,
  ingredientNames,
  ingredientUnits,
}: {
  dict: Dictionary["mealPlanning"];
  weekStartKey: string;
  recipes: RecipeData[];
  entries: MealPlanEntryData[];
  activeShoppingLists: ActiveShoppingListOption[];
  varietyCount: number;
  cookableRecipes: CookableRecipeData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
}) {
  const [tab, setTab] = useState<Tab>("planner");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>

      {varietyCount > 0 && <MealVarietyRecap count={varietyCount} dict={dict} />}

      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
        <Button
          type="button"
          variant={tab === "planner" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("planner")}
        >
          {dict.tabPlanner}
        </Button>
        <Button
          type="button"
          variant={tab === "recipes" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("recipes")}
        >
          {dict.tabRecipes}
        </Button>
        <Button
          type="button"
          variant={tab === "cook" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("cook")}
        >
          {dict.tabCookNow}
        </Button>
      </div>

      {tab === "planner" ? (
        <WeekPlanner
          dict={dict}
          weekStartKey={weekStartKey}
          recipes={recipes}
          entries={entries}
          activeShoppingLists={activeShoppingLists}
        />
      ) : tab === "recipes" ? (
        <RecipeManager
          dict={dict}
          recipes={recipes}
          ingredientNames={ingredientNames}
          ingredientUnits={ingredientUnits}
        />
      ) : (
        <CookNowList dict={dict} cookableRecipes={cookableRecipes} recipes={recipes} />
      )}
    </div>
  );
}
