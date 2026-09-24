"use client";

// Client-side tab switch between the budget page's sections, using the
// shared pill-button `Tabs` component (src/components/ui/tabs.tsx, also used
// by MealPlanningView) rather than adding a new route.
//
// Four tabs, each with one job (see UX pass, Sep 2026):
// - Overview: what needs attention right now and the current status (Safe to
//   Spend, what's due) — the landing tab.
// - Manage: administer the things that shape every other tab — recurring
//   income/costs and categories — grouped together since both are
//   low-frequency setup/maintenance actions, not day-to-day activity.
// - Transactions: the raw log, one job only.
// - Insights: summaries and analysis (period totals, fixed-cost trend, cost
//   analyzer, balances) — nothing actionable here, just numbers.
//
// Previously Categories only ever lived inline in the Activity tab (with a
// small duplicate "Manage categories" dialog next to the tab bar so it had a
// stable home regardless of onboarding state) and the "Add transaction"
// button only lived inside that same tab — both were things you reach for
// constantly, but only reachable from one specific tab. Categories now gets
// its own section under Manage; Add transaction moves next to the tab bar
// itself, built right here from props already passed in, so it's reachable
// no matter which tab is active without every page having to wire up and
// pass down its own copy.
//
// Tab panels themselves are Server Components rendered ahead of time by the
// page and passed in as props — a supported pattern for nesting
// server-rendered UI inside a Client Component (see
// node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md,
// "Passing Server Components to Client Components"). `hidden` (not
// conditional rendering) keeps all mounted so switching tabs doesn't
// re-fetch/re-render any of them.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { DueRecurringWidget } from "@/components/budget/due-recurring-widget";
import { MonthNavigator } from "@/components/budget/month-navigator";
import { BudgetOnboarding } from "@/components/budget/budget-onboarding";
import { TransactionDialog, type MemberOption } from "@/components/budget/transaction-dialog";
import {
  acknowledgeTemplatePeriodAction,
  createTransactionAction,
  logRecurringTemplateAction,
  updateTransactionAction,
} from "@/app/dashboard/budget/actions";
import type { CategoryFormAction, CategoryRow } from "@/components/budget/category-manager";
import type { RecurringTemplateListRow } from "@/components/budget/recurring-templates-panel";
import type { ExpectedRecurringExpense, SafeToSpendStatus } from "@/lib/safe-to-spend-calc";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

type Tab = "overview" | "manage" | "transactions" | "insights";

export function BudgetTabs({
  dict,
  locale,
  monthKey,
  householdParam,
  categories,
  safeToSpendAmount,
  safeToSpendStatus,
  safeToSpendExpectedRecurring,
  dueTemplates,
  hasRecurringTemplates,
  members,
  currentMemberId,
  createCategoryAction,
  periodSummary,
  manage,
  transactions,
  insights,
}: {
  dict: Dictionary["budget"];
  locale: Locale;
  /** "YYYY-MM" — the month currently selected via the page's `?month=`
   * search param (see src/app/dashboard/budget/page.tsx). */
  monthKey: string;
  /** The page's validated `?household=` override, when one was given (F1) —
   * threaded into MonthNavigator so paging months keeps pointing at that
   * same explicit household instead of falling back to whichever one is
   * "active". Undefined for the normal (no deep link) case. */
  householdParam?: string;
  categories: CategoryRow[];
  safeToSpendAmount: number;
  safeToSpendStatus: SafeToSpendStatus;
  safeToSpendExpectedRecurring: ExpectedRecurringExpense[];
  /** Already filtered to `status === "due"`. */
  dueTemplates: RecurringTemplateListRow[];
  hasRecurringTemplates: boolean;
  members: MemberOption[];
  currentMemberId: string;
  // BUDGET-3: BudgetOnboarding's AddCategoryDialog takes its create action
  // as a prop instead of importing it directly, threaded through from here.
  createCategoryAction: CategoryFormAction;
  /** Selected month's income/expense/savings breakdown (PeriodSummary) —
   * rendered on both Overview and Insights, see page.tsx's doc comment. */
  periodSummary: ReactNode;
  // Recurring items + categories — see this file's doc comment.
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
      <MonthNavigator
        basePath="/dashboard/budget"
        monthKey={monthKey}
        dict={dict}
        extraParams={householdParam ? { household: householdParam } : undefined}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={tabItems} value={tab} onChange={setTab} />
        <TransactionDialog
          dict={dict}
          categories={categories}
          members={members}
          currentMemberId={currentMemberId}
          monthKey={monthKey}
          createAction={createTransactionAction}
          updateAction={updateTransactionAction}
          trigger={<Button disabled={!hasCategories}>{dict.addTransaction}</Button>}
        />
      </div>

      <div hidden={tab !== "overview"} className="flex flex-col gap-6">
        {hasCategories ? (
          <>
            <DueRecurringWidget
              templates={dueTemplates}
              hasTemplates={hasRecurringTemplates}
              categories={categories}
              members={members}
              currentMemberId={currentMemberId}
              monthKey={monthKey}
              dict={dict}
              locale={locale}
              onManageClick={() => setTab("manage")}
              onAcknowledge={acknowledgeTemplatePeriodAction}
              onLogAsIs={logRecurringTemplateAction}
              createTransactionAction={createTransactionAction}
              updateTransactionAction={updateTransactionAction}
            />
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
          <BudgetOnboarding dict={dict} createCategoryAction={createCategoryAction} />
        )}
      </div>

      <div hidden={tab !== "manage"}>{manage}</div>
      <div hidden={tab !== "transactions"}>{transactions}</div>
      <div hidden={tab !== "insights"}>{insights}</div>
    </div>
  );
}
