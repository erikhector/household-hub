"use client";

import { useActionState, useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { checkSplitForm, evenSplitAmounts } from "@/components/budget/split-amounts";
import { SplitEditor } from "@/components/budget/split-editor";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import { parseMonthKey, toMonthKey } from "@/lib/budget-date-utils";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import { PendingLabel } from "@/components/ui/pending-label";

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

export type TransactionSplitRow = {
  householdMemberId: string;
  amountOwed: number;
  /** What this member has paid towards the bill (TransactionSplit.amountPaid).
   * Optional because a recurring template's saved split (the other user of
   * this type, via TransactionTemplatePrefill) has shares but no payments. */
  amountPaid?: number;
};

export type TransactionRow = {
  id: string;
  categoryId: string;
  amount: number;
  description: string | null;
  date: Date;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency | null;
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

/** Who has paid what so far. Editing keeps the saved payments; a new split
 * defaults to the signed-in member paying the whole amount — the same
 * default the old single "Paid by" select had — and the user lowers it (or
 * adds another member's payment) when the bill was paid partly. */
function buildInitialPaidAmounts(
  transaction: TransactionRow | undefined,
  amount: string,
  members: MemberOption[],
  currentMemberId: string,
): Record<string, string> {
  if (transaction && transaction.splits.length > 0) {
    const byMember = new Map(transaction.splits.map((s) => [s.householdMemberId, s.amountPaid ?? 0]));
    return Object.fromEntries(members.map((m) => [m.id, (byMember.get(m.id) ?? 0).toFixed(2)]));
  }
  return Object.fromEntries(
    members.map((m) => [m.id, m.id === currentMemberId ? amount || "0" : "0"]),
  );
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
  onDelete,
  numberFormat,
}: {
  dict: BudgetDict;
  categories: CategoryRow[];
  /** Every member of the active household — the split UI is only offered
   * (and rendered) when there's more than one, per the feature's scope
   * ("for households with more than one member"). The personal budget page
   * always passes `[]` (BUDGET-2), which suppresses the split section the
   * same way a genuinely single-member household would. */
  members: MemberOption[];
  /** The signed-in user's own household member id, used to default a new
   * split's payment to themselves. The personal budget page passes `""` — never read,
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
  /** Editing only: deletes `transaction` (the page's delete action, bound
   * to its id). Shown as "Delete transaction" at the end of the form —
   * on phones the row itself opens this sheet, so this is the row's named
   * Delete (the swipe is the quick path, DESIGN.md M7). */
  onDelete?: () => Promise<ActionState>;
  /** The caller's createMoneyFormat(locale, currencyCode) — only read by
   * SplitEditor's warnings (UX-15). */
  numberFormat: Intl.NumberFormat;
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
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(() =>
    buildInitialSplitAmounts(transaction, prefillFromTemplate, members),
  );
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>(() =>
    buildInitialPaidAmounts(transaction, amount, members, currentMemberId),
  );
  // Until the user edits a payment, a new split's "paid" column follows the
  // amount field (see buildInitialPaidAmounts), so typing the amount after
  // ticking "Split this expense" doesn't leave a stale 0 behind.
  const [paidTouched, setPaidTouched] = useState(false);
  // UX-13: the description is the dialog's only uncontrolled text field,
  // so it's the one a failed save would otherwise wipe.
  const kept = useKeptFormValues(["description"]);
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
    setSplitAmounts(buildInitialSplitAmounts(transaction, prefillFromTemplate, members));
    setPaidAmounts(
      buildInitialPaidAmounts(
        transaction,
        transaction ? String(transaction.amount) : prefillFromTemplate ? String(prefillFromTemplate.amount) : "",
        members,
        currentMemberId,
      ),
    );
    setPaidTouched(false);
    kept.reset();
    setDate(toDateInputValue(transaction?.date ?? defaultDateForMonth(monthKey)));
  }

  function resetToEvenSplit(total: string) {
    const even = evenSplitAmounts(Number(total) || 0, members.length);
    setSplitAmounts(Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)])));
  }

  const splitCheck = checkSplitForm(amount, splitAmounts, paidAmounts);
  const splitInvalid = splitEnabled && (splitCheck.shareMismatch || splitCheck.overpaid);

  function handleAmountChange(next: string) {
    setAmount(next);
    if (!isEdit && !paidTouched) {
      setPaidAmounts(buildInitialPaidAmounts(undefined, next, members, currentMemberId));
    }
  }

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
        <form action={formAction} onSubmit={kept.onSubmit} className="flex flex-col gap-4">
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
                inputMode="decimal"
                min={0.01}
                step="any"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
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
              enterKeyHint="done"
              id="tx-description"
              name="description"
              maxLength={200}
              placeholder={dict.descriptionPlaceholder}
              defaultValue={kept.values.description ?? transaction?.description ?? prefillFromTemplate?.description ?? ""}
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
              {splitEnabled && dict.split && (
                <SplitEditor
                  members={members}
                  amount={amount}
                  shares={splitAmounts}
                  paid={paidAmounts}
                  onSharesChange={setSplitAmounts}
                  onPaidChange={(next) => {
                    setPaidAmounts(next);
                    setPaidTouched(true);
                  }}
                  onSplitEvenly={() => resetToEvenSplit(amount)}
                  numberFormat={numberFormat}
                  dict={dict.split}
                />
              )}
            </div>
          )}
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {/* In the form body rather than the footer, so it sits a whole
              footer away from Save (DESIGN.md M2) instead of beside it. */}
          {isEdit && onDelete && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" className="self-start text-destructive hover:text-destructive">
                  <Trash2 className="size-4" />
                  {dict.deleteAriaLabel}
                </Button>
              }
              title={dict.confirmDeleteTransaction.title}
              description={dict.confirmDeleteTransaction.description}
              cancelLabel={dict.confirmDeleteTransaction.cancel}
              confirmLabel={dict.confirmDeleteTransaction.confirm}
              pendingLabel={dict.confirmDeleteTransaction.confirming}
              onConfirm={async () => {
                const result = await onDelete();
                if (!result.error) setOpen(false);
                return result;
              }}
            />
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || splitInvalid}>
              <PendingLabel pending={pending} busy={dict.saving} idle={isEdit ? dict.save : dict.add} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
