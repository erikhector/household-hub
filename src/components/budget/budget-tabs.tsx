"use client";

// Client-side tab switch between the budget page's sections, using the
// shared pill-button `Tabs` component (src/components/ui/tabs.tsx, also used
// by MealPlanningView) rather than adding a new route. Shared between the
// household budget and personal budget pages (BUDGET-4) — see
// docs/archive/PERSONAL_BUDGET_UNIFICATION.md for the merge series this
// completes (BUDGET-2: transaction/recurring components; BUDGET-3:
// CategoryManager; this one: the tab shell itself).
//
// Four tabs, each with one job (see UX pass, Sep 2026):
// - Overview: what needs attention right now and the current status (Safe to
//   Spend, what's due) — the landing tab.
// - Manage: administer the things that shape every other tab — recurring
//   income/costs and categories — grouped together since both are
//   low-frequency setup/maintenance actions, not day-to-day activity.
// - Transactions: the raw log, one job only.
// - Insights: summaries and analysis (period totals, fixed-cost trend, and,
//   household-only, cost analyzer/balances) — nothing actionable here, just
//   numbers.
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
// re-fetch/re-render any of them. `manage`/`transactions`/`insights` already
// being opaque ReactNodes built per-page is also what makes this merge easy:
// the household-only cost analyzer/balances just live inside the `insights`
// node the household page builds, with no branch needed in this file for
// them (unlike the
// props below, which this component *does* read and branch on).
//
// BudgetOnboarding/PersonalBudgetOnboarding (the empty-categories state)
// stay two separate components — see BACKLOG.md's BUDGET-5, which is a
// product decision (a personal starter-category set, reusing household's, or
// staying manual-only) not a mechanical merge — but threading the already-
// built element through as a prop here, the same way manage/transactions/
// insights/periodSummary already work, needs no decision at all.
//
// `readOnly` (the household page is showing a household other than the
// active one via `?household=`, see src/lib/budget-household-view.ts): every
// write control sits inside a `<fieldset disabled>`, which natively disables
// each descendant <button>/<input> (dialog triggers included, so no form can
// even open), while the tab bar and MonthNavigator stay outside it and keep
// working. The budget actions all write to the active household, so letting
// them fire from here would put rows in a different household than the one
// on screen. Never set on the personal budget page.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { DueRecurringWidget, type SharedDueRow } from "@/components/budget/due-recurring-widget";
import { MonthNavigator } from "@/components/budget/month-navigator";
import { TransactionDialog, type MemberOption, type TransactionFormAction } from "@/components/budget/transaction-dialog";
import {
  LogSharedExpenseDialog,
  type ShareableHousehold,
} from "@/components/personal-budget/log-shared-expense-dialog";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { RecurringTemplateListRow } from "@/components/budget/recurring-templates-panel";
import type { CategoryRow } from "@/components/budget/category-manager";
import type {
  ExpectedRecurringExpense,
  HouseholdDebt,
  SafeToSpendBreakdown,
  SafeToSpendStatus,
} from "@/lib/safe-to-spend-calc";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type BudgetTab = "overview" | "manage" | "transactions" | "insights";
type Tab = BudgetTab;

// BudgetDict plus the handful of top-level tab/action labels this file reads
// directly (not nested under any of BudgetDict's sub-sections) — both
// dict.budget and dict.personalBudget already have these fields with
// identical shapes (see src/lib/i18n/dictionaries/en.ts), so either real
// dictionary namespace satisfies this with no adapter object, same
// convention BudgetDict itself documents.
export type BudgetTabsDict = BudgetDict & {
  tabOverview: string;
  tabManage: string;
  tabTransactions: string;
  tabInsights: string;
  addTransaction: string;
  // MonthNavigator's own narrowed dict (MonthNavigatorDict) — repeated here
  // rather than imported, since intersecting with an imported type alias
  // reads no differently than spelling the three fields out.
  previousMonth: string;
  nextMonth: string;
  thisMonth: string;
  safeToSpend: Dictionary["budget"]["safeToSpend"];
};

export function BudgetTabs({
  dict,
  locale,
  monthKey,
  basePath,
  householdParam,
  readOnly = false,
  categories,
  safeToSpendAmount,
  safeToSpendStatus,
  safeToSpendBreakdown,
  safeToSpendExpectedRecurring,
  householdDebts = [],
  initialTab = "overview",
  dueTemplates,
  hasRecurringTemplates,
  members = [],
  currentMemberId = "",
  sharedDueRows = [],
  showHouseholdName = false,
  sharedExpenseHouseholds = [],
  logSharedDialogDict,
  createTransactionAction,
  updateTransactionAction,
  onAcknowledgeTemplate,
  onLogTemplateAsIs,
  periodSummary,
  savingsGoals,
  onboarding,
  manage,
  transactions,
  insights,
}: {
  dict: BudgetTabsDict;
  locale: Locale;
  /** "YYYY-MM" — the month currently selected via the page's `?month=`
   * search param (see src/app/dashboard/budget/page.tsx). */
  monthKey: string;
  /** "/dashboard/budget" or "/dashboard/personal-budget" — passed straight
   * through to MonthNavigator, which builds every prev/next/"this month"
   * link from it. */
  basePath: string;
  /** The household budget's validated `?household=` override, when one was
   * given (F1) — threaded into MonthNavigator so paging months keeps
   * pointing at that same explicit household instead of falling back to
   * whichever one is "active". Always undefined on the personal budget page,
   * which has no such deep link. */
  householdParam?: string;
  /** Disable every write control, see this file's doc comment. */
  readOnly?: boolean;
  categories: CategoryRow[];
  safeToSpendAmount: number;
  safeToSpendStatus: SafeToSpendStatus;
  safeToSpendBreakdown: SafeToSpendBreakdown;
  safeToSpendExpectedRecurring: ExpectedRecurringExpense[];
  /** Personal budget only — see SafeToSpend's identical prop. */
  householdDebts?: HouseholdDebt[];
  /** Which tab to open on — from the page's `?tab=` param, so a link (e.g.
   * Personal Budget's "Settle up") can land straight on Insights, where
   * the household Balances card lives. */
  initialTab?: Tab;
  /** Already filtered to `status === "due"`. */
  dueTemplates: RecurringTemplateListRow[];
  hasRecurringTemplates: boolean;
  /** Every member of the active household — see TransactionDialog's
   * identical prop. Omitted (defaults to `[]`) on the personal budget page,
   * which has no household members. */
  members?: MemberOption[];
  currentMemberId?: string;
  /** The user's own share of due-but-not-yet-posted shared household
   * RecurringTemplates — see DueRecurringWidget's SharedDueRow doc comment.
   * Always `[]` on the household budget page. */
  sharedDueRows?: SharedDueRow[];
  /** Only show which household a shared row belongs to once the user is in
   * more than one — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6.
   * Always `false` on the household budget page. */
  showHouseholdName?: boolean;
  /** Households the user can log a shared expense into (more than one
   * member each) — gates both the standalone "Log a shared expense" trigger
   * next to the tab bar and each due row's "Log payment" button. Always `[]`
   * on the household budget page. See LogSharedExpenseDialog. */
  sharedExpenseHouseholds?: ShareableHousehold[];
  /** The full personal-budget dictionary, needed only to satisfy
   * LogSharedExpenseDialog's own (wider) dict type — see DueRecurringWidget's
   * identical prop. Only ever read when sharedExpenseHouseholds is
   * non-empty, which never happens on the household budget page. */
  logSharedDialogDict?: Dictionary["personalBudget"];
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
  /** acknowledgeTemplatePeriodAction (household) or
   * acknowledgePersonalTemplatePeriodAction (personal). */
  onAcknowledgeTemplate: (id: string) => Promise<ActionState>;
  /** logRecurringTemplateAction (household) or
   * logPersonalRecurringTemplateAction (personal). */
  onLogTemplateAsIs: (id: string) => Promise<ActionState>;
  /** Selected month's income/expense/savings breakdown (PeriodSummary) —
   * rendered on both Overview and Insights, see page.tsx's doc comment. */
  periodSummary: ReactNode;
  /** GAP-22's SavingsGoals card, prebuilt by the page like periodSummary
   * (it renders nothing when no SAVINGS category has a goal). */
  savingsGoals?: ReactNode;
  /** BudgetOnboarding or PersonalBudgetOnboarding, prebuilt by the page —
   * see this file's doc comment on why these stay separate components. */
  onboarding: ReactNode;
  // Recurring items + categories — see this file's doc comment.
  manage: ReactNode;
  transactions: ReactNode;
  insights: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
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
        basePath={basePath}
        monthKey={monthKey}
        dict={dict}
        extraParams={householdParam ? { household: householdParam } : undefined}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={tabItems} value={tab} onChange={setTab} />
        <fieldset disabled={readOnly} className="flex min-w-0 flex-wrap items-center gap-2">
          {sharedExpenseHouseholds.length > 0 && logSharedDialogDict && (
            <LogSharedExpenseDialog
              dict={logSharedDialogDict}
              households={sharedExpenseHouseholds}
              monthKey={monthKey}
              trigger={<Button variant="outline">{logSharedDialogDict.logShared.button}</Button>}
            />
          )}
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
        </fieldset>
      </div>

      <fieldset disabled={readOnly} className="contents">
        <div hidden={tab !== "overview"} className="flex flex-col gap-6">
          {hasCategories ? (
            <>
              <DueRecurringWidget
                templates={dueTemplates}
                hasTemplates={hasRecurringTemplates}
                sharedDueRows={sharedDueRows}
                sharedExpenseHouseholds={sharedExpenseHouseholds}
                showHouseholdName={showHouseholdName}
                categories={categories}
                members={members}
                currentMemberId={currentMemberId}
                monthKey={monthKey}
                dict={dict}
                logSharedDialogDict={logSharedDialogDict}
                locale={locale}
                onManageClick={() => setTab("manage")}
                onAcknowledge={onAcknowledgeTemplate}
                onLogAsIs={onLogTemplateAsIs}
                createTransactionAction={createTransactionAction}
                updateTransactionAction={updateTransactionAction}
              />
              <SafeToSpend
                amount={safeToSpendAmount}
                status={safeToSpendStatus}
                breakdown={safeToSpendBreakdown}
                expectedRecurring={safeToSpendExpectedRecurring}
                householdDebts={householdDebts}
                showHouseholdName={showHouseholdName}
                dict={dict.safeToSpend}
                locale={locale}
              />
              {savingsGoals}
              {periodSummary}
            </>
          ) : (
            onboarding
          )}
        </div>

        <div hidden={tab !== "manage"}>{manage}</div>
        <div hidden={tab !== "transactions"}>{transactions}</div>
        <div hidden={tab !== "insights"}>{insights}</div>
      </fieldset>
    </div>
  );
}
