"use client";

// The Setup tab's "Bills & income" card (budget redesign, Oct 2026): every
// amount a budget expects — rent and salary every month, the car service
// once in November — in one card with one Add button. It replaces three
// panels (Recurring items, Planned bills, Planned income) that each had a
// heading, a long subtitle and an Add button of their own, which asked people
// to know the app's three kinds of planned money before they could add one.
//
// The data model is unchanged: a repeating amount is still a
// RecurringTemplate and a one-off one a PlannedExpense. Add asks which (a
// menu: repeats, one-off bill, one-off income) and opens the existing dialog
// for it. Both lists stay their own components, RecurringTemplateList and
// PlannedItemList, under a sub-heading each.
//
// The dialogs open from the menu through hidden triggers (TemplateRow's
// pattern): a dialog rendered inside the menu would unmount as it closes.

import { useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecurringTemplateFormAction } from "@/components/budget/recurring-template-dialog";
import type { PlannedExpenseFormAction } from "@/components/budget/planned-expense-dialog";
import type { MemberOption, TransactionFormAction } from "@/components/budget/transaction-dialog";
import {
  RecurringTemplateList,
  type PausedRecurringTemplateRow,
  type RecurringTemplateListRow,
} from "@/components/budget/recurring-templates-panel";
import { PlannedItemList, type PlannedExpenseRow } from "@/components/budget/planned-expenses-panel";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { LazyPlannedExpenseDialog, LazyRecurringTemplateDialog } from "@/components/budget/lazy-budget-dialogs";

export function BillsAndIncomePanel({
  templates,
  pausedTemplates,
  plannedRows,
  categories,
  members = [],
  currentMemberId = "",
  monthKey,
  dict,
  locale,
  currencyCode,
  onTogglePause,
  onDeleteTemplate,
  onAcknowledge,
  onUnacknowledge,
  createTemplateAction,
  updateTemplateAction,
  createPlannedAction,
  updatePlannedAction,
  onDeletePlanned,
  createTransactionAction,
  updateTransactionAction,
}: {
  templates: RecurringTemplateListRow[];
  pausedTemplates: PausedRecurringTemplateRow[];
  /** Planned bills and planned income together. */
  plannedRows: PlannedExpenseRow[];
  categories: CategoryRow[];
  /** Every household member; omitted on the personal budget. */
  members?: MemberOption[];
  currentMemberId?: string;
  /** "YYYY-MM" being viewed, for a payment's default date (F11). */
  monthKey: string;
  /** dict.budget or dict.personalBudget. */
  dict: BudgetDict;
  locale: Locale;
  currencyCode?: string | null;
  onTogglePause: (id: string, active: boolean) => Promise<ActionState>;
  onDeleteTemplate: (id: string) => Promise<ActionState>;
  onAcknowledge: (id: string) => Promise<ActionState>;
  onUnacknowledge: (id: string) => Promise<ActionState>;
  createTemplateAction: RecurringTemplateFormAction;
  updateTemplateAction: RecurringTemplateFormAction;
  createPlannedAction: PlannedExpenseFormAction;
  updatePlannedAction: PlannedExpenseFormAction;
  onDeletePlanned: (id: string) => Promise<ActionState>;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  const t = dict.billsAndIncome;
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const repeatsRef = useRef<HTMLButtonElement | null>(null);
  const billRef = useRef<HTMLButtonElement | null>(null);
  const incomeRef = useRef<HTMLButtonElement | null>(null);
  const expenseCategories = categories.filter((c) => c.type === "EXPENSE");
  const incomeCategories = categories.filter((c) => c.type === "INCOME");
  const hasRepeating = templates.length + pausedTemplates.length > 0;

  return (
    <section
      aria-labelledby="bills-and-income-title"
      className="list-bleed flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      {/* UX-118: Add sits top right, as in the category manager. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="bills-and-income-title" className="font-heading text-base font-semibold">
            {t.title}
          </h2>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="secondary" size="sm" disabled={categories.length === 0}>
                <Plus className="size-4" />
                {t.add}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem onClick={() => repeatsRef.current?.click()}>{t.addRepeating}</DropdownMenuItem>
            <DropdownMenuItem
              disabled={expenseCategories.length === 0}
              onClick={() => billRef.current?.click()}
            >
              {t.addOneOffBill}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={incomeCategories.length === 0}
              onClick={() => incomeRef.current?.click()}
            >
              {t.addOneOffIncome}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <LazyRecurringTemplateDialog
          numberFormat={numberFormat}
          dict={dict}
          categories={categories}
          members={members}
          createAction={createTemplateAction}
          updateAction={updateTemplateAction}
          // Opened from the Add menu; not a target of its own.
          trigger={<button ref={repeatsRef} type="button" className="sr-only" tabIndex={-1} aria-hidden="true" />}
        />
        <LazyPlannedExpenseDialog
          dict={dict}
          kind="EXPENSE"
          categories={expenseCategories}
          members={members}
          createAction={createPlannedAction}
          updateAction={updatePlannedAction}
          numberFormat={numberFormat}
          trigger={<button ref={billRef} type="button" className="sr-only" tabIndex={-1} aria-hidden="true" />}
        />
        <LazyPlannedExpenseDialog
          dict={dict}
          kind="INCOME"
          categories={incomeCategories}
          members={[]}
          createAction={createPlannedAction}
          updateAction={updatePlannedAction}
          numberFormat={numberFormat}
          trigger={<button ref={incomeRef} type="button" className="sr-only" tabIndex={-1} aria-hidden="true" />}
        />
      </div>

      {!hasRepeating && plannedRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <>
          {hasRepeating && (
            <section aria-labelledby="bills-repeating-title" className="flex flex-col gap-2">
              <h3 id="bills-repeating-title" className="text-xs font-medium text-muted-foreground">
                {t.repeatingTitle}
              </h3>
              <RecurringTemplateList
                templates={templates}
                pausedTemplates={pausedTemplates}
                categories={categories}
                members={members}
                dict={dict}
                locale={locale}
                currencyCode={currencyCode}
                onTogglePause={onTogglePause}
                onDelete={onDeleteTemplate}
                onAcknowledge={onAcknowledge}
                onUnacknowledge={onUnacknowledge}
                createTemplateAction={createTemplateAction}
                updateTemplateAction={updateTemplateAction}
              />
            </section>
          )}
          {plannedRows.length > 0 && (
            <section aria-labelledby="bills-once-title" className="flex flex-col gap-2">
              <h3 id="bills-once-title" className="text-xs font-medium text-muted-foreground">
                {t.onceTitle}
              </h3>
              <PlannedItemList
                rows={plannedRows}
                categories={categories}
                members={members}
                currentMemberId={currentMemberId}
                monthKey={monthKey}
                dict={dict}
                locale={locale}
                currencyCode={currencyCode}
                createAction={createPlannedAction}
                updateAction={updatePlannedAction}
                onDelete={onDeletePlanned}
                createTransactionAction={createTransactionAction}
                updateTransactionAction={updateTransactionAction}
              />
            </section>
          )}
        </>
      )}
    </section>
  );
}
