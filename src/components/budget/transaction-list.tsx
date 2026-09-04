"use client";

import { useTransition } from "react";
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
import { deleteTransactionAction } from "@/app/dashboard/budget/actions";
import { TransactionDialog, type TransactionRow } from "@/components/budget/transaction-dialog";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type TransactionListRow = TransactionRow & {
  categoryName: string;
  type: "INCOME" | "EXPENSE";
};

const frequencyLabelKey = {
  WEEKLY: "frequencyWeekly",
  MONTHLY: "frequencyMonthly",
  YEARLY: "frequencyYearly",
} as const satisfies Record<NonNullable<TransactionRow["recurrenceFrequency"]>, keyof Dictionary["budget"]>;

export function TransactionList({
  transactions,
  categories,
  dict,
  locale,
}: {
  transactions: TransactionListRow[];
  categories: CategoryRow[];
  dict: Dictionary["budget"];
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
    startTransition(() => deleteTransactionAction(id));
  }

  if (transactions.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {dict.emptyTransactions}
      </p>
    );
  }

  return (
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
                    tx.type === "INCOME"
                      ? "border-chart-5/30 text-chart-5"
                      : "border-destructive/30 text-destructive"
                  }
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
            <TableCell
              className={
                "text-right font-medium tabular-nums " +
                (tx.type === "INCOME" ? "text-chart-5" : "text-destructive")
              }
            >
              {tx.type === "INCOME" ? "+" : "-"}
              {numberFormat.format(tx.amount)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <TransactionDialog
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
  );
}
