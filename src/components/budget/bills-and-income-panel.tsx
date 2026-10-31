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
// The dialogs open from the menu through dialog handles (a dialog rendered
// inside the menu would unmount as it closes), and hand focus back to the Add
// button when they close. They used to open by clicking hidden aria-hidden
// buttons, which is where focus then landed: nowhere a keyboard or screen
// reader user could carry on from.
//
// With no category there is nothing to plan in, so Add is disabled and the
// card says why in place of its empty text, pointing at the Categories card
// below it. Without an expense (or income) category the menu's one-off bill
// (or income) item stays in the menu, disabled, with that reason under it:
// the menu then offers the same three choices every time, and the missing
// one explains itself instead of silently not being there.

import { useRef, useState } from "react";
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
import { createDialogHandle } from "@/components/ui/dialog";
import { openLazyDialog } from "@/components/ui/lazy-dialog";
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
  const addRef = useRef<HTMLButtonElement | null>(null);
  const [repeatsHandle] = useState(() => createDialogHandle());
  const [billHandle] = useState(() => createDialogHandle());
  const [incomeHandle] = useState(() => createDialogHandle());
  const expenseCategories = categories.filter((c) => c.type === "EXPENSE");
  const incomeCategories = categories.filter((c) => c.type === "INCOME");
  const hasRepeating = templates.length + pausedTemplates.length > 0;
  const needsCategory = categories.length === 0;

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
              <Button
                ref={addRef}
                variant="secondary"
                size="sm"
                disabled={needsCategory}
                aria-describedby={needsCategory ? "bills-and-income-needs-category" : undefined}
              >
                <Plus className="size-4" />
                {t.add}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem onClick={() => openLazyDialog(repeatsHandle)}>{t.addRepeating}</DropdownMenuItem>
            <AddMenuItem
              label={t.addOneOffBill}
              reason={expenseCategories.length === 0 ? t.needsExpenseCategory : null}
              onClick={() => openLazyDialog(billHandle)}
            />
            <AddMenuItem
              label={t.addOneOffIncome}
              reason={incomeCategories.length === 0 ? t.needsIncomeCategory : null}
              onClick={() => openLazyDialog(incomeHandle)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <LazyRecurringTemplateDialog
          numberFormat={numberFormat}
          dict={dict}
          categories={categories}
          members={members}
          createAction={createTemplateAction}
          updateAction={updateTemplateAction}
          handle={repeatsHandle}
          finalFocus={addRef}
        />
        <LazyPlannedExpenseDialog
          dict={dict}
          kind="EXPENSE"
          categories={expenseCategories}
          members={members}
          createAction={createPlannedAction}
          updateAction={updatePlannedAction}
          numberFormat={numberFormat}
          handle={billHandle}
          finalFocus={addRef}
        />
        <LazyPlannedExpenseDialog
          dict={dict}
          kind="INCOME"
          categories={incomeCategories}
          members={[]}
          createAction={createPlannedAction}
          updateAction={updatePlannedAction}
          numberFormat={numberFormat}
          handle={incomeHandle}
          finalFocus={addRef}
        />
      </div>

      {needsCategory && (
        <p id="bills-and-income-needs-category" className="text-sm text-muted-foreground">
          {t.needsCategory}
        </p>
      )}
      {!hasRepeating && plannedRows.length === 0 ? (
        !needsCategory && <p className="text-sm text-muted-foreground">{t.empty}</p>
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

// A one-off item of the Add menu, disabled with its reason under it while
// there's no category of its kind. The item's own data-disabled dimming is
// switched off so the reason stays readable (muted text at 50% opacity fails
// contrast); the label alone is muted instead.
function AddMenuItem({
  label,
  reason,
  onClick,
}: {
  label: string;
  reason: string | null;
  onClick: () => void;
}) {
  if (!reason) return <DropdownMenuItem onClick={onClick}>{label}</DropdownMenuItem>;
  return (
    <DropdownMenuItem disabled className="flex-col items-start gap-0.5 py-1.5 data-disabled:opacity-100">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-60 text-xs whitespace-normal text-muted-foreground">{reason}</span>
    </DropdownMenuItem>
  );
}
