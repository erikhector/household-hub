"use client";

// Client-side tab switch between the budget page's sections, mirroring
// MealPlanningView's pill-button tab pattern
// (src/components/meal-planning/meal-planning-view.tsx) rather than adding a
// new UI primitive or a new route (see AGENT_TASKS.md's Task 6 — this stays
// a section/tab on the existing Budget page).
//
// Also owns everything that renders ABOVE the tab bar and needs to be
// reachable regardless of which tab is active: the zero-category onboarding
// prompt, Safe to Spend, and the "Due this period" quick-action widget. The
// due widget's "Manage recurring items" button needs to switch to the Plan
// tab, which is why it's rendered here (with data props) rather than passed
// in pre-rendered like the tab panels below — see DueRecurringWidget's doc
// comment for the fuller rationale.
//
// Tab panels themselves are Server Components rendered ahead of time by the
// page and passed in as props — a supported pattern for nesting
// server-rendered UI inside a Client Component (see
// node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md,
// "Passing Server Components to Client Components"). `hidden` (not
// conditional rendering) keeps both mounted so switching tabs doesn't
// re-fetch/re-render either side.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { DueRecurringWidget } from "@/components/budget/due-recurring-widget";
import { BudgetOnboarding } from "@/components/budget/budget-onboarding";
import type { RecurringTemplateListRow } from "@/components/budget/recurring-templates-panel";
import type { MemberOption } from "@/components/budget/transaction-dialog";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { ExpectedRecurringExpense } from "@/app/dashboard/budget/safe-to-spend-calc";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

type Tab = "fixed" | "overview" | "costAnalyzer" | "balances";

export function BudgetTabs({
  dict,
  locale,
  categories,
  safeToSpendAmount,
  safeToSpendExpectedRecurring,
  dueTemplates,
  hasRecurringTemplates,
  members,
  currentMemberId,
  fixed,
  overview,
  costAnalyzer,
  balances,
}: {
  dict: Dictionary["budget"];
  locale: Locale;
  categories: CategoryRow[];
  safeToSpendAmount: number;
  safeToSpendExpectedRecurring: ExpectedRecurringExpense[];
  /** Already filtered to `status === "due"`. */
  dueTemplates: RecurringTemplateListRow[];
  hasRecurringTemplates: boolean;
  members: MemberOption[];
  currentMemberId: string;
  // The primary tab — recurring income/costs you can plan for in advance,
  // plus savings. Shown first since it's meant to be the main view into the
  // budget; see REQUIREMENTS.md's "Fixed income & costs" subsection.
  fixed: ReactNode;
  overview: ReactNode;
  costAnalyzer: ReactNode;
  // Only passed when the household has more than one member — see
  // REQUIREMENTS.md's "Household expense splitting" subsection. Omitted
  // entirely means no third tab, rather than an empty one.
  balances?: ReactNode;
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
          <DueRecurringWidget
            templates={dueTemplates}
            hasTemplates={hasRecurringTemplates}
            categories={categories}
            members={members}
            currentMemberId={currentMemberId}
            dict={dict}
            locale={locale}
            onManageClick={() => setTab("fixed")}
          />
        </>
      ) : (
        <BudgetOnboarding dict={dict} />
      )}

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
        <Button
          type="button"
          variant={tab === "costAnalyzer" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("costAnalyzer")}
        >
          {dict.tabCostAnalyzer}
        </Button>
        {balances && (
          <Button
            type="button"
            variant={tab === "balances" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab("balances")}
          >
            {dict.tabBalances}
          </Button>
        )}
      </div>

      <div hidden={tab !== "fixed"}>{fixed}</div>
      <div hidden={tab !== "overview"}>{overview}</div>
      <div hidden={tab !== "costAnalyzer"}>{costAnalyzer}</div>
      {balances && <div hidden={tab !== "balances"}>{balances}</div>}
    </div>
  );
}
