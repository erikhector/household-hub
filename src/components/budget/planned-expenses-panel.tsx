"use client";

import { toast } from "sonner";
import { AlertCircle, Check, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  PlannedExpenseFormAction,
} from "@/components/budget/planned-expense-dialog";
import type {
  MemberOption,
  TransactionFormAction,
} from "@/components/budget/transaction-dialog";
import { format, plural } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Locale } from "@/lib/i18n/get-dictionary";
import { plannedTexts, type BudgetDict, type PlannedDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { PlannedExpenseStatus, PlannedItemType } from "@/lib/planned-expense-calc";
import { createMoneyFormat } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { LazyTransactionDialog, LazyPlannedExpenseDialog } from "@/components/budget/lazy-budget-dialogs";

export type PlannedExpenseRow = {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  categoryId: string;
  categoryName: string;
  /** Its category's type: a bill, or planned income (a bonus, a refund). */
  type: PlannedItemType;
  status: PlannedExpenseStatus;
  /** Date of the linked payment, or null while none is linked. Set even
   * when that payment falls after the viewed month, where `status` is still
   * "due"/"overdue" (past months stay historical): such a bill can't take a
   * second payment, and deleting it would silently detach the one it has,
   * so Log payment and Delete go by this rather than by `status`. */
  paidAt: Date | null;
  splits: { householdMemberId: string; amountOwed: number }[];
};

// Most urgent first: what's late, then what's due in the viewed month, then
// what's coming, then what's settled (paid in the viewed month only — see
// the page's query).
const STATUS_ORDER: PlannedExpenseStatus[] = ["overdue", "due", "upcoming", "paid"];

// Status chip per row (the overdue state already has its own icon and words
// in the amount line, so it gets no chip). Planned income has its own words
// ("Expected", "Received"), from plannedTexts.
const STATUS_BADGE = {
  due: { variant: "warning", label: "groupDue" },
  upcoming: { variant: "secondary", label: "groupUpcoming" },
  paid: { variant: "outline", label: "groupPaid" },
} as const satisfies Record<
  Exclude<PlannedExpenseStatus, "overdue">,
  { variant: "warning" | "secondary" | "outline"; label: keyof PlannedDict }
>;

// Planned bills and planned income (BUDGET-8): the one-off half of the Setup
// tab's Bills & income card (bills-and-income-panel.tsx), which owns the
// heading and the one Add button. Serves both budgets: the personal one
// passes no members (so no split) and its own actions.
//
// Budget redesign (Oct 2026): bills and income share one list, most urgent
// first, each row's status a chip. They used to be two panels of their own,
// each with a long subtitle, an Add button and a sub-heading per status.
export function PlannedItemList({
  rows,
  categories,
  members,
  currentMemberId,
  monthKey,
  dict,
  locale,
  currencyCode,
  updateAction,
  createAction,
  onDelete,
  createTransactionAction,
  updateTransactionAction,
}: {
  /** Bills and planned income together, in any order. */
  rows: PlannedExpenseRow[];
  /** Every budget category: "Log payment" offers them all, like any
   * transaction; an item's own dialog narrows to categories of its type. */
  categories: CategoryRow[];
  /** Every household member; `[]` on the personal budget. */
  members: MemberOption[];
  currentMemberId: string;
  /** "YYYY-MM" being viewed, for the payment's default date (F11). */
  monthKey: string;
  /** dict.budget or dict.personalBudget. */
  dict: BudgetDict;
  locale: Locale;
  currencyCode?: string | null;
  createAction: PlannedExpenseFormAction;
  updateAction: PlannedExpenseFormAction;
  /** deletePlannedExpenseAction or deletePersonalPlannedExpenseAction. */
  onDelete: (id: string) => Promise<ActionState>;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // Due dates are calendar days stored at UTC noon, so they're shown in UTC:
  // the viewer's own time zone could otherwise move the day.
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const ordered = [...rows].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      a.dueDate.getTime() - b.dueDate.getTime(),
  );

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((bill) => (
        <PlannedExpenseItem
          key={bill.id}
          bill={bill}
          dict={dict}
          numberFormat={numberFormat}
          dateFormat={dateFormat}
          categories={categories}
          kindCategories={categories.filter((c) => c.type === bill.type)}
          members={members}
          // Income is never split, so it gets no members.
          splitMembers={bill.type === "INCOME" ? [] : members}
          currentMemberId={currentMemberId}
          monthKey={monthKey}
          createAction={createAction}
          updateAction={updateAction}
          onDelete={onDelete}
          createTransactionAction={createTransactionAction}
          updateTransactionAction={updateTransactionAction}
        />
      ))}
    </ul>
  );
}

function PlannedExpenseItem({
  bill,
  dict,
  numberFormat,
  dateFormat,
  categories,
  kindCategories,
  members,
  splitMembers,
  currentMemberId,
  monthKey,
  createAction,
  updateAction,
  onDelete,
  createTransactionAction,
  updateTransactionAction,
}: {
  bill: PlannedExpenseRow;
  dict: BudgetDict;
  numberFormat: Intl.NumberFormat;
  dateFormat: Intl.DateTimeFormat;
  categories: CategoryRow[];
  kindCategories: CategoryRow[];
  members: MemberOption[];
  splitMembers: MemberOption[];
  currentMemberId: string;
  monthKey: string;
  createAction: PlannedExpenseFormAction;
  updateAction: PlannedExpenseFormAction;
  onDelete: (id: string) => Promise<ActionState>;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  const t = plannedTexts(dict, bill.type);
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
          {bill.status !== "overdue" && (
            <Badge
              variant={STATUS_BADGE[bill.status].variant}
              className={bill.status === "paid" ? "border-success/30 text-success" : undefined}
            >
              {t[STATUS_BADGE[bill.status].label]}
            </Badge>
          )}
          {bill.splits.length > 0 && t.splitWays && (
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
        <LazyPlannedExpenseDialog
          dict={dict}
          kind={bill.type}
          categories={kindCategories}
          members={splitMembers}
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
        // Late income is something to look into, not money owed: attention
        // (orange) rather than destructive.
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            bill.type === "INCOME" ? "text-attention" : "text-destructive",
          )}
        >
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
    <LazyTransactionDialog
      numberFormat={numberFormat}
      dict={dict}
      categories={categories}
      members={members}
      currentMemberId={currentMemberId}
      monthKey={monthKey}
      prefillFromTemplate={{
        plannedExpenseId: bill.id,
        plannedType: bill.type,
        categoryId: bill.categoryId,
        amount: bill.amount,
        description: bill.name,
        splits: bill.splits,
        dueDate: bill.dueDate,
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
