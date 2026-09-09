"use client";

import { useActionState, useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";
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
import {
  createPersonalTransactionAction,
  updatePersonalTransactionAction,
} from "@/app/dashboard/personal-budget/actions";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";

export type PersonalRecurrenceFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export type PersonalTransactionRow = {
  id: string;
  categoryId: string;
  amount: number;
  description: string | null;
  date: Date;
  isRecurring: boolean;
  recurrenceFrequency: PersonalRecurrenceFrequency | null;
};

const initialState: ActionState = {};

function toDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/** Seeds a new transaction's fields from a recurring template's "Log
 * transaction" action (PersonalRecurringTemplatesPanel) — only meaningful
 * when `transaction` isn't set. Mirrors TransactionDialog's
 * TransactionTemplatePrefill (src/components/budget/transaction-dialog.tsx). */
export type PersonalTransactionTemplatePrefill = {
  templateId: string;
  categoryId: string;
  amount: number;
  description?: string;
  frequency: PersonalRecurrenceFrequency;
};

export function PersonalTransactionDialog({
  dict,
  categories,
  trigger,
  transaction,
  prefillFromTemplate,
}: {
  dict: Dictionary["personalBudget"];
  categories: PersonalCategoryRow[];
  trigger: ReactElement;
  transaction?: PersonalTransactionRow;
  prefillFromTemplate?: PersonalTransactionTemplatePrefill;
}) {
  const isEdit = !!transaction;
  const [open, setOpen] = useState(false);
  const [isRecurring, setIsRecurring] = useState(
    transaction?.isRecurring ?? !!prefillFromTemplate,
  );
  const categoryItems = useMemo(
    () =>
      createComboboxItems(categories, {
        getValue: (c: PersonalCategoryRow) => c.id,
        getLabel: (c: PersonalCategoryRow) => c.name,
      }),
    [categories],
  );
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const action = isEdit ? updatePersonalTransactionAction : createPersonalTransactionAction;
    const result = await action(prevState, formData);
    if (!result.error) {
      setOpen(false);
      if (!isEdit && prefillFromTemplate) {
        toast.success(format(dict.recurring.loggedToast, { name: prefillFromTemplate.description ?? "" }));
      }
    }
    return result;
  }, initialState);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setIsRecurring(transaction?.isRecurring ?? !!prefillFromTemplate);
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
            <Label htmlFor="personal-tx-category">{dict.categoryLabel}</Label>
            <Combobox
              items={categoryItems}
              name="categoryId"
              defaultValue={transaction?.categoryId ?? prefillFromTemplate?.categoryId}
            >
              <ComboboxInputGroup>
                <ComboboxInput id="personal-tx-category" placeholder={dict.categoryPlaceholder} />
                <ComboboxTrigger aria-label={dict.categoryToggleLabel} />
              </ComboboxInputGroup>
              <ComboboxContent emptyMessage={dict.categoryNoResults}>
                {(c: PersonalCategoryRow) => (
                  <ComboboxItem key={c.id} value={c.id}>
                    {c.name}
                  </ComboboxItem>
                )}
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="personal-tx-amount">{dict.amountLabel}</Label>
              <Input
                id="personal-tx-amount"
                name="amount"
                type="number"
                min={0.01}
                step="any"
                defaultValue={
                  transaction
                    ? String(transaction.amount)
                    : prefillFromTemplate
                      ? String(prefillFromTemplate.amount)
                      : ""
                }
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="personal-tx-date">{dict.dateLabel}</Label>
              <Input
                id="personal-tx-date"
                name="date"
                type="date"
                defaultValue={toDateInputValue(transaction?.date ?? new Date())}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="personal-tx-description">{dict.descriptionLabel}</Label>
            <Input
              id="personal-tx-description"
              name="description"
              maxLength={200}
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
                <Label htmlFor="personal-tx-frequency">{dict.frequencyLabel}</Label>
                <Select
                  name="recurrenceFrequency"
                  defaultValue={
                    transaction?.recurrenceFrequency ?? prefillFromTemplate?.frequency ?? "MONTHLY"
                  }
                >
                  <SelectTrigger id="personal-tx-frequency" className="w-full">
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
