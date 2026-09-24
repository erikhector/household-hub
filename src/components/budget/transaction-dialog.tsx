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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { evenSplitAmounts } from "@/components/budget/split-amounts";
import { parseMonthKey, toMonthKey } from "@/lib/budget-date-utils";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";

export type RecurrenceFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

// Shared by both createTransactionAction/updateTransactionAction (household)
// and createPersonalTransactionAction/updatePersonalTransactionAction
// (personal) — injected as props (BUDGET-2) rather than imported directly,
// since the two Prisma model families stay separate by design (see
// docs/archive/PERSONAL_BUDGET_UNIFICATION.md §1).
export type TransactionFormAction = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export type MemberOption = { id: string; displayName: string };

export type TransactionSplitRow = { householdMemberId: string; amountOwed: number };

export type TransactionRow = {
  id: string;
  categoryId: string;
  amount: number;
  description: string | null;
  date: Date;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency | null;
  paidByMemberId: string | null;
  splits: TransactionSplitRow[];
};

const initialState: ActionState = {};

function buildInitialSplitAmounts(
  transaction: TransactionRow | undefined,
  prefillFromTemplate: TransactionTemplatePrefill | undefined,
  members: MemberOption[],
): Record<string, string> {
  // Editing an existing transaction's own split wins; otherwise fall back to
  // the recurring template's saved split (F2 — carrying it forward instead
  // of silently dropping it), then an even split of whatever amount is known.
  const splits = transaction && transaction.splits.length > 0 ? transaction.splits : prefillFromTemplate?.splits;
  if (splits && splits.length > 0) {
    const byMember = new Map(splits.map((s) => [s.householdMemberId, s.amountOwed]));
    return Object.fromEntries(members.map((m) => [m.id, (byMember.get(m.id) ?? 0).toFixed(2)]));
  }
  const even = evenSplitAmounts(transaction?.amount ?? prefillFromTemplate?.amount ?? 0, members.length);
  return Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)]));
}

function hasSplit(
  transaction: TransactionRow | undefined,
  prefillFromTemplate: TransactionTemplatePrefill | undefined,
): boolean {
  if (transaction) return transaction.splits.length > 0;
  return !!prefillFromTemplate?.splits && prefillFromTemplate.splits.length > 0;
}

function toDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/** A new transaction's default date (F11): today, when the budget month
 * currently being browsed is the real current month, otherwise the 1st of
 * whichever month is being viewed — so adding a transaction while looking
 * back at a past month doesn't silently date it today, outside that month.
 * `monthKey` is optional so callers that don't track a viewed month (there
 * are none left after this fix, but keeps this from being a breaking
 * signature change) still get today's date, unaffected. */
function defaultDateForMonth(monthKey: string | undefined): Date {
  const now = new Date();
  if (!monthKey || monthKey === toMonthKey(now)) return now;
  return parseMonthKey(monthKey);
}

/** Seeds a new transaction's fields from a recurring template's "Log
 * transaction" action (RecurringTemplatesPanel) — only meaningful when
 * `transaction` isn't set (never overrides editing an existing one). */
export type TransactionTemplatePrefill = {
  templateId: string;
  categoryId: string;
  amount: number;
  description?: string;
  frequency: RecurrenceFrequency;
  /** The template's saved split (RecurringTemplateSplit), when it has one —
   * carried forward as this new transaction's default split (F2) instead of
   * opening with the split checkbox unchecked and the shares lost. */
  splits?: TransactionSplitRow[];
};

export function TransactionDialog({
  dict,
  categories,
  members,
  currentMemberId,
  monthKey,
  trigger,
  transaction,
  prefillFromTemplate,
  createAction,
  updateAction,
}: {
  dict: BudgetDict;
  categories: CategoryRow[];
  /** Every member of the active household — the split UI is only offered
   * (and rendered) when there's more than one, per the feature's scope
   * ("for households with more than one member"). The personal budget page
   * always passes `[]` (BUDGET-2), which suppresses the split section the
   * same way a genuinely single-member household would. */
  members: MemberOption[];
  /** The signed-in user's own household member id, used to default "paid
   * by" to themselves. The personal budget page passes `""` — never read,
   * since `members` is always empty there too. */
  currentMemberId: string;
  /** "YYYY-MM" of the month currently being browsed (page.tsx's `?month=`) —
   * feeds a new transaction's default date (F11, see defaultDateForMonth).
   * Ignored while editing an existing transaction, which always keeps its
   * own date. */
  monthKey?: string;
  trigger: ReactElement;
  transaction?: TransactionRow;
  prefillFromTemplate?: TransactionTemplatePrefill;
  /** createTransactionAction/updateTransactionAction (household) or
   * createPersonalTransactionAction/updatePersonalTransactionAction
   * (personal) — see TransactionFormAction's doc comment. */
  createAction: TransactionFormAction;
  updateAction: TransactionFormAction;
}) {
  const isEdit = !!transaction;
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
  const [isRecurring, setIsRecurring] = useState(
    transaction?.isRecurring ?? !!prefillFromTemplate,
  );
  const [amount, setAmount] = useState(
    transaction ? String(transaction.amount) : prefillFromTemplate ? String(prefillFromTemplate.amount) : "",
  );
  const [date, setDate] = useState(() =>
    toDateInputValue(transaction?.date ?? defaultDateForMonth(monthKey)),
  );
  const [splitEnabled, setSplitEnabled] = useState(canSplit && hasSplit(transaction, prefillFromTemplate));
  const [paidByMemberId, setPaidByMemberId] = useState(
    transaction?.paidByMemberId ?? currentMemberId,
  );
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(() =>
    buildInitialSplitAmounts(transaction, prefillFromTemplate, members),
  );
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const action = isEdit ? updateAction : createAction;
    const result = await action(prevState, formData);
    if (!result.error) {
      setOpen(false);
      if (!isEdit && prefillFromTemplate) {
        toast.success(format(dict.recurring.loggedToast, { name: prefillFromTemplate.description ?? "" }));
      }
    }
    return result;
  }, initialState);

  function resetForTransaction() {
    setIsRecurring(transaction?.isRecurring ?? !!prefillFromTemplate);
    setAmount(
      transaction ? String(transaction.amount) : prefillFromTemplate ? String(prefillFromTemplate.amount) : "",
    );
    setSplitEnabled(canSplit && hasSplit(transaction, prefillFromTemplate));
    setPaidByMemberId(transaction?.paidByMemberId ?? currentMemberId);
    setSplitAmounts(buildInitialSplitAmounts(transaction, prefillFromTemplate, members));
    setDate(toDateInputValue(transaction?.date ?? defaultDateForMonth(monthKey)));
  }

  function resetToEvenSplit(total: string) {
    const even = evenSplitAmounts(Number(total) || 0, members.length);
    setSplitAmounts(Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)])));
  }

  const splitTotal = Object.values(splitAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const splitMismatch =
    splitEnabled && Math.abs(splitTotal - (Number(amount) || 0)) > 0.01;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForTransaction();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? dict.editTransactionDialogTitle : dict.addTransactionDialogTitle}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {isEdit && <input type="hidden" name="id" value={transaction.id} />}
          {!isEdit && prefillFromTemplate && (
            <input type="hidden" name="recurringTemplateId" value={prefillFromTemplate.templateId} />
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="tx-category">{dict.categoryLabel}</Label>
            <Combobox
              items={categoryItems}
              name="categoryId"
              defaultValue={transaction?.categoryId ?? prefillFromTemplate?.categoryId}
            >
              <ComboboxInputGroup>
                <ComboboxInput id="tx-category" placeholder={dict.categoryPlaceholder} />
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
              <Label htmlFor="tx-amount">{dict.amountLabel}</Label>
              <Input
                id="tx-amount"
                name="amount"
                type="number"
                min={0.01}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-date">{dict.dateLabel}</Label>
              <Input
                id="tx-date"
                name="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tx-description">{dict.descriptionLabel}</Label>
            <Input
              id="tx-description"
              name="description"
              maxLength={200}
              placeholder={dict.descriptionPlaceholder}
              defaultValue={transaction?.description ?? prefillFromTemplate?.description ?? ""}
            />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                name="isRecurring"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
              />
              {dict.recurringLabel}
            </label>
            {isRecurring && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="tx-frequency">{dict.frequencyLabel}</Label>
                <Select
                  name="recurrenceFrequency"
                  defaultValue={
                    transaction?.recurrenceFrequency ?? prefillFromTemplate?.frequency ?? "MONTHLY"
                  }
                >
                  <SelectTrigger id="tx-frequency" className="w-full">
                    <SelectValue>
                      {(v: string) =>
                        v === "WEEKLY"
                          ? dict.frequencyWeekly
                          : v === "YEARLY"
                            ? dict.frequencyYearly
                            : dict.frequencyMonthly
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKLY">{dict.frequencyWeekly}</SelectItem>
                    <SelectItem value="MONTHLY">{dict.frequencyMonthly}</SelectItem>
                    <SelectItem value="YEARLY">{dict.frequencyYearly}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {canSplit && (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  name="splitEnabled"
                  checked={splitEnabled}
                  onChange={(e) => setSplitEnabled(e.target.checked)}
                />
                {dict.split?.toggleLabel}
              </label>
              {splitEnabled && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="tx-paid-by">{dict.split?.paidByLabel}</Label>
                    <Select
                      name="paidByMemberId"
                      value={paidByMemberId}
                      onValueChange={(v) => setPaidByMemberId(String(v))}
                    >
                      <SelectTrigger id="tx-paid-by" className="w-full">
                        <SelectValue>
                          {(v: string) => members.find((m) => m.id === v)?.displayName ?? v}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>{dict.split?.sharesLabel}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => resetToEvenSplit(amount)}
                    >
                      {dict.split?.splitEvenlyButton}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center gap-2">
                        <input type="hidden" name="splitMemberId" value={m.id} />
                        <span className="min-w-0 flex-1 truncate text-sm">{m.displayName}</span>
                        <Input
                          name="splitAmount"
                          type="number"
                          min={0}
                          step="any"
                          className="w-24 shrink-0"
                          value={splitAmounts[m.id] ?? "0"}
                          onChange={(e) =>
                            setSplitAmounts((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          aria-label={format(dict.split?.amountAriaLabel ?? "", { name: m.displayName })}
                        />
                      </div>
                    ))}
                  </div>
                  {splitMismatch && (
                    <p className="text-xs text-destructive">
                      {format(dict.split?.mismatchWarning ?? "", {
                        total: splitTotal.toFixed(2),
                        amount: (Number(amount) || 0).toFixed(2),
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || splitMismatch}>
              {pending ? dict.saving : isEdit ? dict.save : dict.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
