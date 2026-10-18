"use client";

import { useActionState, useMemo, useState, type ReactElement } from "react";
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
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { MemberOption } from "@/components/budget/transaction-dialog";
import { PendingLabel } from "@/components/ui/pending-label";

// Shared by both createRecurringTemplateAction/updateRecurringTemplateAction
// (household) and createPersonalRecurringTemplateAction/
// updatePersonalRecurringTemplateAction (personal) — see
// TransactionFormAction's identical doc comment
// (src/components/budget/transaction-dialog.tsx).
export type RecurringTemplateFormAction = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export type RecurringTemplateSplitRow = { householdMemberId: string; amountOwed: number };

export type RecurringTemplateRow = {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
  dayOfMonth: number | null;
  // Opt-in split of this template's expected cost among household members —
  // see prisma/schema.prisma's RecurringTemplateSplit doc comment. Empty for
  // every template that hasn't opted in, same as TransactionRow.splits.
  splits: RecurringTemplateSplitRow[];
};

const initialState: ActionState = {};

function buildInitialSplitAmounts(
  template: RecurringTemplateRow | undefined,
  members: MemberOption[],
): Record<string, string> {
  if (template && template.splits.length > 0) {
    const byMember = new Map(template.splits.map((s) => [s.householdMemberId, s.amountOwed]));
    return Object.fromEntries(members.map((m) => [m.id, (byMember.get(m.id) ?? 0).toFixed(2)]));
  }
  const even = evenSplitAmounts(template?.amount ?? 0, members.length);
  return Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)]));
}

export function RecurringTemplateDialog({
  dict,
  categories,
  members,
  trigger,
  template,
  createAction,
  updateAction,
  numberFormat,
}: {
  dict: BudgetDict;
  categories: CategoryRow[];
  /** Every member of the active household — the split UI is only offered
   * (and rendered) when there's more than one, mirroring TransactionDialog's
   * split section. Optional/defaulted to empty so the personal budget page
   * (which has no members at all, BUDGET-2) simply never sees the split
   * section, the same way a genuinely single-member household wouldn't. */
  members?: MemberOption[];
  trigger: ReactElement;
  template?: RecurringTemplateRow;
  /** createRecurringTemplateAction/updateRecurringTemplateAction (household)
   * or createPersonalRecurringTemplateAction/updatePersonalRecurringTemplateAction
   * (personal) — see RecurringTemplateFormAction's doc comment. */
  createAction: RecurringTemplateFormAction;
  updateAction: RecurringTemplateFormAction;
  /** The caller's createMoneyFormat(locale, currencyCode), for the split
   * mismatch warning (UX-15). */
  numberFormat: Intl.NumberFormat;
}) {
  const isEdit = !!template;
  const memberOptions = members ?? [];
  const canSplit = memberOptions.length > 1;
  const [open, setOpen] = useState(false);
  const categoryItems = useMemo(
    () =>
      createComboboxItems(categories, {
        getValue: (c: CategoryRow) => c.id,
        getLabel: (c: CategoryRow) => c.name,
      }),
    [categories],
  );
  const [amount, setAmount] = useState(template ? String(template.amount) : "");
  const [splitEnabled, setSplitEnabled] = useState(
    canSplit && !!template && template.splits.length > 0,
  );
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(() =>
    buildInitialSplitAmounts(template, memberOptions),
  );
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const action = isEdit ? updateAction : createAction;
    const result = await action(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  function resetToEvenSplit(total: string) {
    const even = evenSplitAmounts(Number(total) || 0, memberOptions.length);
    setSplitAmounts(Object.fromEntries(memberOptions.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)])));
  }

  // Reruns on every open, not just mount — the "Add recurring item" trigger
  // is one persistent dialog instance reused across repeat add-then-close
  // cycles (unlike an edit dialog, which is remounted per row), so its
  // amount/split state needs resetting each time it reopens. Mirrors
  // TransactionDialog's resetForTransaction.
  function resetForTemplate() {
    setAmount(template ? String(template.amount) : "");
    setSplitEnabled(canSplit && !!template && template.splits.length > 0);
    setSplitAmounts(buildInitialSplitAmounts(template, memberOptions));
  }

  const splitTotal = Object.values(splitAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const splitMismatch = splitEnabled && Math.abs(splitTotal - (Number(amount) || 0)) > 0.01;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForTemplate();
      }}
    >
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
            <Label htmlFor="rt-name">{dict.recurring.nameLabel}</Label>
            <Input
              id="rt-name"
              name="name"
              required
              maxLength={120}
              placeholder={dict.recurring.namePlaceholder}
              defaultValue={template?.name}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rt-category">{dict.categoryLabel}</Label>
            <Combobox items={categoryItems} name="categoryId" defaultValue={template?.categoryId}>
              <ComboboxInputGroup>
                <ComboboxInput id="rt-category" placeholder={dict.categoryPlaceholder} />
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
              <Label htmlFor="rt-amount">{dict.recurring.amountLabel}</Label>
              <Input
                id="rt-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rt-day">{dict.recurring.dayOfMonthLabel}</Label>
              <Input
                id="rt-day"
                name="dayOfMonth"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                step={1}
                placeholder={dict.recurring.dayOfMonthPlaceholder}
                defaultValue={template?.dayOfMonth ?? undefined}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rt-frequency">{dict.frequencyLabel}</Label>
            <Select name="frequency" defaultValue={template?.frequency ?? "MONTHLY"}>
              <SelectTrigger id="rt-frequency" className="w-full">
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
          {canSplit && (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  name="splitEnabled"
                  checked={splitEnabled}
                  onChange={(e) => setSplitEnabled(e.target.checked)}
                />
                {dict.recurring.split?.toggleLabel}
              </label>
              {splitEnabled && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label>{dict.recurring.split?.sharesLabel}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => resetToEvenSplit(amount)}
                    >
                      {dict.recurring.split?.splitEvenlyButton}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {memberOptions.map((m) => (
                      <div key={m.id} className="flex items-center gap-2">
                        <input type="hidden" name="splitMemberId" value={m.id} />
                        <span className="min-w-0 flex-1 truncate text-sm">{m.displayName}</span>
                        <Input
                          name="splitAmount"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          className="w-24 shrink-0"
                          value={splitAmounts[m.id] ?? "0"}
                          onChange={(e) =>
                            setSplitAmounts((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          aria-label={format(dict.recurring.split?.amountAriaLabel ?? "", { name: m.displayName })}
                        />
                      </div>
                    ))}
                  </div>
                  {splitMismatch && (
                    <p className="text-xs text-destructive">
                      {format(dict.recurring.split?.mismatchWarning ?? "", {
                        total: numberFormat.format(splitTotal),
                        amount: numberFormat.format(Number(amount) || 0),
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
              <PendingLabel pending={pending} busy={dict.recurring.saving} idle={isEdit ? dict.recurring.save : dict.recurring.add} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
