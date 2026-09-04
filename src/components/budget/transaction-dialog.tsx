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
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { CategoryRow } from "@/components/budget/category-manager";

export type RecurrenceFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export type TransactionRow = {
  id: string;
  categoryId: string;
  amount: number;
  description: string | null;
  date: Date;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency | null;
};

const initialState: ActionState = {};

function toDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function TransactionDialog({
  dict,
  categories,
  trigger,
  transaction,
}: {
  dict: Dictionary["budget"];
  categories: CategoryRow[];
  trigger: ReactElement;
  transaction?: TransactionRow;
}) {
  const isEdit = !!transaction;
  const [open, setOpen] = useState(false);
  const [isRecurring, setIsRecurring] = useState(transaction?.isRecurring ?? false);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const action = isEdit ? updateTransactionAction : createTransactionAction;
    const result = await action(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setIsRecurring(transaction?.isRecurring ?? false);
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="tx-category">{dict.categoryLabel}</Label>
            <Select name="categoryId" defaultValue={transaction?.categoryId}>
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
                defaultValue={transaction?.amount}
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
              defaultValue={transaction?.description ?? ""}
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
                  defaultValue={transaction?.recurrenceFrequency ?? "MONTHLY"}
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
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? dict.saving : isEdit ? dict.save : dict.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
