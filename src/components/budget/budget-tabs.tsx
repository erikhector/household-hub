"use client";

// Client-side tab switch between the budget page's sections, using the
// shared pill-button `Tabs` component (src/components/ui/tabs.tsx, also used
// by MealPlanningView) rather than adding a new route (see AGENT_TASKS.md's
// Task 6 — this stays a section/tab on the existing Budget page).
//
// Also owns everything that renders ABOVE the tab bar and needs to be
// reachable regardless of which tab is active: the zero-category onboarding
// prompt, Safe to Spend, and the "Due this period" quick-action widget. The
// due widget's "Manage recurring items" button needs to switch to the Plan
// tab, which is why it's rendered here (with data props) rather than passed
// in pre-rendered like the tab panels below — see DueRecurringWidget's doc
// comment for the fuller rationale.
//
// A small "Manage categories" trigger sits next to the tab bar itself
// (rendered unconditionally, not just once categories exist) so it has one
// stable home regardless of onboarding state — see UX_FRICTION_BACKLOG.md
// item 7: before this, CategoryManager only ever rendered inside the
// Activity tab's overview panel, below several other widgets, so it "moved"
// the moment the zero-category onboarding banner disappeared. Opens the
// existing CategoryManager UI (src/components/budget/category-manager.tsx)
// in a dialog rather than duplicating its list/add/delete UI, and stays
// additive — CategoryManager's original render site in the Activity tab is
// untouched.
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
import { Tabs, type TabItem } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { DueRecurringWidget } from "@/components/budget/due-recurring-widget";
import { BudgetOnboarding } from "@/components/budget/budget-onboarding";
import { CategoryManager, type CategoryRow } from "@/components/budget/category-manager";
import type { RecurringTemplateListRow } from "@/components/budget/recurring-templates-panel";
import type { MemberOption } from "@/components/budget/transaction-dialog";
import type { ExpectedRecurringExpense, SafeToSpendStatus } from "@/lib/safe-to-spend-calc";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

type Tab = "fixed" | "overview" | "costAnalyzer" | "balances";

export function BudgetTabs({
  dict,
  locale,
  categories,
  safeToSpendAmount,
  safeToSpendStatus,
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
  safeToSpendStatus: SafeToSpendStatus;
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

  const tabItems: TabItem<Tab>[] = [
    { value: "fixed", label: dict.tabFixed },
    { value: "overview", label: dict.tabOverview },
    { value: "costAnalyzer", label: dict.tabCostAnalyzer },
  ];
  if (balances) {
    tabItems.push({ value: "balances", label: dict.tabBalances });
  }

  return (
    <div className="flex flex-col gap-6">
      {hasCategories ? (
        <>
          <SafeToSpend
            amount={safeToSpendAmount}
            status={safeToSpendStatus}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={tabItems} value={tab} onChange={setTab} />
        <Dialog>
          <DialogTrigger
            render={
              <Button type="button" variant="ghost" size="sm">
                {dict.manageCategories.trigger}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dict.manageCategories.dialogTitle}</DialogTitle>
            </DialogHeader>
            <CategoryManager categories={categories} dict={dict} />
          </DialogContent>
        </Dialog>
      </div>

      <div hidden={tab !== "fixed"}>{fixed}</div>
      <div hidden={tab !== "overview"}>{overview}</div>
      <div hidden={tab !== "costAnalyzer"}>{costAnalyzer}</div>
      {balances && <div hidden={tab !== "balances"}>{balances}</div>}
    </div>
  );
}
