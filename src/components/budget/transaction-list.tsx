"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink, Pencil, Repeat, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  TransactionDialog,
  type MemberOption,
  type TransactionFormAction,
  type TransactionRow,
} from "@/components/budget/transaction-dialog";
import { format } from "@/lib/i18n/format";
import { remainingDue } from "@/lib/settle-up-calc";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";

export type TransactionListRow = TransactionRow & {
  categoryName: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
};

// This user's own share of a posted split household Transaction (see
// docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md) — merged straight into the
// normal transaction list, badged "Shared", rather than shown in a separate
// section. Read-only here: a "View in {household} Budget" link is the only
// control, since the household budget stays the one place these get logged,
// edited, or deleted. Only ever non-empty for the personal budget page
// (BUDGET-2) — the household budget page always passes `[]`, since a
// household's own transactions have no "shared with itself" concept.
export type SharedPostedRow = {
  id: string;
  categoryName: string;
  /** This user's own share (TransactionSplit.amountOwed) — never the
   * transaction's full amount. */
  amount: number;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  date: Date;
  /** The household this shared row actually belongs to — used to target the
   * "View in {household} Budget" link explicitly (F1), never left to
   * whichever household happens to be "active" elsewhere in the app, which
   * can silently differ when the user belongs to more than one. */
  householdId: string;
  householdName: string;
  /** Every member who has paid anything towards the bill — a bill can be
   * paid partly by several members (TransactionSplit.amountPaid). */
  paidByNames: string[];
  /** What this user has paid towards the bill themselves. */
  yourPaid: number;
  /** What nobody has paid on the whole bill yet (settle-up-calc.ts's
   * remainingDue) — 0 once it's fully paid. */
  leftDue: number;
};

type Row = { kind: "own"; row: TransactionListRow } | { kind: "shared"; row: SharedPostedRow };

function amountColor(type: "INCOME" | "EXPENSE" | "SAVINGS") {
  if (type === "INCOME") return "text-success";
  if (type === "SAVINGS") return "text-chart-2";
  return "text-destructive";
}

function amountSign(type: "INCOME" | "EXPENSE" | "SAVINGS") {
  if (type === "INCOME") return "+";
  if (type === "SAVINGS") return "→";
  return "-";
}

function categoryBadgeClass(type: "INCOME" | "EXPENSE" | "SAVINGS") {
  if (type === "INCOME") return "border-success/30 text-success";
  if (type === "SAVINGS") return "border-chart-2/30 text-chart-2";
  return "border-destructive/30 text-destructive";
}

const frequencyLabelKey = {
  WEEKLY: "frequencyWeekly",
  MONTHLY: "frequencyMonthly",
  YEARLY: "frequencyYearly",
} as const satisfies Record<NonNullable<TransactionRow["recurrenceFrequency"]>, keyof BudgetDict>;

export function TransactionList({
  transactions,
  sharedRows = [],
  showHouseholdName = false,
  categories,
  members,
  currentMemberId,
  monthKey,
  dict,
  locale,
  currencyCode,
  onDelete,
  createAction,
  updateAction,
}: {
  transactions: TransactionListRow[];
  /** This user's own share of posted split household transactions this
   * month (see SharedPostedRow's doc comment) — merged into the list below,
   * badged "Shared". Always `[]` on the household budget page. */
  sharedRows?: SharedPostedRow[];
  /** Only show which household a shared row belongs to once the user is in
   * more than one — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6.
   * Meaningless (and always `false`) whenever sharedRows is empty. */
  showHouseholdName?: boolean;
  categories: CategoryRow[];
  members: MemberOption[];
  currentMemberId: string;
  /** "YYYY-MM" — reused for a shared row's "View in {household} Budget"
   * link, required whenever sharedRows is non-empty. Also threaded into the
   * edit TransactionDialog below (F11). */
  monthKey?: string;
  dict: BudgetDict;
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
  /** deleteTransactionAction (household) or deletePersonalTransactionAction
   * (personal) — injected the same way TransactionDialog's createAction/
   * updateAction are (BUDGET-2). */
  onDelete: (id: string) => Promise<ActionState>;
  createAction: TransactionFormAction;
  updateAction: TransactionFormAction;
}) {
  const [isPending, startTransition] = useTransition();
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const memberName = (id: string) => members.find((m) => m.id === id)?.displayName ?? "?";

  // Who paid a split bill, for the "Split" badge's tooltip — several members
  // can each have paid part of it (TransactionSplit.amountPaid).
  function splitBadgeTitle(row: TransactionListRow) {
    const payers = row.splits.filter((s) => (s.amountPaid ?? 0) > 0);
    if (payers.length === 0) return undefined;
    return format(dict.split?.paidByBadge ?? "", {
      name: payers
        .map((s) => `${memberName(s.householdMemberId)} (${numberFormat.format(s.amountPaid ?? 0)})`)
        .join(", "),
    });
  }

  function splitLeftDue(row: TransactionListRow) {
    if (row.splits.length === 0) return 0;
    return remainingDue({
      amount: row.amount,
      splits: row.splits.map((s) => ({ ...s, amountPaid: s.amountPaid ?? 0 })),
    });
  }

  function sharedRowDetail(row: SharedPostedRow) {
    const parts = [
      row.paidByNames.length > 0
        ? format(dict.shared?.paidBy ?? "", { name: row.paidByNames.join(", ") })
        : "—",
    ];
    if (row.leftDue > 0) {
      parts.push(format(dict.shared?.leftDue ?? "", { amount: numberFormat.format(row.leftDue) }));
    }
    return parts.join(" · ");
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await onDelete(id);
      if (result.error) toast.error(result.error);
    });
  }

  // sharedRows is always [] on the household budget page, so this sort is a
  // no-op there (a stable sort over an already date-desc-ordered array keeps
  // same-day ties in their original, createdAt-desc order) — see
  // SharedPostedRow's doc comment.
  const rows: Row[] = [
    ...transactions.map((row): Row => ({ kind: "own", row })),
    ...sharedRows.map((row): Row => ({ kind: "shared", row })),
  ].sort((a, b) => b.row.date.getTime() - a.row.date.getTime());

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {dict.emptyTransactions}
      </p>
    );
  }

  return (
    <>
      <div className="hidden sm:block">
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{dict.columnDate}</TableHead>
          <TableHead>{dict.columnCategory}</TableHead>
          <TableHead>{dict.columnDescription}</TableHead>
          <TableHead className="text-right">{dict.columnAmount}</TableHead>
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) =>
          item.kind === "shared" ? (
            <TableRow key={item.row.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {dateFormat.format(item.row.date)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={"max-w-[10rem] " + categoryBadgeClass(item.row.type)}
                  >
                    <span className="min-w-0 truncate" title={item.row.categoryName}>
                      {item.row.categoryName}
                    </span>
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" />
                    {dict.shared?.sharedBadge}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="max-w-64 truncate text-muted-foreground">
                {sharedRowDetail(item.row)}
                {showHouseholdName ? ` · ${item.row.householdName}` : ""}
              </TableCell>
              <TableCell className={"text-right " + amountColor(item.row.type)}>
                <span className="block text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                  {dict.shared?.yourShare}
                </span>
                <span className="font-medium tabular-nums">
                  {amountSign(item.row.type)}
                  {numberFormat.format(item.row.amount)}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end">
                  <Link
                    href={`/dashboard/budget?month=${monthKey}&household=${item.row.householdId}`}
                    className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground"
                    title={format(dict.shared?.viewInHouseholdBudget ?? "", {
                      household: item.row.householdName,
                    })}
                    aria-label={format(dict.shared?.viewInHouseholdBudget ?? "", {
                      household: item.row.householdName,
                    })}
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ) : (
          <TableRow key={item.row.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {dateFormat.format(item.row.date)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={"max-w-[10rem] " + categoryBadgeClass(item.row.type)}
                >
                  <span className="min-w-0 truncate" title={item.row.categoryName}>
                    {item.row.categoryName}
                  </span>
                </Badge>
                {item.row.isRecurring && item.row.recurrenceFrequency && (
                  <Badge variant="secondary" className="gap-1">
                    <Repeat className="size-3" />
                    {dict[frequencyLabelKey[item.row.recurrenceFrequency]]}
                  </Badge>
                )}
                {item.row.splits.length > 0 && (
                  <Badge variant="secondary" className="gap-1" title={splitBadgeTitle(item.row)}>
                    <Users className="size-3" />
                    {dict.split?.splitBadge}
                  </Badge>
                )}
                {splitLeftDue(item.row) > 0 && (
                  <Badge variant="outline" className="border-warning/40 text-warning tabular-nums">
                    {format(dict.split?.leftDue ?? "", {
                      amount: numberFormat.format(splitLeftDue(item.row)),
                    })}
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="max-w-64 truncate text-muted-foreground">
              {item.row.description || "—"}
            </TableCell>
            <TableCell className={"text-right font-medium tabular-nums " + amountColor(item.row.type)}>
              {amountSign(item.row.type)}
              {numberFormat.format(item.row.amount)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <TransactionDialog
                  numberFormat={numberFormat}
                  dict={dict}
                  categories={categories}
                  members={members}
                  currentMemberId={currentMemberId}
                  transaction={item.row}
                  createAction={createAction}
                  updateAction={updateAction}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      aria-label={dict.editAriaLabel}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  }
                />
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      disabled={isPending}
                      aria-label={dict.deleteAriaLabel}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  }
                  title={dict.confirmDeleteTransaction.title}
                  description={dict.confirmDeleteTransaction.description}
                  cancelLabel={dict.confirmDeleteTransaction.cancel}
                  confirmLabel={dict.confirmDeleteTransaction.confirm}
                  pendingLabel={dict.confirmDeleteTransaction.confirming}
                  onConfirm={() => handleDelete(item.row.id)}
                />
              </div>
            </TableCell>
          </TableRow>
          ),
        )}
      </TableBody>
      </Table>
      </div>

      {/* Mobile: cards instead of a 5-column table — see InventoryTable's
          equivalent split for the same reasoning. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((item) =>
          item.kind === "shared" ? (
            <div key={item.row.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={"max-w-[10rem] " + categoryBadgeClass(item.row.type)}
                  >
                    <span className="min-w-0 truncate" title={item.row.categoryName}>
                      {item.row.categoryName}
                    </span>
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" />
                    {dict.shared?.sharedBadge}
                  </Badge>
                </div>
                <span className={"shrink-0 text-right " + amountColor(item.row.type)}>
                  <span className="block text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                    {dict.shared?.yourShare}
                  </span>
                  <span className="font-medium tabular-nums">
                    {amountSign(item.row.type)}
                    {numberFormat.format(item.row.amount)}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-muted-foreground">
                    {sharedRowDetail(item.row)}
                    {showHouseholdName ? ` · ${item.row.householdName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{dateFormat.format(item.row.date)}</p>
                </div>
                <Link
                  href={`/dashboard/budget?month=${monthKey}&household=${item.row.householdId}`}
                  className="inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                  title={format(dict.shared?.viewInHouseholdBudget ?? "", { household: item.row.householdName })}
                  aria-label={format(dict.shared?.viewInHouseholdBudget ?? "", {
                    household: item.row.householdName,
                  })}
                >
                  <ExternalLink className="size-4" />
                </Link>
              </div>
            </div>
          ) : (
          <div key={item.row.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={"max-w-[10rem] " + categoryBadgeClass(item.row.type)}
                >
                  <span className="min-w-0 truncate" title={item.row.categoryName}>
                    {item.row.categoryName}
                  </span>
                </Badge>
                {item.row.isRecurring && item.row.recurrenceFrequency && (
                  <Badge variant="secondary" className="gap-1">
                    <Repeat className="size-3" />
                    {dict[frequencyLabelKey[item.row.recurrenceFrequency]]}
                  </Badge>
                )}
                {item.row.splits.length > 0 && (
                  <Badge variant="secondary" className="gap-1" title={splitBadgeTitle(item.row)}>
                    <Users className="size-3" />
                    {dict.split?.splitBadge}
                  </Badge>
                )}
                {splitLeftDue(item.row) > 0 && (
                  <Badge variant="outline" className="border-warning/40 text-warning tabular-nums">
                    {format(dict.split?.leftDue ?? "", {
                      amount: numberFormat.format(splitLeftDue(item.row)),
                    })}
                  </Badge>
                )}
              </div>
              <span className={"shrink-0 font-medium tabular-nums " + amountColor(item.row.type)}>
                {amountSign(item.row.type)}
                {numberFormat.format(item.row.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted-foreground" title={item.row.description || undefined}>
                  {item.row.description || "—"}
                </p>
                <p className="text-xs text-muted-foreground">{dateFormat.format(item.row.date)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <TransactionDialog
                  numberFormat={numberFormat}
                  dict={dict}
                  categories={categories}
                  members={members}
                  currentMemberId={currentMemberId}
                  transaction={item.row}
                  createAction={createAction}
                  updateAction={updateAction}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-muted-foreground hover:text-foreground"
                      aria-label={dict.editAriaLabel}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  }
                />
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-muted-foreground hover:text-destructive"
                      disabled={isPending}
                      aria-label={dict.deleteAriaLabel}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  }
                  title={dict.confirmDeleteTransaction.title}
                  description={dict.confirmDeleteTransaction.description}
                  cancelLabel={dict.confirmDeleteTransaction.cancel}
                  confirmLabel={dict.confirmDeleteTransaction.confirm}
                  pendingLabel={dict.confirmDeleteTransaction.confirming}
                  onConfirm={() => handleDelete(item.row.id)}
                />
              </div>
            </div>
          </div>
          ),
        )}
      </div>
    </>
  );
}
