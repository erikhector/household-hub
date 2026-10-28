"use client";

import { useId } from "react";
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
const GROUPS = [
  { status: "overdue", label: "groupOverdue" },
  { status: "due", label: "groupDue" },
  { status: "upcoming", label: "groupUpcoming" },
  { status: "paid", label: "groupPaid" },
] as const satisfies readonly { status: PlannedExpenseStatus; label: keyof PlannedDict }[];

// Planned bills (BUDGET-8) on the Manage tab, under RecurringTemplatesPanel
// and laid out like it. Serves both budgets: the personal one passes no
// members (so no split) and its own actions. Rendered twice per budget:
// once for bills and once for planned income (`kind`), each with only its
// own rows and categories. Income is never split, so it gets no members.
export function PlannedExpensesPanel({
  kind,
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
  /** Which planned items this panel lists and adds. */
  kind: PlannedItemType;
  /** Already filtered to `kind`. */
  rows: PlannedExpenseRow[];
  /** Every budget category: "Log payment" offers them all, like any
   * transaction; the item's own dialog narrows to categories of `kind`. */
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
  const t = plannedTexts(dict, kind);
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // Due dates are calendar days stored at UTC noon, so they're shown in UTC:
  // the viewer's own time zone could otherwise move the day.
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const kindCategories = categories.filter((c) => c.type === kind);
  const splitMembers = kind === "INCOME" ? [] : members;
  const idPrefix = useId();

  const rowProps = {
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
  };

  // A named region: the bills and the income panel sit on the same tab with
  // the same group names ("Upcoming"), so a screen reader (and a test) can
  // tell which one it's in.
  return (
    <section
      aria-labelledby={`${idPrefix}-title`}
      className="list-bleed flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      {/* UX-118: Add sits top right, as in the category manager, so the
          three Manage panels share one placement (on a phone too). */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${idPrefix}-title`} className="font-heading text-base font-semibold">
            {t.title}
          </h2>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <LazyPlannedExpenseDialog
          dict={dict}
          kind={kind}
          categories={kindCategories}
          members={splitMembers}
          createAction={createAction}
          updateAction={updateAction}
          numberFormat={numberFormat}
          trigger={
            <Button variant="outline" size="sm" disabled={kindCategories.length === 0}>
              {t.add}
            </Button>
          }
        />
      </div>

      {rows.length === 0 ? (
        // With no category of this kind the Add button is disabled, so say
        // what unlocks it rather than inviting a click that can't happen.
        <p className="text-sm text-muted-foreground">
          {kindCategories.length === 0 ? t.needsCategory : t.empty}
        </p>
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
    </section>
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
