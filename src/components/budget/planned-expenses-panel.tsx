"use client";

import { useId } from "react";
import { toast } from "sonner";
import { AlertCircle, Check, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PlannedExpenseDialog,
  type PlannedExpenseFormAction,
} from "@/components/budget/planned-expense-dialog";
import {
  TransactionDialog,
  type MemberOption,
  type TransactionFormAction,
} from "@/components/budget/transaction-dialog";
import { format, plural } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { PlannedExpenseStatus } from "@/lib/planned-expense-calc";
import { createMoneyFormat } from "@/lib/currency";

export type PlannedExpenseRow = {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  categoryId: string;
  categoryName: string;
  status: PlannedExpenseStatus;
  /** Date of the linked payment, or null while none is linked. Set even
   * when that payment falls after the viewed month, where `status` is still
   * "due"/"overdue" (past months stay historical): such a bill can't take a
   * second payment, and deleting it would silently detach the one it has,
   * so Log payment and Delete go by this rather than by `status`. */
  paidAt: Date | null;
  splits: { householdMemberId: string; amountOwed: number }[];
};

type PlannedDict = Dictionary["budget"]["planned"];

// Most urgent first: what's late, then what's due in the viewed month, then
// what's coming, then what's settled (paid in the viewed month only — see
// the page's query).
const GROUPS = [
  { status: "overdue", label: "groupOverdue" },
  { status: "due", label: "groupDue" },
  { status: "upcoming", label: "groupUpcoming" },
  { status: "paid", label: "groupPaid" },
] as const satisfies readonly { status: PlannedExpenseStatus; label: keyof PlannedDict }[];

// Planned bills (BUDGET-8) on the household budget's Manage tab, under
// RecurringTemplatesPanel and laid out like it. Household-only, so it takes
// the household dict itself rather than the shared BudgetDict.
export function PlannedExpensesPanel({
  rows,
  categories,
  members,
  currentMemberId,
  monthKey,
  dict,
  locale,
  currencyCode,
  createAction,
  updateAction,
  onDelete,
  createTransactionAction,
  updateTransactionAction,
}: {
  rows: PlannedExpenseRow[];
  /** Every budget category: "Log payment" offers them all, like any
   * transaction; the bill's own dialog narrows to expense categories. */
  categories: CategoryRow[];
  members: MemberOption[];
  currentMemberId: string;
  /** "YYYY-MM" being viewed, for the payment's default date (F11). */
  monthKey: string;
  dict: Dictionary["budget"];
  locale: Locale;
  currencyCode?: string | null;
  createAction: PlannedExpenseFormAction;
  updateAction: PlannedExpenseFormAction;
  /** deletePlannedExpenseAction. */
  onDelete: (id: string) => Promise<ActionState>;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  const t = dict.planned;
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // Due dates are calendar days stored at UTC noon, so they're shown in UTC:
  // the viewer's own time zone could otherwise move the day.
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const expenseCategories = categories.filter((c) => c.type === "EXPENSE");
  const idPrefix = useId();

  const rowProps = {
    dict,
    numberFormat,
    dateFormat,
    categories,
    expenseCategories,
    members,
    currentMemberId,
    monthKey,
    createAction,
    updateAction,
    onDelete,
    createTransactionAction,
    updateTransactionAction,
  };

  return (
    <div className="list-bleed flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-base font-semibold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <PlannedExpenseDialog
          dict={dict}
          categories={expenseCategories}
          members={members}
          createAction={createAction}
          updateAction={updateAction}
          numberFormat={numberFormat}
          trigger={
            <Button variant="outline" size="sm" disabled={expenseCategories.length === 0}>
              {t.add}
            </Button>
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {GROUPS.map(({ status, label }) => {
            const items = rows.filter((r) => r.status === status);
            if (items.length === 0) return null;
            const headingId = `${idPrefix}-${status}`;
            return (
              <section key={status} aria-labelledby={headingId} className="flex flex-col gap-2">
                <h3 id={headingId} className="text-xs font-medium uppercase text-muted-foreground">
                  {t[label]}
                </h3>
                <ul className="flex flex-col gap-2">
                  {items.map((bill) => (
                    <PlannedExpenseItem key={bill.id} bill={bill} {...rowProps} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlannedExpenseItem({
  bill,
  dict,
  numberFormat,
  dateFormat,
  categories,
  expenseCategories,
  members,
  currentMemberId,
  monthKey,
  createAction,
  updateAction,
  onDelete,
  createTransactionAction,
  updateTransactionAction,
}: {
  bill: PlannedExpenseRow;
  dict: Dictionary["budget"];
  numberFormat: Intl.NumberFormat;
  dateFormat: Intl.DateTimeFormat;
  categories: CategoryRow[];
  expenseCategories: CategoryRow[];
  members: MemberOption[];
  currentMemberId: string;
  monthKey: string;
  createAction: PlannedExpenseFormAction;
  updateAction: PlannedExpenseFormAction;
  onDelete: (id: string) => Promise<ActionState>;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  const t = dict.planned;
  const linked = bill.paidAt !== null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full break-words font-medium" title={bill.name}>
            {bill.name}
          </span>
          <Badge variant="secondary" className="max-w-[10rem]">
            <span className="min-w-0 truncate" title={bill.categoryName}>
              {bill.categoryName}
            </span>
          </Badge>
          {bill.splits.length > 0 && (
            <Badge variant="secondary">
              {format(plural(bill.splits.length, t.splitWays), { count: bill.splits.length })}
            </Badge>
          )}
        </div>
        <PlannedBillAmountLine
          bill={bill}
          numberFormat={numberFormat}
          dateFormat={dateFormat}
          t={t}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 max-sm:gap-2 pointer-coarse:gap-2">
        {!linked && (
          <PlannedBillLogPayment
            bill={bill}
            dict={dict}
            t={t}
            numberFormat={numberFormat}
            categories={categories}
            members={members}
            currentMemberId={currentMemberId}
            monthKey={monthKey}
            createTransactionAction={createTransactionAction}
            updateTransactionAction={updateTransactionAction}
          />
        )}
        <PlannedExpenseDialog
          dict={dict}
          categories={expenseCategories}
          members={members}
          bill={bill}
          createAction={createAction}
          updateAction={updateAction}
          numberFormat={numberFormat}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label={format(t.edit, { name: bill.name })}
            >
              <Pencil className="size-3.5" />
            </Button>
          }
        />
        {!linked && (
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                aria-label={format(t.delete, { name: bill.name })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
            title={format(t.deleteConfirm.title, { name: bill.name })}
            description={t.deleteConfirm.description}
            cancelLabel={t.deleteConfirm.cancel}
            confirmLabel={t.deleteConfirm.confirm}
            pendingLabel={t.deleteConfirm.confirming}
            onConfirm={async () => {
              // ConfirmDialog runs this in its own transition (pending
              // label, stays open and toasts on error).
              const result = await onDelete(bill.id);
              if (!result.error) toast.success(format(t.deletedToast, { name: bill.name }));
              return result;
            }}
          />
        )}
      </div>
    </li>
  );
}

// "{amount} · Due {date}", or the overdue badge in its place. Shared with the
// Budget Overview's due strip (DueRecurringWidget) so a bill reads the same in
// both places.
export function PlannedBillAmountLine({
  bill,
  numberFormat,
  dateFormat,
  t,
}: {
  bill: PlannedExpenseRow;
  numberFormat: Intl.NumberFormat;
  /** Due dates are UTC-noon calendar days: build it with `timeZone: "UTC"`. */
  dateFormat: Intl.DateTimeFormat;
  t: PlannedDict;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="tabular-nums">{numberFormat.format(bill.amount)}</span>
      {" · "}
      {bill.status === "overdue" ? (
        // DESIGN.md: status is tinted text plus an icon, never colour alone.
        <span className="inline-flex items-center gap-1 font-medium text-destructive">
          <AlertCircle className="size-3.5" aria-hidden />
          {t.overdueBadge}
          {" · "}
          {format(t.dueOn, { date: dateFormat.format(bill.dueDate) })}
        </span>
      ) : (
        format(t.dueOn, { date: dateFormat.format(bill.dueDate) })
      )}
      {/* Paid, but after the viewed month (so still counted as due here). */}
      {bill.paidAt && bill.status !== "paid" && (
        <>
          {" · "}
          <span className="inline-flex items-center gap-1 font-medium text-success">
            <Check className="size-3.5" aria-hidden />
            {format(t.paidOn, { date: dateFormat.format(bill.paidAt) })}
          </span>
        </>
      )}
    </p>
  );
}

// "Log payment": the ordinary transaction dialog, prefilled from the bill and
// linked to it so saving marks it paid. Shared with the due strip.
export function PlannedBillLogPayment({
  bill,
  dict,
  t,
  numberFormat,
  categories,
  members,
  currentMemberId,
  monthKey,
  createTransactionAction,
  updateTransactionAction,
}: {
  bill: PlannedExpenseRow;
  dict: BudgetDict;
  t: PlannedDict;
  numberFormat: Intl.NumberFormat;
  categories: CategoryRow[];
  members: MemberOption[];
  currentMemberId: string;
  monthKey: string;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  return (
    <TransactionDialog
      numberFormat={numberFormat}
      dict={dict}
      categories={categories}
      members={members}
      currentMemberId={currentMemberId}
      monthKey={monthKey}
      prefillFromTemplate={{
        plannedExpenseId: bill.id,
        categoryId: bill.categoryId,
        amount: bill.amount,
        description: bill.name,
        splits: bill.splits,
      }}
      createAction={createTransactionAction}
      updateAction={updateTransactionAction}
      trigger={
        <Button size="xs" variant="secondary">
          {t.logPayment}
        </Button>
      }
    />
  );
}
