"use client";

import { useState } from "react";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { WeekPlanner } from "@/components/meal-planning/week-planner";
import { RecipeManager } from "@/components/meal-planning/recipe-manager";
import { CookNowList } from "@/components/meal-planning/cook-now-list";
import { MealVarietyRecap } from "@/components/meal-planning/meal-variety-recap";
import type {
  ActiveShoppingListOption,
  CookableRecipeData,
  MealPlanEntryData,
  RecipeData,
  UseItUpSuggestionData,
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
  useItUpSuggestions,
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
  useItUpSuggestions: UseItUpSuggestionData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
}) {
  const [tab, setTab] = useState<Tab>("planner");

  const tabItems: TabItem<Tab>[] = [
    { value: "planner", label: dict.tabPlanner },
    { value: "recipes", label: dict.tabRecipes },
    { value: "cook", label: dict.tabCookNow },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>

      {varietyCount > 0 && <MealVarietyRecap count={varietyCount} dict={dict} />}

      <Tabs tabs={tabItems} value={tab} onChange={setTab} />

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
          useItUpSuggestions={useItUpSuggestions}
          ingredientNames={ingredientNames}
          ingredientUnits={ingredientUnits}
        />
      ) : (
        <CookNowList
          dict={dict}
          cookableRecipes={cookableRecipes}
          recipes={recipes}
          plannerWeekStartKey={weekStartKey}
        />
      )}
    </div>
  );
}
