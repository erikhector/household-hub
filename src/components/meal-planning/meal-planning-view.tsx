"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Tab = "planner" | "recipes" | "cook" | "prep";

function parseTab(param: string | null): Tab {
  return param === "recipes" || param === "cook" || param === "prep" ? param : "planner";
}

// SCALE-J: the tab bodies are Server Components rendered by the page, each
// behind its own `<Suspense>` — the same "Server Components passed as props to a Client
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
  plannerTab,
  recipesTab,
  cookTab,
  prepTab,
}: {
  dict: Dictionary["mealPlanning"];
  plannerTab: ReactNode;
  recipesTab: ReactNode;
  cookTab: ReactNode;
  // GAP-49's meal-prep batches.
  prepTab: ReactNode;
}) {
  // The tab lives in `?tab=` (MATCH-6's recipe links; replaced, not pushed,
  // and keeping `?week=`), so coming back to this page — the browser's back
  // button from a recipe's ingredient page, or a reload — reopens the same
  // tab. Read from useSearchParams rather than useState seeded by the
  // server, since a browser back restores Next's cached render of the URL
  // as first loaded (see item-catalog.tsx).
  const tabParam = useSearchParams().get("tab");
  const paramTab = parseTab(tabParam);
  // MAINT-57: the open tab is local state that follows `?tab=`, not a pure
  // read of it. useSearchParams only changes once Next's router has
  // committed a restore transition for the replaceState below, and that
  // transition can wait behind other router work (a refetch of this
  // dynamic page under load), so a click left the tab unselected for
  // seconds, a flaky "aria-selected is still false" on phones. Setting
  // the state in the click selects the tab at once; when the param
  // changes from outside (the browser's back button, a MATCH-6 link) the
  // state is re-derived from it during render, the "adjust state when a
  // prop changes" pattern, so the URL stays the source of truth.
  const [tab, setTab] = useState<Tab>(paramTab);
  const [seenParam, setSeenParam] = useState(tabParam);
  if (tabParam !== seenParam) {
    setSeenParam(tabParam);
    setTab(paramTab);
  }
  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "planner") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  const tabItems: TabItem<Tab>[] = [
    { value: "planner", label: dict.tabPlanner },
    { value: "recipes", label: dict.tabRecipes },
    { value: "cook", label: dict.tabCookNow },
    { value: "prep", label: dict.tabPrep },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Tabs tabs={tabItems} value={tab} onChange={selectTab} />

      <div hidden={tab !== "planner"}>{plannerTab}</div>
      <div hidden={tab !== "recipes"}>{recipesTab}</div>
      <div hidden={tab !== "cook"}>{cookTab}</div>
      <div hidden={tab !== "prep"}>{prepTab}</div>
    </div>
  );
}
