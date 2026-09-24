"use client";

// Register a shared household expense straight from Personal Budget — see
// docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md and createSharedExpenseFromPersonalBudgetAction's
// doc comment (src/app/dashboard/budget/actions.ts) for why this creates a
// real household Transaction (with a mandatory split) rather than a
// PersonalTransaction: the household budget stays the one ledger of record,
// this is just an alternate place to write to it. Only rendered (see
// BudgetTabs's `sharedExpenseHouseholds` prop, personal budget page only)
// when the user belongs to at least one household with more than one
// member — nothing to split otherwise.

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
import { createSharedExpenseFromPersonalBudgetAction } from "@/app/dashboard/budget/actions";
import { evenSplitAmounts } from "@/components/budget/split-amounts";
import { parseMonthKey, toMonthKey } from "@/lib/budget-date-utils";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type ShareableHouseholdMember = { id: string; displayName: string };
export type ShareableHouseholdCategory = { id: string; name: string; type: "INCOME" | "EXPENSE" | "SAVINGS" };

export type ShareableHousehold = {
  id: string;
  name: string;
  /** The signed-in user's own HouseholdMember id in this household — used
   * to default "paid by" to themselves. */
  currentMemberId: string;
  members: ShareableHouseholdMember[];
  categories: ShareableHouseholdCategory[];
};

/** Seeds the dialog from a shared bill's due row ("Log payment" in
 * DueRecurringWidget, src/components/budget/due-recurring-widget.tsx): the
 * household and category are fixed, the amount/split come from the
 * template, and the template id is sent along so the new transaction marks
 * the bill as logged for the period. */
export type SharedExpensePrefill = {
  householdId: string;
  templateId: string;
  categoryId: string;
  /** The template's full expected amount (not this user's share). */
  amount: number;
  description: string;
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
  /** Per-member shares saved on the template, keyed by HouseholdMember id. */
  splits: Record<string, number>;
};

const initialState: ActionState = {};

function toDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/** Mirrors TransactionDialog's defaultDateForMonth (F11) — see its doc
 * comment (src/components/budget/transaction-dialog.tsx). */
function defaultDateForMonth(monthKey: string | undefined): Date {
  const now = new Date();
  if (!monthKey || monthKey === toMonthKey(now)) return now;
  return parseMonthKey(monthKey);
}

function prefillSplitAmounts(prefill: SharedExpensePrefill, household: ShareableHousehold | undefined) {
  return Object.fromEntries(
    (household?.members ?? []).map((m) => [m.id, (prefill.splits[m.id] ?? 0).toFixed(2)]),
  );
}

export function LogSharedExpenseDialog({
  dict,
  households,
  monthKey,
  trigger,
  prefill,
}: {
  dict: Dictionary["personalBudget"];
  /** Every household the signed-in user belongs to that has more than one
   * member — see PersonalBudgetPage's sharedExpenseHouseholds query. */
  households: ShareableHousehold[];
  /** "YYYY-MM" of the month currently being browsed — feeds a new
   * transaction's default date (F11). See TransactionDialog's identical
   * prop (src/components/budget/transaction-dialog.tsx). */
  monthKey?: string;
  trigger: ReactElement;
  prefill?: SharedExpensePrefill;
}) {
  const [open, setOpen] = useState(false);
  const [householdId, setHouseholdId] = useState(prefill?.householdId ?? households[0]?.id ?? "");
  const household = households.find((h) => h.id === householdId) ?? households[0];
  const showHouseholdPicker = households.length > 1 && !prefill;

  const categoryItems = useMemo(
    () =>
      createComboboxItems(household?.categories ?? [], {
        getValue: (c: ShareableHouseholdCategory) => c.id,
        getLabel: (c: ShareableHouseholdCategory) => c.name,
      }),
    [household],
  );

  const [amount, setAmount] = useState(prefill ? String(prefill.amount) : "");
  const [date, setDate] = useState(() => toDateInputValue(defaultDateForMonth(monthKey)));
  const [paidByMemberId, setPaidByMemberId] = useState(household?.currentMemberId ?? "");
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(() =>
    prefill ? prefillSplitAmounts(prefill, household) : {},
  );
  // This signed-in user's own share of a prefilled due bill (F4) — never the
  // full amount above, which is the whole bill being logged. `undefined`
  // outside the "Log payment" prefill flow, where there's no single "your
  // share" to call out (the whole form is being filled from scratch).
  const myShare =
    prefill && household ? (prefill.splits[household.currentMemberId] ?? undefined) : undefined;

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createSharedExpenseFromPersonalBudgetAction(prevState, formData);
    if (!result.error) {
      setOpen(false);
      toast.success(format(dict.logShared.loggedToast, { household: household?.name ?? "" }));
    }
    return result;
  }, initialState);

  function resetForHousehold(next: ShareableHousehold | undefined) {
    setAmount(prefill ? String(prefill.amount) : "");
    setDate(toDateInputValue(defaultDateForMonth(monthKey)));
    setPaidByMemberId(next?.currentMemberId ?? "");
    setSplitAmounts(
      prefill
        ? prefillSplitAmounts(prefill, next)
        : Object.fromEntries((next?.members ?? []).map((m) => [m.id, "0.00"])),
    );
  }

  function selectHousehold(id: string) {
    setHouseholdId(id);
    resetForHousehold(households.find((h) => h.id === id));
  }

  function resetToEvenSplit(total: string) {
    if (!household) return;
    const even = evenSplitAmounts(Number(total) || 0, household.members.length);
    setSplitAmounts(
      Object.fromEntries(household.members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)])),
    );
  }

  const splitTotal = Object.values(splitAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const splitMismatch = Math.abs(splitTotal - (Number(amount) || 0)) > 0.01;

  if (!household) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          const initial = households.find((h) => h.id === prefill?.householdId) ?? households[0];
          setHouseholdId(initial.id);
          resetForHousehold(initial);
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {prefill
              ? format(dict.logShared.paymentDialogTitle, { name: prefill.description })
              : dict.logShared.dialogTitle}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{dict.logShared.subtitle}</p>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="householdId" value={household.id} />
          <input type="hidden" name="splitEnabled" value="on" />
          {prefill && (
            <>
              <input type="hidden" name="recurringTemplateId" value={prefill.templateId} />
              <input type="hidden" name="isRecurring" value="on" />
              <input type="hidden" name="recurrenceFrequency" value={prefill.frequency} />
            </>
          )}

          {showHouseholdPicker && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="shared-expense-household">{dict.logShared.householdLabel}</Label>
              <Select value={householdId} onValueChange={(v) => selectHousehold(String(v))}>
                <SelectTrigger id="shared-expense-household" className="w-full">
                  <SelectValue>
                    {(v: string) => households.find((h) => h.id === v)?.name ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {households.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="shared-expense-category">{dict.logShared.categoryLabel}</Label>
            <Combobox
              key={household.id}
              items={categoryItems}
              name="categoryId"
              defaultValue={prefill?.categoryId}
            >
              <ComboboxInputGroup>
                <ComboboxInput
                  id="shared-expense-category"
                  placeholder={dict.logShared.categoryPlaceholder}
                />
                <ComboboxTrigger aria-label={dict.logShared.categoryToggleLabel} />
              </ComboboxInputGroup>
              <ComboboxContent emptyMessage={dict.logShared.categoryNoResults}>
                {(c: ShareableHouseholdCategory) => (
                  <ComboboxItem key={c.id} value={c.id}>
                    {c.name}
                  </ComboboxItem>
                )}
              </ComboboxContent>
            </Combobox>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="shared-expense-amount">
                {/* F4: when prefilled from a due bill's "Log payment", this
                    field holds the whole bill's total (needed for the split
                    to balance below) — labelled explicitly as such so it
                    doesn't read as this user's own share. */}
                {prefill ? dict.logShared.amountLabelFull : dict.logShared.amountLabel}
              </Label>
              <Input
                id="shared-expense-amount"
                name="amount"
                type="number"
                min={0.01}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {myShare !== undefined && (
                <p className="text-xs text-muted-foreground">
                  {dict.shared.yourShare}: {myShare.toFixed(2)}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="shared-expense-date">{dict.logShared.dateLabel}</Label>
              <Input
                id="shared-expense-date"
                name="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="shared-expense-description">{dict.logShared.descriptionLabel}</Label>
            <Input
              id="shared-expense-description"
              name="description"
              maxLength={200}
              placeholder={dict.logShared.descriptionPlaceholder}
              defaultValue={prefill?.description ?? ""}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="shared-expense-paid-by">{dict.logShared.paidByLabel}</Label>
              <Select
                name="paidByMemberId"
                value={paidByMemberId}
                onValueChange={(v) => setPaidByMemberId(String(v))}
              >
                <SelectTrigger id="shared-expense-paid-by" className="w-full">
                  <SelectValue>
                    {(v: string) => household.members.find((m) => m.id === v)?.displayName ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {household.members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>{dict.logShared.sharesLabel}</Label>
              <Button type="button" variant="outline" size="xs" onClick={() => resetToEvenSplit(amount)}>
                {dict.logShared.splitEvenlyButton}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {household.members.map((m) => (
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
                    aria-label={format(dict.logShared.amountAriaLabel, { name: m.displayName })}
                  />
                </div>
              ))}
            </div>
            {splitMismatch && (
              <p className="text-xs text-destructive">
                {format(dict.logShared.mismatchWarning, {
                  total: splitTotal.toFixed(2),
                  amount: (Number(amount) || 0).toFixed(2),
                })}
              </p>
            )}
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || splitMismatch}>
              {pending ? dict.logShared.saving : dict.logShared.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
