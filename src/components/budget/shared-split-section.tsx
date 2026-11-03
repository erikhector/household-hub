"use client";

// UX-178: "Split with household" inside Personal Budget's Add transaction
// sheet. It replaces the separate "Add shared expense" dialog button: the
// switch turns the sheet into a shared household expense, paid by you and
// shared with the household's members (an even split until you tap Change).
// It posts through createSharedExpenseFromPersonalBudgetAction, the same
// write LogSharedExpenseDialog uses (still the "Log payment" dialog on a
// shared bill's due row), so the household budget stays the one ledger.
//
// The state lives in a hook so TransactionDialog, which owns the amount, the
// date and the category chips, can read it: the chips swap to the household's
// categories while the switch is on, and Save is blocked while the split
// doesn't add up.

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkSplitForm, evenSplitAmounts } from "@/components/budget/split-amounts";
import { SplitEditor } from "@/components/budget/split-editor";
import { format } from "@/lib/i18n/format";
import type { ShareableHousehold } from "@/components/personal-budget/log-shared-expense-dialog";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

function evenShares(household: ShareableHousehold | undefined, total: string) {
  const members = household?.members ?? [];
  const even = evenSplitAmounts(Number(total) || 0, members.length);
  return Object.fromEntries(members.map((m, i) => [m.id, (even[i] ?? 0).toFixed(2)]));
}

/** The signed-in member paid the whole amount until told otherwise. */
function youPaid(household: ShareableHousehold | undefined, amount: string) {
  return Object.fromEntries(
    (household?.members ?? []).map((m) => [m.id, m.id === household?.currentMemberId ? amount || "0" : "0"]),
  );
}

export function useSharedSplit(households: ShareableHousehold[], amount: string) {
  const [enabled, setEnabled] = useState(false);
  const [householdId, setHouseholdId] = useState(households[0]?.id ?? "");
  const household = households.find((h) => h.id === householdId) ?? households[0];
  const [categoryId, setCategoryId] = useState("");
  const [shares, setShares] = useState<Record<string, string>>(() => evenShares(household, ""));
  const [paid, setPaid] = useState<Record<string, string>>(() => youPaid(household, ""));
  const [sharesTouched, setSharesTouched] = useState(false);
  const [paidTouched, setPaidTouched] = useState(false);
  const [changing, setChanging] = useState(false);

  function reset() {
    const first = households[0];
    setEnabled(false);
    setHouseholdId(first?.id ?? "");
    setCategoryId("");
    setShares(evenShares(first, ""));
    setPaid(youPaid(first, ""));
    setSharesTouched(false);
    setPaidTouched(false);
    setChanging(false);
  }

  function selectHousehold(id: string) {
    const next = households.find((h) => h.id === id);
    setHouseholdId(id);
    setCategoryId("");
    setShares(evenShares(next, amount));
    setPaid(youPaid(next, amount));
    setSharesTouched(false);
    setPaidTouched(false);
  }

  /** The amount field changed: until a share or payment is edited they follow
   * it (an even split, paid by you), so typing the amount after ticking the
   * switch never leaves 0.00 shares behind (UX-111). */
  function onAmountChange(next: string) {
    if (!sharesTouched) setShares(evenShares(household, next));
    if (!paidTouched) setPaid(youPaid(household, next));
  }

  const check = checkSplitForm(amount, shares, paid);
  return {
    enabled,
    setEnabled,
    households,
    household,
    selectHousehold,
    categoryId,
    setCategoryId,
    shares,
    paid,
    changing,
    setChanging,
    reset,
    onAmountChange,
    invalid: check.shareMismatch || check.overpaid,
    editShares: (next: Record<string, string>) => {
      setShares(next);
      setSharesTouched(true);
    },
    editPaid: (next: Record<string, string>) => {
      setPaid(next);
      setPaidTouched(true);
    },
    splitEvenly: () => {
      setShares(evenShares(household, amount));
      setSharesTouched(false);
    },
  };
}

export type SharedSplit = ReturnType<typeof useSharedSplit>;

export function SharedSplitFields({
  split,
  amount,
  forced,
  dict,
  numberFormat,
}: {
  split: SharedSplit;
  amount: string;
  /** With no personal category to log against, the sheet can only add a
   * shared expense, so the switch is on and fixed. */
  forced: boolean;
  dict: Dictionary["personalBudget"]["logShared"];
  numberFormat: Intl.NumberFormat;
}) {
  const { household, households } = split;
  if (!household) return null;
  const others = household.members.filter((m) => m.id !== household.currentMemberId);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={split.enabled || forced}
          disabled={forced}
          onChange={(e) => split.setEnabled(e.target.checked)}
        />
        {dict.splitToggle}
      </label>
      {(split.enabled || forced) && (
        <>
          <input type="hidden" name="householdId" value={household.id} />
          <input type="hidden" name="splitEnabled" value="on" />
          {households.length > 1 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-split-household">{dict.householdLabel}</Label>
              <Select value={household.id} onValueChange={(v) => split.selectHousehold(String(v))}>
                <SelectTrigger id="tx-split-household" className="w-full">
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
          {split.changing ? (
            <SplitEditor
              members={household.members}
              amount={amount}
              shares={split.shares}
              paid={split.paid}
              onSharesChange={split.editShares}
              onPaidChange={split.editPaid}
              onSplitEvenly={split.splitEvenly}
              numberFormat={numberFormat}
              dict={dict}
            />
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <p className="text-muted-foreground">
                  {format(dict.splitSummary, { members: others.map((m) => m.displayName).join(", ") })}
                </p>
                {others.map((m) => (
                  <p key={m.id}>
                    {format(dict.splitShare, {
                      name: m.displayName,
                      amount: numberFormat.format(Number(split.shares[m.id]) || 0),
                    })}
                  </p>
                ))}
                {/* The editor's inputs are what the action reads; collapsed,
                    the same values go as hidden fields. */}
                {household.members.map((m) => (
                  <Fragment key={m.id}>
                    <input type="hidden" name="splitMemberId" value={m.id} />
                    <input type="hidden" name="splitAmount" value={split.shares[m.id] ?? "0"} />
                    <input type="hidden" name="splitPaid" value={split.paid[m.id] ?? "0"} />
                  </Fragment>
                ))}
              </div>
              <Button type="button" variant="outline" className="h-auto min-h-11 min-w-11" onClick={() => split.setChanging(true)}>
                {dict.splitChange}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
