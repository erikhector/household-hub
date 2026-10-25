"use client";

// The per-member "share" + "paid" grid used by both ways of logging a split
// household expense — TransactionDialog (household budget) and
// LogSharedExpenseDialog (personal budget) — so a bill can be paid partly
// by several members (TransactionSplit.amountPaid, see its doc comment in
// schema.prisma). Before partial payments each dialog had its own copy of
// the share inputs plus a single "Paid by" select.
//
// Controlled: the parent owns the share/paid values (it resets them when the
// dialog opens or the household changes) and runs checkSplitForm itself to
// decide whether submit is allowed. This only renders the inputs, the live
// warnings, and the form fields the actions read: `splitMemberId`,
// `splitAmount` and `splitPaid`, aligned by index.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkSplitForm } from "@/components/budget/split-amounts";
import { format } from "@/lib/i18n/format";

export type SplitEditorDict = {
  sharesLabel: string;
  splitEvenlyButton: string;
  shareColumn: string;
  paidColumn: string;
  amountAriaLabel: string;
  paidAriaLabel: string;
  sharesLeftHint: string;
  sharesOverWarning: string;
  overpaidWarning: string;
  leftDueHint: string;
};

export function SplitEditor({
  members,
  amount,
  shares,
  paid,
  onSharesChange,
  onPaidChange,
  onSplitEvenly,
  numberFormat,
  dict,
}: {
  members: { id: string; displayName: string }[];
  /** The bill's total, as typed in the dialog's amount input. */
  amount: string;
  shares: Record<string, string>;
  paid: Record<string, string>;
  onSharesChange: (next: Record<string, string>) => void;
  onPaidChange: (next: Record<string, string>) => void;
  onSplitEvenly: () => void;
  /** UX-15: the caller's createMoneyFormat(locale, currencyCode), so the
   * warnings read "12,50 kr" to a Swedish household rather than a bare
   * `toFixed(2)` "12.50". The inputs themselves stay `type="number"`, whose
   * value is always dot-decimal whatever the locale. */
  numberFormat: Intl.NumberFormat;
  dict: SplitEditorDict;
}) {
  const check = checkSplitForm(amount, shares, paid);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{dict.sharesLabel}</Label>
        <Button type="button" variant="outline" size="xs" onClick={onSplitEvenly}>
          {dict.splitEvenlyButton}
        </Button>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1" />
        <span className="w-24 shrink-0">{dict.shareColumn}</span>
        <span className="w-24 shrink-0">{dict.paidColumn}</span>
      </div>
      {members.map((m) => (
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
            value={shares[m.id] ?? "0"}
            onChange={(e) => onSharesChange({ ...shares, [m.id]: e.target.value })}
            aria-label={format(dict.amountAriaLabel, { name: m.displayName })}
          />
          <Input
            name="splitPaid"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className="w-24 shrink-0"
            value={paid[m.id] ?? "0"}
            onChange={(e) => onPaidChange({ ...paid, [m.id]: e.target.value })}
            aria-label={format(dict.paidAriaLabel, { name: m.displayName })}
          />
        </div>
      ))}
      <ShareRemainderNote
        amount={amount}
        remainder={check.shareRemainder}
        numberFormat={numberFormat}
        leftHint={dict.sharesLeftHint}
        overWarning={dict.sharesOverWarning}
      />
      {check.overpaid && (
        <p className="text-xs text-destructive">
          {format(dict.overpaidWarning, {
            paid: numberFormat.format(check.paidTotal),
            amount: numberFormat.format(Number(amount) || 0),
          })}
        </p>
      )}
      {!check.overpaid && check.leftDue > 0 && (
        <p className="text-xs text-muted-foreground">
          {format(dict.leftDueHint, { amount: numberFormat.format(check.leftDue) })}
        </p>
      )}
    </div>
  );
}

/**
 * The running "176 of 476 left to split" under a share grid, updated on
 * every keystroke, so splitting a bill by hand doesn't mean doing the
 * subtraction yourself. Still-to-split is muted rather than red: it's the
 * normal state halfway through typing, not a mistake (submit stays
 * disabled until it's 0 either way). Over-split is red, since some share
 * has to come down. Silent only at exactly 0 (see shareRemainder for why
 * a single cent still counts). Shared by SplitEditor and the two dialogs
 * with their own share-only grid (RecurringTemplateDialog,
 * PlannedExpenseDialog). The live region is always mounted so screen
 * readers announce the change, not only the first appearance.
 */
export function ShareRemainderNote({
  amount,
  remainder,
  numberFormat,
  leftHint,
  overWarning,
}: {
  /** The bill's total, as typed in the dialog's amount input. */
  amount: string;
  /** shareRemainder(amount, shares). */
  remainder: number;
  numberFormat: Intl.NumberFormat;
  /** "{amount} of {total} left to split." */
  leftHint: string;
  /** "The shares are {amount} more than the {total} total." */
  overWarning: string;
}) {
  const total = numberFormat.format(Number(amount) || 0);
  return (
    <div aria-live="polite">
      {remainder > 0 && (
        <p className="text-xs text-muted-foreground">
          {format(leftHint, { amount: numberFormat.format(remainder), total })}
        </p>
      )}
      {remainder < 0 && (
        <p className="text-xs text-destructive">
          {format(overWarning, { amount: numberFormat.format(-remainder), total })}
        </p>
      )}
    </div>
  );
}
