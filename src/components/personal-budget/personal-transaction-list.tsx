"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Repeat, Trash2 } from "lucide-react";
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
import { deletePersonalTransactionAction } from "@/app/dashboard/personal-budget/actions";
import {
  PersonalTransactionDialog,
  type PersonalTransactionRow,
} from "@/components/personal-budget/personal-transaction-dialog";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type PersonalTransactionListRow = PersonalTransactionRow & {
  categoryName: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
};

function amountColor(type: PersonalTransactionListRow["type"]) {
  if (type === "INCOME") return "text-chart-5";
  if (type === "SAVINGS") return "text-chart-2";
  return "text-destructive";
}

function amountSign(type: PersonalTransactionListRow["type"]) {
  if (type === "INCOME") return "+";
  if (type === "SAVINGS") return "→";
  return "-";
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
  categories,
  dict,
  locale,
}: {
  transactions: PersonalTransactionListRow[];
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

  if (transactions.length === 0) {
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
        {transactions.map((tx) => (
          <TableRow key={tx.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {dateFormat.format(tx.date)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={
                    "max-w-[10rem] truncate " +
                    (tx.type === "INCOME"
                      ? "border-chart-5/30 text-chart-5"
                      : tx.type === "SAVINGS"
                        ? "border-chart-2/30 text-chart-2"
                        : "border-destructive/30 text-destructive")
                  }
                  title={tx.categoryName}
                >
                  {tx.categoryName}
                </Badge>
                {tx.isRecurring && tx.recurrenceFrequency && (
                  <Badge variant="secondary" className="gap-1">
                    <Repeat className="size-3" />
                    {dict[frequencyLabelKey[tx.recurrenceFrequency]]}
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="max-w-64 truncate text-muted-foreground">
              {tx.description || "—"}
            </TableCell>
            <TableCell className={"text-right font-medium tabular-nums " + amountColor(tx.type)}>
              {amountSign(tx.type)}
              {numberFormat.format(tx.amount)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <PersonalTransactionDialog
                  dict={dict}
                  categories={categories}
                  transaction={tx}
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                  aria-label={dict.deleteAriaLabel}
                  onClick={() => handleDelete(tx.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      </Table>
      </div>

      {/* Mobile: cards instead of a 5-column table — see InventoryTable's
          equivalent split for the same reasoning. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {transactions.map((tx) => (
          <div key={tx.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={
                    "max-w-[10rem] truncate " +
                    (tx.type === "INCOME"
                      ? "border-chart-5/30 text-chart-5"
                      : tx.type === "SAVINGS"
                        ? "border-chart-2/30 text-chart-2"
                        : "border-destructive/30 text-destructive")
                  }
                  title={tx.categoryName}
                >
                  {tx.categoryName}
                </Badge>
                {tx.isRecurring && tx.recurrenceFrequency && (
                  <Badge variant="secondary" className="gap-1">
                    <Repeat className="size-3" />
                    {dict[frequencyLabelKey[tx.recurrenceFrequency]]}
                  </Badge>
                )}
              </div>
              <span className={"shrink-0 font-medium tabular-nums " + amountColor(tx.type)}>
                {amountSign(tx.type)}
                {numberFormat.format(tx.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted-foreground" title={tx.description || undefined}>
                  {tx.description || "—"}
                </p>
                <p className="text-xs text-muted-foreground">{dateFormat.format(tx.date)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <PersonalTransactionDialog
                  dict={dict}
                  categories={categories}
                  transaction={tx}
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                  aria-label={dict.deleteAriaLabel}
                  onClick={() => handleDelete(tx.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
