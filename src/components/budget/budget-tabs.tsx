"use client";

// Client-side tab switch between the existing budget Overview and the new
// Cost analyzer, mirroring MealPlanningView's pill-button tab pattern
// (src/components/meal-planning/meal-planning-view.tsx) rather than adding a
// new UI primitive or a new route (see AGENT_TASKS.md's Task 6 — this stays
// a section/tab on the existing Budget page).
//
// Both sections are Server Components rendered ahead of time by the page and
// passed in as props — a supported pattern for nesting server-rendered UI
// inside a Client Component (see
// node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md,
// "Passing Server Components to Client Components"). `hidden` (not
// conditional rendering) keeps both mounted so switching tabs doesn't
// re-fetch/re-render either side.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Tab = "overview" | "costAnalyzer";

export function BudgetTabs({
  dict,
  overview,
  costAnalyzer,
}: {
  dict: Dictionary["budget"];
  overview: ReactNode;
  costAnalyzer: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Button
          type="button"
          variant={tab === "overview" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("overview")}
        >
          {dict.tabOverview}
        </Button>
        <Button
          type="button"
          variant={tab === "costAnalyzer" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("costAnalyzer")}
        >
          {dict.tabCostAnalyzer}
        </Button>
      </div>

      <div hidden={tab !== "overview"}>{overview}</div>
      <div hidden={tab !== "costAnalyzer"}>{costAnalyzer}</div>
    </div>
  );
}
