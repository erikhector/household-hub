"use client";

// Two-tab switch (Fixed income & costs / Overview) for the personal budget
// page, mirroring BudgetTabs's pill-button pattern
// (src/components/budget/budget-tabs.tsx) at a smaller scale — no cost
// analyzer or balances tab exists here, so there's nothing to gate.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Tab = "fixed" | "overview";

export function PersonalBudgetTabs({
  dict,
  fixed,
  overview,
}: {
  dict: Dictionary["personalBudget"];
  // The primary tab — see BudgetTabs's `fixed` prop doc comment.
  fixed: ReactNode;
  overview: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("fixed");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Button
          type="button"
          variant={tab === "fixed" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("fixed")}
        >
          {dict.tabFixed}
        </Button>
        <Button
          type="button"
          variant={tab === "overview" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("overview")}
        >
          {dict.tabOverview}
        </Button>
      </div>

      <div hidden={tab !== "fixed"}>{fixed}</div>
      <div hidden={tab !== "overview"}>{overview}</div>
    </div>
  );
}
