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
// insights already work, needs no decision at all.
//
// `readOnly` (the household page is showing a household other than the
// active one via `?household=`, see src/lib/budget-household-view.ts): every
// write control sits inside a `<fieldset disabled>`, which natively disables
// each descendant <button>/<input> (dialog triggers included, so no form can
// even open), while the tab bar and MonthNavigator stay outside it and keep
// working. The budget actions all write to the active household, so letting
// them fire from here would put rows in a different household than the one
// on screen. Never set on the personal budget page.

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { LimitAlerts, type LimitAlertRow } from "@/components/budget/limit-alerts";
import type { PlannedExpenseRow } from "@/components/budget/planned-expenses-panel";
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
import type { DailyAllowance, MonthProjection } from "@/lib/chart-calc";
import type { ActionState } from "@/lib/actions/auth";
import { createMoneyFormat } from "@/lib/currency";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { BudgetStartDayProvider } from "@/components/budget/budget-period-context";
import { PrimaryAction } from "@/components/dashboard/primary-action";
import { parseBudgetTab, type BudgetTab } from "@/lib/budget-url";

export type { BudgetTab };
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
  currencyCode = null,
  monthKey,
  currentMonthKey,
  budgetMonthStartDay = 1,
  basePath,
  householdParam,
  readOnly = false,
  categories,
  safeToSpendAmount,
  safeToSpendStatus,
  safeToSpendBreakdown,
  safeToSpendExpectedRecurring,
  safeToSpendProjection = null,
  safeToSpendDaily = null,
  limitAlerts = [],
  householdDebts = [],
  dueTemplates,
  hasRecurringTemplates,
  hadRecurringTemplatesInMonth,
  plannedDue = [],
  members = [],
  currentMemberId = "",
  sharedDueRows = [],
  showHouseholdName = false,
  sharedExpenseHouseholds = [],
  logSharedDialogDict,
  createTransactionAction,
  updateTransactionAction,
  deleteTransactionAction,
  recentCategoryIds,
  onAcknowledgeTemplate,
  onLogTemplateAsIs,
  savingsGoals,
  onboarding,
  sharedCosts,
  manage,
  transactions,
  insights,
}: {
  dict: BudgetTabsDict;
  locale: Locale;
  /** GAP-13: the viewed household's display currency, for the amounts this
   * component renders itself (Safe to spend, the due widget). Left unset by
   * the personal budget page, which spans every household the user is in
   * and so has no single currency to show — its amounts stay symbol-free. */
  currencyCode?: string | null;
  /** "YYYY-MM" — the month currently selected via the page's `?month=`
   * search param (see src/app/dashboard/budget/page.tsx). */
  monthKey: string;
  /** The server's "YYYY-MM" for today — see MonthNavigator's prop. */
  currentMonthKey: string;
  /** UX-134: the budget month start day (1 = calendar months): the
   * household's, or on the personal budget the user's own. Names the
   * period's dates in the month bar and sets new transactions' default
   * date. */
  budgetMonthStartDay?: number;
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
  /** UX-108: categories at 90% or more of their limit, worst first. */
  limitAlerts?: LimitAlertRow[];
  /** UX-39 — see SafeToSpend's `projection` prop. */
  safeToSpendProjection?: MonthProjection | null;
  /** UX-117 — see SafeToSpend's `dailyAllowance` prop. */
  safeToSpendDaily?: DailyAllowance | null;
  /** Personal budget only — see SafeToSpend's identical prop. */
  householdDebts?: HouseholdDebt[];
  /** Already filtered to `status === "due"`. */
  dueTemplates: RecurringTemplateListRow[];
  /** Any active recurring template at all, whatever month is viewed. */
  hasRecurringTemplates: boolean;
  /** UX-118: whether any of them existed in the viewed month (a template
   * never backward-propagates), so a month from before they were set up
   * says "nothing was due" rather than "set up recurring items". */
  hadRecurringTemplatesInMonth: boolean;
  /** Outstanding planned bills (BUDGET-8), for the due strip: the
   * household's, or on the personal budget page the user's own. */
  plannedDue?: PlannedExpenseRow[];
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
  /** deleteTransactionAction (household) or deletePersonalTransactionAction
   * (personal) — the Add transaction toast's Undo (UX-109). */
  deleteTransactionAction: (id: string) => Promise<ActionState>;
  /** UX-109: the viewer's most recently used category ids, newest first. */
  recentCategoryIds: string[];
  /** acknowledgeTemplatePeriodAction (household) or
   * acknowledgePersonalTemplatePeriodAction (personal). */
  onAcknowledgeTemplate: (id: string) => Promise<ActionState>;
  /** logRecurringTemplateAction (household) or
   * logPersonalRecurringTemplateAction (personal). */
  onLogTemplateAsIs: (id: string) => Promise<ActionState>;
  /** GAP-22's SavingsGoals card, prebuilt by the page like `insights`
   * (it renders nothing when no SAVINGS category has a goal). */
  savingsGoals?: ReactNode;
  /** BudgetOnboarding or PersonalBudgetOnboarding, prebuilt by the page —
   * see this file's doc comment on why these stay separate components. */
  onboarding: ReactNode;
  /** UX-112, personal budget only: the shared-costs card, prebuilt by the
   * page and shown above `onboarding` while there are no categories. */
  sharedCosts?: ReactNode;
  // Recurring items + categories — see this file's doc comment.
  manage: ReactNode;
  transactions: ReactNode;
  insights: ReactNode;
}) {
  // The tab lives in `?tab=` (replaced, not pushed, like MealPlanningView),
  // so a link (Personal Budget's "Settle up", a notification) can land
  // straight on a tab, a reload keeps it, and MonthNavigator's links carry
  // it: paging months from Transactions used to bounce back to Overview,
  // since the tab was client state the month links knew nothing about.
  // Read from useSearchParams rather than state seeded by the server, so a
  // browser back to a cached render still shows the tab its URL names.
  const searchParams = useSearchParams();
  const tab = parseBudgetTab(searchParams.get("tab"));
  const setTab = (next: Tab) => {
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };
  // UX-116: the setup card's links keep the month and household in the URL.
  const tabHref = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    return `${basePath}?${params.toString()}`;
  };
  const hasCategories = categories.length > 0;

  // UX-15: the split warnings in the two dialogs below.
  const numberFormat = createMoneyFormat(locale, currencyCode);

  const tabItems: TabItem<Tab>[] = [
    { value: "overview", label: dict.tabOverview },
    { value: "manage", label: dict.tabManage },
    { value: "transactions", label: dict.tabTransactions },
    { value: "insights", label: dict.tabInsights },
  ];

  return (
    <BudgetStartDayProvider startDay={budgetMonthStartDay}>
    <div className="flex flex-col gap-6">
      {/* The month bar and the tab bar are one block of chrome: closer
          together than the sections below them, so they cost less of a
          phone's first screen. */}
      <div className="flex flex-col gap-3">
        <MonthNavigator
          basePath={basePath}
          monthKey={monthKey}
          currentMonthKey={currentMonthKey}
          startDay={budgetMonthStartDay}
          locale={locale}
          dict={dict}
          params={{
            household: householdParam,
            tab,
            category: searchParams.get("category") ?? undefined,
            q: searchParams.get("q") ?? undefined,
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs tabs={tabItems} value={tab} onChange={setTab} />
          <fieldset disabled={readOnly} className="flex min-w-0 flex-wrap items-center gap-2">
            {sharedExpenseHouseholds.length > 0 && logSharedDialogDict && (() => {
              const dialog = (
                <LogSharedExpenseDialog
                  numberFormat={numberFormat}
                  dict={logSharedDialogDict}
                  households={sharedExpenseHouseholds}
                  monthKey={monthKey}
                  trigger={
                    <Button variant={hasCategories ? "outline" : "default"}>
                      {logSharedDialogDict.logShared.button}
                    </Button>
                  }
                />
              );
              // UX-112: with no category yet, adding a shared expense is the
              // page's one action, so it takes the primary slot (the floating
              // button on phones, DESIGN.md M2) exactly where the household
              // page's "Add transaction" sits. Once Add transaction exists it
              // is the primary and this stays the quieter second action.
              return hasCategories ? dialog : <PrimaryAction>{dialog}</PrimaryAction>;
            })()}
            {/* UX-23: with no category yet there is nothing to log against, and
                a disabled primary read as broken. The onboarding card on
                Overview is the next step, so the button appears once it is
                possible. */}
            {hasCategories && (
              <PrimaryAction>
                <TransactionDialog
                  numberFormat={numberFormat}
                  dict={dict}
                  categories={categories}
                  members={members}
                  currentMemberId={currentMemberId}
                  monthKey={monthKey}
                  createAction={createTransactionAction}
                  updateAction={updateTransactionAction}
                  onUndoCreate={deleteTransactionAction}
                  recentCategoryIds={recentCategoryIds}
                  // The filter is only in view on the Transactions tab; an
                  // old ?category= left in the URL elsewhere shouldn't
                  // steer Add.
                  filterCategoryId={tab === "transactions" ? searchParams.get("category") : null}
                  trigger={<Button>{dict.addTransaction}</Button>}
                />
              </PrimaryAction>
            )}
          </fieldset>
        </div>
      </div>

      <fieldset disabled={readOnly} className="contents">
        <div hidden={tab !== "overview"} className="flex flex-col gap-6">
          {hasCategories ? (
            <>
              {/* UX-23: the key number comes first (DESIGN.md Hierarchy). */}
              <SafeToSpend
                amount={safeToSpendAmount}
                status={safeToSpendStatus}
                breakdown={safeToSpendBreakdown}
                expectedRecurring={safeToSpendExpectedRecurring}
                householdDebts={householdDebts}
                showHouseholdName={showHouseholdName}
                projection={safeToSpendProjection}
                dailyAllowance={safeToSpendDaily}
                variant="compact"
                setupHrefs={{ income: tabHref("transactions"), bills: tabHref("manage") }}
                limitAlertCount={limitAlerts.length}
                dict={dict.safeToSpend}
                locale={locale}
                currencyCode={currencyCode}
              />
              {/* UX-108: right under the number, so a category past its
                  limit isn't only found on Insights. */}
              <LimitAlerts alerts={limitAlerts} numberFormat={numberFormat} dict={dict.safeToSpend} />
              <DueRecurringWidget
                templates={dueTemplates}
                hasTemplates={hasRecurringTemplates}
                hadTemplatesInMonth={hadRecurringTemplatesInMonth}
                plannedDue={plannedDue}
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
                currencyCode={currencyCode}
                onManageClick={() => setTab("manage")}
                onAcknowledge={onAcknowledgeTemplate}
                onLogAsIs={onLogTemplateAsIs}
                createTransactionAction={createTransactionAction}
                updateTransactionAction={updateTransactionAction}
              />
              {/* Phone pass (Oct 2026), P4: PeriodSummary ("This month")
                  used to follow here too, repeating Safe to spend's
                  income/expenses/remaining as four more full-width stat
                  cards; it lives on Insights only now. */}
              {savingsGoals}
            </>
          ) : (
            <>
              {/* UX-112: what they owe or are owed comes before "set up". */}
              {sharedCosts}
              {onboarding}
            </>
          )}
        </div>

        <div hidden={tab !== "manage"}>{manage}</div>
        <div hidden={tab !== "transactions"}>{transactions}</div>
        <div hidden={tab !== "insights"}>{insights}</div>
      </fieldset>
    </div>
    </BudgetStartDayProvider>
  );
}
