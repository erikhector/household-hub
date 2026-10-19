"use client";

import { useActionState, useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxTrigger,
  createComboboxItems,
} from "@/components/ui/combobox";
import { evenSplitAmounts } from "@/components/budget/split-amounts";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { MemberOption } from "@/components/budget/transaction-dialog";
import type { PlannedExpenseRow } from "@/components/budget/planned-expenses-panel";
import { PendingLabel } from "@/components/ui/pending-label";

// createPlannedExpenseAction / updatePlannedExpenseAction
// (src/app/dashboard/budget/planned-expense-actions.ts), or the personal
// budget's createPersonalPlannedExpenseAction /
// updatePersonalPlannedExpenseAction
// (src/app/dashboard/personal-budget/planned-expense-actions.ts).
export type PlannedExpenseFormAction = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

const initialState: ActionState = {};

/** Today as the date input's YYYY-MM-DD, in the viewer's own time zone —
 * toISOString() alone would give yesterday's date before 01:00/02:00 in
 * Sweden. */
function todayInputValue(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** A saved due date back into the date input. Due dates are calendar days
 * stored at UTC noon (planned-expense-actions.ts's parseDueDate), so the UTC
 * date is the day the user picked, in any time zone. */
function dueDateInputValue(dueDate: Date): string {
  return dueDate.toISOString().slice(0, 10);
}

function buildInitialSplitAmounts(
  bill: PlannedExpenseRow | undefined,
  members: MemberOption[],
): Record<string, string> {
  if (bill && bill.splits.length > 0) {
    const byMember = new Map(bill.splits.map((s) => [s.householdMemberId, s.amountOwed]));
    return Object.fromEntries(members.map((m) => [m.id, (byMember.get(m.id) ?? 0).toFixed(2)]));
  }
  const even = evenSplitAmounts(bill?.amount ?? 0, members.length);
  return Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)]));
}

// Add or edit a planned bill (BUDGET-8). Modelled on RecurringTemplateDialog,
// including its share-only split section: nothing is paid yet, so there's no
// "Paid" column (SplitEditor's) to fill in. Who paid is recorded later, on
// the transaction "Log payment" creates. Serves the personal budget too,
// where `members` is empty, so the split section never shows.
export function PlannedExpenseDialog({
  dict,
  categories,
  members,
  trigger,
  bill,
  createAction,
  updateAction,
  numberFormat,
}: {
  /** dict.budget or dict.personalBudget. */
  dict: BudgetDict;
  /** Expense categories only — the actions reject any other type. */
  categories: CategoryRow[];
  /** Every member of the household; the split section only shows with more
   * than one, like RecurringTemplateDialog's. */
  members: MemberOption[];
  trigger: ReactElement;
  bill?: PlannedExpenseRow;
  createAction: PlannedExpenseFormAction;
  updateAction: PlannedExpenseFormAction;
  /** createMoneyFormat(locale, currencyCode), for the split mismatch line. */
  numberFormat: Intl.NumberFormat;
}) {
  const t = dict.planned;
  const isEdit = !!bill;
  const canSplit = members.length > 1;
  const [open, setOpen] = useState(false);
  const categoryItems = useMemo(
    () =>
      createComboboxItems(categories, {
        getValue: (c: CategoryRow) => c.id,
        getLabel: (c: CategoryRow) => c.name,
      }),
    [categories],
  );
  const [amount, setAmount] = useState(bill ? String(bill.amount) : "");
  const [dueDate, setDueDate] = useState(() => (bill ? dueDateInputValue(bill.dueDate) : todayInputValue()));
  const [splitEnabled, setSplitEnabled] = useState(canSplit && !!bill && bill.splits.length > 0);
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(() =>
    buildInitialSplitAmounts(bill, members),
  );
  // Until the user edits a share, the shares follow the amount (an even
  // split of it), so ticking "Split this bill" before typing the amount
  // doesn't leave every share at 0.
  const [sharesTouched, setSharesTouched] = useState(false);
  // UX-13: name and category are the uncontrolled fields, so they're the
  // ones a save the server turns down would otherwise wipe (the rest are
  // controlled and survive the form reset on their own).
  const kept = useKeptFormValues(["name", "categoryId"]);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const action = isEdit ? updateAction : createAction;
    const result = await action(prevState, formData);
    if (!result.error) {
      setOpen(false);
      toast.success(format(t.savedToast, { name: String(formData.get("name") ?? "") }));
    }
    return result;
  }, initialState);

  function evenShares(total: string) {
    const even = evenSplitAmounts(Number(total) || 0, members.length);
    return Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)]));
  }

  // The "Add planned bill" dialog is one instance reused across opens, so
  // its controlled fields are reset on every open (RecurringTemplateDialog's
  // resetForTemplate does the same).
  function resetForBill() {
    setAmount(bill ? String(bill.amount) : "");
    setDueDate(bill ? dueDateInputValue(bill.dueDate) : todayInputValue());
    setSplitEnabled(canSplit && !!bill && bill.splits.length > 0);
    setSplitAmounts(buildInitialSplitAmounts(bill, members));
    setSharesTouched(!!bill && bill.splits.length > 0);
    kept.reset();
  }

  function handleAmountChange(next: string) {
    setAmount(next);
    if (!sharesTouched) setSplitAmounts(evenShares(next));
  }

  const splitTotal = Object.values(splitAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  // 0.01: the server's SPLIT_SUM_TOLERANCE (src/lib/share-split-form.ts),
  // which can't be imported here since that module loads Prisma.
  const splitMismatch = splitEnabled && Math.abs(splitTotal - (Number(amount) || 0)) > 0.01;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForBill();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editDialogTitle : t.addDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} onSubmit={kept.onSubmit} className="flex flex-col gap-4">
          {isEdit && <input type="hidden" name="id" value={bill.id} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="pe-name">{t.nameLabel}</Label>
            <Input
              enterKeyHint="done"
              id="pe-name"
              name="name"
              required
              maxLength={100}
              autoComplete="off"
              placeholder={t.namePlaceholder}
              defaultValue={kept.values.name ?? bill?.name}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pe-category">{t.categoryLabel}</Label>
            <Combobox
              items={categoryItems}
              name="categoryId"
              defaultValue={kept.values.categoryId ?? bill?.categoryId}
            >
              <ComboboxInputGroup>
                <ComboboxInput id="pe-category" placeholder={dict.categoryPlaceholder} />
                <ComboboxTrigger aria-label={dict.categoryToggleLabel} />
              </ComboboxInputGroup>
              <ComboboxContent emptyMessage={dict.categoryNoResults}>
                {(c: CategoryRow) => (
                  <ComboboxItem key={c.id} value={c.id}>
                    {c.name}
                  </ComboboxItem>
                )}
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pe-amount">{t.amountLabel}</Label>
              <Input
                id="pe-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="any"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pe-due-date">{t.dueDateLabel}</Label>
              <Input
                id="pe-due-date"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          </div>
          {canSplit && (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  name="splitEnabled"
                  checked={splitEnabled}
                  onChange={(e) => setSplitEnabled(e.target.checked)}
                />
                {t.splitLabel}
              </label>
              {splitEnabled && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label>{t.sharesLabel}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setSplitAmounts(evenShares(amount));
                        setSharesTouched(false);
                      }}
                    >
                      {t.splitEvenly}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center gap-2">
                        <input type="hidden" name="splitMemberId" value={m.id} />
                        <span className="min-w-0 flex-1 truncate text-sm" title={m.displayName}>
                          {m.displayName}
                        </span>
                        <Input
                          name="splitAmount"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          className="w-24 shrink-0"
                          value={splitAmounts[m.id] ?? "0"}
                          onChange={(e) => {
                            setSplitAmounts((prev) => ({ ...prev, [m.id]: e.target.value }));
                            setSharesTouched(true);
                          }}
                          aria-label={t.shareAriaLabel && format(t.shareAriaLabel, { name: m.displayName })}
                        />
                      </div>
                    ))}
                  </div>
                  {splitMismatch && t.splitMismatch && (
                    <p className="text-xs text-destructive">
                      {format(t.splitMismatch, {
                        total: numberFormat.format(splitTotal),
                        amount: numberFormat.format(Number(amount) || 0),
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || splitMismatch}>
              <PendingLabel pending={pending} busy={t.saving} idle={t.save} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
