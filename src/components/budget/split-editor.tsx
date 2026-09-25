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
  mismatchWarning: string;
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
            min={0}
            step="any"
            className="w-24 shrink-0"
            value={paid[m.id] ?? "0"}
            onChange={(e) => onPaidChange({ ...paid, [m.id]: e.target.value })}
            aria-label={format(dict.paidAriaLabel, { name: m.displayName })}
          />
        </div>
      ))}
      {check.shareMismatch && (
        <p className="text-xs text-destructive">
          {format(dict.mismatchWarning, {
            total: check.shareTotal.toFixed(2),
            amount: (Number(amount) || 0).toFixed(2),
          })}
        </p>
      )}
      {check.overpaid && (
        <p className="text-xs text-destructive">
          {format(dict.overpaidWarning, {
            paid: check.paidTotal.toFixed(2),
            amount: (Number(amount) || 0).toFixed(2),
          })}
        </p>
      )}
      {!check.overpaid && check.leftDue > 0 && (
        <p className="text-xs text-muted-foreground">
          {format(dict.leftDueHint, { amount: check.leftDue.toFixed(2) })}
        </p>
      )}
    </div>
  );
}
