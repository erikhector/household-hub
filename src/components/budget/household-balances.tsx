"use client";

// "Who owes whom" — all aggregation happens in
// src/app/dashboard/budget/page.tsx (via computeNetBalances/simplifyDebts in
// src/lib/settle-up-calc.ts); this component renders the result and hosts
// the one write it needs, "Clear debt". See REQUIREMENTS.md's "Household
// expense splitting" subsection.
//
// Shows the debt-simplified settle-up list (Splitwise's pattern: net every
// pairwise balance down to the minimum number of transfers), not a raw list
// of every split — that raw list would double- (or triple-) count shared
// expenses and obscure who actually needs to pay whom. Balances cover every
// split bill the household has, not just the month on screen: a debt carries
// over until a repayment (MemberSettlement) clears it. Money still owed *to a
// bill* (nobody has paid that part yet) isn't anyone's debt to another
// member, so it's listed separately under "Still due on bills".
//
// GAP-7: when the signed-in member owes someone who has saved a Swish number
// on their Profile, that transfer also gets a "Pay with Swish" link that
// opens the Swish app pre-filled (src/lib/swish.ts). It's only a link: the
// app can't see whether the payment went through, and money changes are
// always an explicit action here (BACKLOG.md's Guardrails), so "Clear debt"
// is still how the repayment gets recorded — the hint under the list says so.

import { useActionState, useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settlement } from "@/lib/settle-up-calc";
import { buildSwishPaymentUrl, formatSwishNumber } from "@/lib/swish";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { PendingLabel } from "@/components/ui/pending-label";

export type MemberLabel = { id: string; displayName: string };

/** A split bill with part of it still unpaid — see settle-up-calc.ts's
 * remainingDue. */
export type UnpaidBillRow = {
  id: string;
  name: string;
  date: Date;
  leftDue: number;
};

/** A recorded repayment (MemberSettlement). */
export type RepaymentRow = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  date: Date;
};

type BalancesDict = Dictionary["budget"]["balances"];

const initialState: ActionState = {};

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function ClearDebtDialog({
  settlement,
  memberName,
  dict,
  onRecord,
}: {
  settlement: Settlement;
  memberName: (id: string) => string;
  dict: BalancesDict;
  onRecord: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prevState: ActionState, formData: FormData) => {
      const result = await onRecord(prevState, formData);
      if (!result.error) {
        setOpen(false);
        toast.success(dict.clearedToast);
      }
      return result;
    },
    initialState,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline">{dict.clearButton}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.clearDialogTitle}</DialogTitle>
          <DialogDescription>
            {format(dict.clearDialogDescription, {
              from: memberName(settlement.fromMemberId),
              to: memberName(settlement.toMemberId),
            })}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="fromMemberId" value={settlement.fromMemberId} />
          <input type="hidden" name="toMemberId" value={settlement.toMemberId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="settle-amount">{dict.amountLabel}</Label>
              {/* Pre-filled with the whole debt; lower it for a partial
                  repayment. */}
              <Input
                id="settle-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="any"
                defaultValue={settlement.amount.toFixed(2)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settle-date">{dict.dateLabel}</Label>
              <Input id="settle-date" name="date" type="date" defaultValue={todayInputValue()} required />
            </div>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              <PendingLabel pending={pending} busy={dict.saving} idle={dict.confirm} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HouseholdBalances({
  settlements,
  unpaidBills,
  repayments,
  members,
  currentMemberId,
  swishNumbers,
  dict,
  locale,
  currencyCode,
  onRecordRepayment,
  onDeleteRepayment,
}: {
  /** Suggested transfers that would zero every balance (simplifyDebts). */
  settlements: Settlement[];
  unpaidBills: UnpaidBillRow[];
  /** The most recent recorded repayments, newest first. */
  repayments: RepaymentRow[];
  members: MemberLabel[];
  /** The signed-in member — only their own debts get a Swish link. */
  currentMemberId: string;
  /** Swish aliases by member id, already narrowed to the members
   * `currentMemberId` owes (swishNumbersForPayer, src/lib/swish.ts). */
  swishNumbers: Record<string, string>;
  dict: BalancesDict;
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
  /** recordSettlementAction — injected like the other budget components'
   * actions (BUDGET-2). */
  onRecordRepayment: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  onDeleteRepayment: (id: string) => Promise<ActionState>;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // The Swish aria label already says "kr" itself (Swish only moves SEK,
  // and the link only shows when the household is SEK or unset), so it
  // takes the plain number rather than a second currency symbol.
  const swishAmountFormat = createMoneyFormat(locale, null);
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const memberName = (id: string) => members.find((m) => m.id === id)?.displayName ?? "?";
  // Re-checks the payer here too rather than trusting swishNumbers alone,
  // so a link can never appear on somebody else's debt.
  const swishUrlFor = (s: Settlement) => {
    if (!currentMemberId || s.fromMemberId !== currentMemberId) return null;
    const payee = swishNumbers[s.toMemberId];
    if (!payee) return null;
    return buildSwishPaymentUrl({ payee, amount: s.amount, message: dict.swishMessage });
  };
  const hasSwishLink = settlements.some((s) => swishUrlFor(s) !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.title}</CardTitle>
        <CardDescription>{dict.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settlements.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {dict.allSettled}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {settlements.map((s, i) => {
              const swishUrl = swishUrlFor(s);
              return (
                <li
                  key={`${s.fromMemberId}-${s.toMemberId}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{memberName(s.fromMemberId)}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{memberName(s.toMemberId)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="font-medium tabular-nums text-foreground">
                      {numberFormat.format(s.amount)}
                    </span>
                    {swishUrl && (
                      // A plain <a>, not router navigation: the swish:// scheme
                      // hands off to the Swish app on the phone.
                      <a
                        href={swishUrl}
                        className={buttonVariants({ size: "xs" })}
                        aria-label={format(dict.swishAriaLabel, {
                          amount: swishAmountFormat.format(s.amount),
                          name: memberName(s.toMemberId),
                          number: formatSwishNumber(swishNumbers[s.toMemberId]),
                        })}
                      >
                        {dict.swishButton}
                      </a>
                    )}
                    <ClearDebtDialog
                      settlement={s}
                      memberName={memberName}
                      dict={dict}
                      onRecord={onRecordRepayment}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hasSwishLink && <p className="text-xs text-muted-foreground">{dict.swishHint}</p>}

        {unpaidBills.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{dict.unpaidBillsTitle}</p>
            <ul className="flex flex-col gap-1">
              {unpaidBills.map((bill) => (
                <li key={bill.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {bill.name}
                    <span className="text-muted-foreground"> · {dateFormat.format(bill.date)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-warning">
                    {format(dict.leftDue, { amount: numberFormat.format(bill.leftDue) })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {repayments.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{dict.repaymentsTitle}</p>
            <ul className="flex flex-col gap-1">
              {repayments.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{memberName(r.fromMemberId)}</span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{memberName(r.toMemberId)}</span>
                    <span className="shrink-0 text-muted-foreground">· {dateFormat.format(r.date)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="tabular-nums">{numberFormat.format(r.amount)}</span>
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          aria-label={dict.deleteRepaymentAriaLabel}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                      title={dict.confirmDeleteRepayment.title}
                      description={dict.confirmDeleteRepayment.description}
                      cancelLabel={dict.confirmDeleteRepayment.cancel}
                      confirmLabel={dict.confirmDeleteRepayment.confirm}
                      pendingLabel={dict.confirmDeleteRepayment.confirming}
                      onConfirm={() => onDeleteRepayment(r.id)}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
