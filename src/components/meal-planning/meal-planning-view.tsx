"use client";

import { useState, type ReactNode } from "react";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Tab = "planner" | "recipes" | "cook";

// SCALE-J: the three tab bodies (and the variety/nutrition recaps above the tab bar)
// are Server Components rendered by the page, each behind its own
// `<Suspense>` — the same "Server Components passed as props to a Client
// Component" pattern `BudgetTabs` uses (src/components/budget/budget-tabs.tsx),
// adopted here so a slow one (Cook now's cookable-recipes expansion, in
// particular) doesn't hold up the others. This component itself needs no
// fetched data at all (unlike BudgetTabs, which needs categories/
// safeToSpend/members as plain props to decide what to render), so it
// mounts immediately — the tab bar is interactive before any of its
// content has loaded. `hidden` (not conditional rendering) keeps all three
// tab bodies mounted once loaded, so switching tabs doesn't re-fetch or
// lose their local state (e.g. Recipes' search box).
export function MealPlanningView({
  dict,
  varietyRecap,
  nutritionRecap,
  plannerTab,
  recipesTab,
  cookTab,
  initialTab = "planner",
}: {
  dict: Dictionary["mealPlanning"];
  varietyRecap: ReactNode;
  nutritionRecap: ReactNode;
  plannerTab: ReactNode;
  recipesTab: ReactNode;
  cookTab: ReactNode;
  /** `?tab=` on the page URL (MATCH-6's recipe links). */
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabItems: TabItem<Tab>[] = [
    { value: "planner", label: dict.tabPlanner },
    { value: "recipes", label: dict.tabRecipes },
    { value: "cook", label: dict.tabCookNow },
  ];

  return (
    <div className="flex flex-col gap-6">
      {varietyRecap}
      {nutritionRecap}

      <Tabs tabs={tabItems} value={tab} onChange={setTab} />

      <div hidden={tab !== "planner"}>{plannerTab}</div>
      <div hidden={tab !== "recipes"}>{recipesTab}</div>
      <div hidden={tab !== "cook"}>{cookTab}</div>
    </div>
  );
}
