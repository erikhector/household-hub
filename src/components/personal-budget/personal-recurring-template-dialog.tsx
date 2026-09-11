"use client";

import { useActionState, useMemo, useState, type ReactElement } from "react";
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
  createPersonalRecurringTemplateAction,
  updatePersonalRecurringTemplateAction,
} from "@/app/dashboard/personal-budget/actions";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";

export type PersonalRecurringTemplateRow = {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
  dayOfMonth: number | null;
};

const initialState: ActionState = {};

export function PersonalRecurringTemplateDialog({
  dict,
  categories,
  trigger,
  template,
}: {
  dict: Dictionary["personalBudget"];
  categories: PersonalCategoryRow[];
  trigger: ReactElement;
  template?: PersonalRecurringTemplateRow;
}) {
  const isEdit = !!template;
  const [open, setOpen] = useState(false);
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
    const action = isEdit
      ? updatePersonalRecurringTemplateAction
      : createPersonalRecurringTemplateAction;
    const result = await action(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? dict.recurring.editDialogTitle : dict.recurring.addDialogTitle}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {isEdit && <input type="hidden" name="id" value={template.id} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="prt-name">{dict.recurring.nameLabel}</Label>
            <Input
              id="prt-name"
              name="name"
              required
              maxLength={120}
              placeholder={dict.recurring.namePlaceholder}
              defaultValue={template?.name}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="prt-category">{dict.categoryLabel}</Label>
            <Combobox items={categoryItems} name="categoryId" defaultValue={template?.categoryId}>
              <ComboboxInputGroup>
                <ComboboxInput id="prt-category" placeholder={dict.categoryPlaceholder} />
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
              <Label htmlFor="prt-amount">{dict.recurring.amountLabel}</Label>
              <Input
                id="prt-amount"
                name="amount"
                type="number"
                min={0.01}
                step="any"
                required
                defaultValue={template?.amount}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prt-day">{dict.recurring.dayOfMonthLabel}</Label>
              <Input
                id="prt-day"
                name="dayOfMonth"
                type="number"
                min={1}
                max={31}
                step={1}
                placeholder={dict.recurring.dayOfMonthPlaceholder}
                defaultValue={template?.dayOfMonth ?? undefined}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="prt-frequency">{dict.frequencyLabel}</Label>
            <Select name="frequency" defaultValue={template?.frequency ?? "MONTHLY"}>
              <SelectTrigger id="prt-frequency" className="w-full">
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
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? dict.recurring.saving : isEdit ? dict.recurring.save : dict.recurring.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
