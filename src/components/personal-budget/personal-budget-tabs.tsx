"use client";

// Two-tab switch (Plan / Activity) for the personal budget page, mirroring
// BudgetTabs's pattern (src/components/budget/budget-tabs.tsx) at a smaller
// scale — no cost analyzer or balances tab exists here, so there's nothing to
// gate. See BudgetTabs's doc comment for why the onboarding/Safe to
// Spend/Due widget row lives here rather than in the page.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { PersonalDueRecurringWidget } from "@/components/personal-budget/personal-due-recurring-widget";
import { PersonalBudgetOnboarding } from "@/components/personal-budget/personal-budget-onboarding";
import type { PersonalRecurringTemplateListRow } from "@/components/personal-budget/personal-recurring-templates-panel";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";
import type { ExpectedRecurringExpense } from "@/lib/safe-to-spend-calc";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

type Tab = "fixed" | "overview";

export function PersonalBudgetTabs({
  dict,
  locale,
  categories,
  safeToSpendAmount,
  safeToSpendExpectedRecurring,
  dueTemplates,
  hasRecurringTemplates,
  fixed,
  overview,
}: {
  dict: Dictionary["personalBudget"];
  locale: Locale;
  categories: PersonalCategoryRow[];
  safeToSpendAmount: number;
  safeToSpendExpectedRecurring: ExpectedRecurringExpense[];
  dueTemplates: PersonalRecurringTemplateListRow[];
  hasRecurringTemplates: boolean;
  // The primary tab — see BudgetTabs's `fixed` prop doc comment.
  fixed: ReactNode;
  overview: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("fixed");
  const hasCategories = categories.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {hasCategories ? (
        <>
          <SafeToSpend
            amount={safeToSpendAmount}
            expectedRecurring={safeToSpendExpectedRecurring}
            dict={dict.safeToSpend}
            locale={locale}
          />
          <PersonalDueRecurringWidget
            templates={dueTemplates}
            hasTemplates={hasRecurringTemplates}
            categories={categories}
            dict={dict}
            locale={locale}
            onManageClick={() => setTab("fixed")}
          />
        </>
      ) : (
        <PersonalBudgetOnboarding dict={dict} />
      )}

      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
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
