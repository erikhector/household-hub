"use client";

import { useActionState, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTransactionAction, updateTransactionAction } from "@/app/dashboard/budget/actions";
import { evenSplitAmounts } from "@/components/budget/split-amounts";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { CategoryRow } from "@/components/budget/category-manager";

export type RecurrenceFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

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
  members: MemberOption[],
): Record<string, string> {
  if (transaction && transaction.splits.length > 0) {
    const byMember = new Map(transaction.splits.map((s) => [s.householdMemberId, s.amountOwed]));
    return Object.fromEntries(members.map((m) => [m.id, (byMember.get(m.id) ?? 0).toFixed(2)]));
  }
  const even = evenSplitAmounts(transaction?.amount ?? 0, members.length);
  return Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)]));
}

function toDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
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
};

export function TransactionDialog({
  dict,
  categories,
  members,
  currentMemberId,
  trigger,
  transaction,
  prefillFromTemplate,
}: {
  dict: Dictionary["budget"];
  categories: CategoryRow[];
  /** Every member of the active household — the split UI is only offered
   * (and rendered) when there's more than one, per the feature's scope
   * ("for households with more than one member"). */
  members: MemberOption[];
  /** The signed-in user's own household member id, used to default "paid
   * by" to themselves. */
  currentMemberId: string;
  trigger: ReactElement;
  transaction?: TransactionRow;
  prefillFromTemplate?: TransactionTemplatePrefill;
}) {
  const isEdit = !!transaction;
  const canSplit = members.length > 1;
  const [open, setOpen] = useState(false);
  const [isRecurring, setIsRecurring] = useState(
    transaction?.isRecurring ?? !!prefillFromTemplate,
  );
  const [amount, setAmount] = useState(
    transaction ? String(transaction.amount) : prefillFromTemplate ? String(prefillFromTemplate.amount) : "",
  );
  const [splitEnabled, setSplitEnabled] = useState(canSplit && !!transaction && transaction.splits.length > 0);
  const [paidByMemberId, setPaidByMemberId] = useState(
    transaction?.paidByMemberId ?? currentMemberId,
  );
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(() =>
    buildInitialSplitAmounts(transaction, members),
  );
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const action = isEdit ? updateTransactionAction : createTransactionAction;
    const result = await action(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  function resetForTransaction() {
    setIsRecurring(transaction?.isRecurring ?? !!prefillFromTemplate);
    setAmount(
      transaction ? String(transaction.amount) : prefillFromTemplate ? String(prefillFromTemplate.amount) : "",
    );
    setSplitEnabled(canSplit && !!transaction && transaction.splits.length > 0);
    setPaidByMemberId(transaction?.paidByMemberId ?? currentMemberId);
    setSplitAmounts(buildInitialSplitAmounts(transaction, members));
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
            <Select
              name="categoryId"
              defaultValue={transaction?.categoryId ?? prefillFromTemplate?.categoryId}
            >
              <SelectTrigger id="tx-category" className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v ? (categories.find((c) => c.id === v)?.name ?? v) : dict.categoryPlaceholder
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                defaultValue={toDateInputValue(transaction?.date ?? new Date())}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tx-description">{dict.descriptionLabel}</Label>
            <Input
              id="tx-description"
              name="description"
              placeholder={dict.descriptionPlaceholder}
              defaultValue={transaction?.description ?? prefillFromTemplate?.description ?? ""}
            />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="isRecurring"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="size-4"
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
                <input
                  type="checkbox"
                  name="splitEnabled"
                  checked={splitEnabled}
                  onChange={(e) => setSplitEnabled(e.target.checked)}
                  className="size-4"
                />
                {dict.split.toggleLabel}
              </label>
              {splitEnabled && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="tx-paid-by">{dict.split.paidByLabel}</Label>
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
                    <Label>{dict.split.sharesLabel}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => resetToEvenSplit(amount)}
                    >
                      {dict.split.splitEvenlyButton}
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
                        />
                      </div>
                    ))}
                  </div>
                  {splitMismatch && (
                    <p className="text-xs text-destructive">
                      {format(dict.split.mismatchWarning, {
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
