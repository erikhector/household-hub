"use client";

// Four-tab switch for the personal budget page, mirroring BudgetTabs's
// pattern (src/components/budget/budget-tabs.tsx) at a smaller scale — no
// cost analyzer or balances section exists here, so Insights is just the
// period summary and the fixed-cost trend. See BudgetTabs's doc comment for
// the full rationale behind the Overview/Manage/Transactions/Insights split
// and for building the "Add transaction" trigger here rather than passing it
// down from the page.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { MonthNavigator } from "@/components/budget/month-navigator";
import { PersonalDueRecurringWidget } from "@/components/personal-budget/personal-due-recurring-widget";
import { PersonalBudgetOnboarding } from "@/components/personal-budget/personal-budget-onboarding";
import { PersonalTransactionDialog } from "@/components/personal-budget/personal-transaction-dialog";
import type { PersonalRecurringTemplateListRow } from "@/components/personal-budget/personal-recurring-templates-panel";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";
import type { ExpectedRecurringExpense, SafeToSpendStatus } from "@/lib/safe-to-spend-calc";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

type Tab = "overview" | "manage" | "transactions" | "insights";

export function PersonalBudgetTabs({
  dict,
  locale,
  monthKey,
  categories,
  safeToSpendAmount,
  safeToSpendStatus,
  safeToSpendExpectedRecurring,
  dueTemplates,
  hasRecurringTemplates,
  sharedWithHousehold,
  periodSummary,
  manage,
  transactions,
  insights,
}: {
  dict: Dictionary["personalBudget"];
  locale: Locale;
  /** "YYYY-MM" — see BudgetTabs's doc comment. */
  monthKey: string;
  categories: PersonalCategoryRow[];
  safeToSpendAmount: number;
  safeToSpendStatus: SafeToSpendStatus;
  safeToSpendExpectedRecurring: ExpectedRecurringExpense[];
  dueTemplates: PersonalRecurringTemplateListRow[];
  hasRecurringTemplates: boolean;
  /** "Shared with your household" card (see PERSONAL_HOUSEHOLD_BUDGET_LINK.md)
   * — null when the user has nothing shared to show, same as
   * PersonalDueRecurringWidget's "all caught up" case but hidden entirely
   * rather than shown empty, since most users never opt into a split. */
  sharedWithHousehold: ReactNode;
  /** Selected month's income/expense/savings breakdown (PeriodSummary) —
   * rendered on both Overview and Insights, see BudgetTabs's doc comment. */
  periodSummary: ReactNode;
  // Recurring items + categories — see BudgetTabs's doc comment.
  manage: ReactNode;
  transactions: ReactNode;
  insights: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const hasCategories = categories.length > 0;

  const tabItems: TabItem<Tab>[] = [
    { value: "overview", label: dict.tabOverview },
    { value: "manage", label: dict.tabManage },
    { value: "transactions", label: dict.tabTransactions },
    { value: "insights", label: dict.tabInsights },
  ];

  return (
    <div className="flex flex-col gap-6">
      <MonthNavigator basePath="/dashboard/personal-budget" monthKey={monthKey} dict={dict} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={tabItems} value={tab} onChange={setTab} />
        <PersonalTransactionDialog
          dict={dict}
          categories={categories}
          trigger={<Button disabled={!hasCategories}>{dict.addTransaction}</Button>}
        />
      </div>

      <div hidden={tab !== "overview"} className="flex flex-col gap-6">
        {hasCategories ? (
          <>
            <PersonalDueRecurringWidget
              templates={dueTemplates}
              hasTemplates={hasRecurringTemplates}
              categories={categories}
              dict={dict}
              locale={locale}
              onManageClick={() => setTab("manage")}
            />
            {sharedWithHousehold}
            <SafeToSpend
              amount={safeToSpendAmount}
              status={safeToSpendStatus}
              expectedRecurring={safeToSpendExpectedRecurring}
              dict={dict.safeToSpend}
              locale={locale}
            />
            {periodSummary}
          </>
        ) : (
          <PersonalBudgetOnboarding dict={dict} />
        )}
      </div>

      <div hidden={tab !== "manage"}>{manage}</div>
      <div hidden={tab !== "transactions"}>{transactions}</div>
      <div hidden={tab !== "insights"}>{insights}</div>
    </div>
  );
}
