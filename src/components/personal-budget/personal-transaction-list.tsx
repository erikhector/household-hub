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
import { deletePersonalTransactionAction } from "@/app/dashboard/personal-budget/actions";
import {
  PersonalTransactionDialog,
  type PersonalTransactionRow,
} from "@/components/personal-budget/personal-transaction-dialog";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type PersonalTransactionListRow = PersonalTransactionRow & {
  categoryName: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
};

// This user's own share of a posted split household Transaction (see
// PERSONAL_HOUSEHOLD_BUDGET_LINK.md) — merged straight into the normal
// transaction list, badged "Shared", rather than shown in a separate
// section. Read-only here: a "View in {household} Budget" link is the only
// control, since the household budget stays the one place these get
// logged, edited, or deleted.
export type SharedPostedRow = {
  id: string;
  categoryName: string;
  /** This user's own share (TransactionSplit.amountOwed) — never the
   * transaction's full amount. */
  amount: number;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  date: Date;
  householdName: string;
  paidByName: string | null;
};

type Row =
  | { kind: "personal"; row: PersonalTransactionListRow }
  | { kind: "shared"; row: SharedPostedRow };

function amountColor(type: "INCOME" | "EXPENSE" | "SAVINGS") {
  if (type === "INCOME") return "text-chart-5";
  if (type === "SAVINGS") return "text-chart-2";
  return "text-destructive";
}

function amountSign(type: "INCOME" | "EXPENSE" | "SAVINGS") {
  if (type === "INCOME") return "+";
  if (type === "SAVINGS") return "→";
  return "-";
}

function categoryBadgeClass(type: "INCOME" | "EXPENSE" | "SAVINGS") {
  if (type === "INCOME") return "border-chart-5/30 text-chart-5";
  if (type === "SAVINGS") return "border-chart-2/30 text-chart-2";
  return "border-destructive/30 text-destructive";
}

const frequencyLabelKey = {
  WEEKLY: "frequencyWeekly",
  MONTHLY: "frequencyMonthly",
  YEARLY: "frequencyYearly",
} as const satisfies Record<
  NonNullable<PersonalTransactionRow["recurrenceFrequency"]>,
  keyof Dictionary["personalBudget"]
>;

export function PersonalTransactionList({
  transactions,
  sharedRows = [],
  showHouseholdName = false,
  monthKey,
  categories,
  dict,
  locale,
}: {
  transactions: PersonalTransactionListRow[];
  /** This user's own share of posted split household transactions this
   * month (see PERSONAL_HOUSEHOLD_BUDGET_LINK.md) — merged into the list
   * below, badged "Shared". */
  sharedRows?: SharedPostedRow[];
  /** Only show which household a shared row belongs to once the user is in
   * more than one — see PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6. */
  showHouseholdName?: boolean;
  /** "YYYY-MM" — reused for a shared row's "View in {household} Budget"
   * link, required whenever sharedRows is non-empty. */
  monthKey?: string;
  categories: PersonalCategoryRow[];
  dict: Dictionary["personalBudget"];
  locale: Locale;
}) {
  const [isPending, startTransition] = useTransition();
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePersonalTransactionAction(id);
      if (result.error) toast.error(result.error);
    });
  }

  const rows: Row[] = [
    ...transactions.map((row): Row => ({ kind: "personal", row })),
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
                    className={"max-w-[10rem] truncate " + categoryBadgeClass(item.row.type)}
                    title={item.row.categoryName}
                  >
                    {item.row.categoryName}
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" />
                    {dict.shared.sharedBadge}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="max-w-64 truncate text-muted-foreground">
                {item.row.paidByName ? format(dict.shared.paidBy, { name: item.row.paidByName }) : "—"}
                {showHouseholdName ? ` · ${item.row.householdName}` : ""}
              </TableCell>
              <TableCell className={"text-right font-medium tabular-nums " + amountColor(item.row.type)}>
                {amountSign(item.row.type)}
                {numberFormat.format(item.row.amount)}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end">
                  <Link
                    href={`/dashboard/budget?month=${monthKey}`}
                    className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground"
                    title={format(dict.shared.viewInHouseholdBudget, { household: item.row.householdName })}
                    aria-label={format(dict.shared.viewInHouseholdBudget, {
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
                  className={"max-w-[10rem] truncate " + categoryBadgeClass(item.row.type)}
                  title={item.row.categoryName}
                >
                  {item.row.categoryName}
                </Badge>
                {item.row.isRecurring && item.row.recurrenceFrequency && (
                  <Badge variant="secondary" className="gap-1">
                    <Repeat className="size-3" />
                    {dict[frequencyLabelKey[item.row.recurrenceFrequency]]}
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
                <PersonalTransactionDialog
                  dict={dict}
                  categories={categories}
                  transaction={item.row}
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
                    className={"max-w-[10rem] truncate " + categoryBadgeClass(item.row.type)}
                    title={item.row.categoryName}
                  >
                    {item.row.categoryName}
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" />
                    {dict.shared.sharedBadge}
                  </Badge>
                </div>
                <span className={"shrink-0 font-medium tabular-nums " + amountColor(item.row.type)}>
                  {amountSign(item.row.type)}
                  {numberFormat.format(item.row.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-muted-foreground">
                    {item.row.paidByName ? format(dict.shared.paidBy, { name: item.row.paidByName }) : "—"}
                    {showHouseholdName ? ` · ${item.row.householdName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{dateFormat.format(item.row.date)}</p>
                </div>
                <Link
                  href={`/dashboard/budget?month=${monthKey}`}
                  className="inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                  title={format(dict.shared.viewInHouseholdBudget, { household: item.row.householdName })}
                  aria-label={format(dict.shared.viewInHouseholdBudget, {
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
                  className={"max-w-[10rem] truncate " + categoryBadgeClass(item.row.type)}
                  title={item.row.categoryName}
                >
                  {item.row.categoryName}
                </Badge>
                {item.row.isRecurring && item.row.recurrenceFrequency && (
                  <Badge variant="secondary" className="gap-1">
                    <Repeat className="size-3" />
                    {dict[frequencyLabelKey[item.row.recurrenceFrequency]]}
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
                <PersonalTransactionDialog
                  dict={dict}
                  categories={categories}
                  transaction={item.row}
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
