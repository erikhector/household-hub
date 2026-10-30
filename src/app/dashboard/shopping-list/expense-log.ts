// MAINT-3: the shopping-trip expense helpers that registerReceiptAction and
// completeShoppingListAction share. A plain server module on purpose: the
// helpers take a household id, so they must not live in a "use server" file
// (see src/lib/use-server-exports.test.ts).

import { getLocale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { resolveShoppingExpenseCategory } from "@/lib/budget-groceries-category";
import { createMoneyFormat } from "@/lib/currency";
import type { Prisma } from "@/generated/prisma/client";

export type LoggedExpense = { transactionId: string; amount: number; categoryName: string };

/**
 * MAINT-5: the one place a shopping trip's total becomes a budget expense,
 * shared by registerReceiptAction and completeShoppingListAction. Runs on
 * the caller's transaction client, inside the same `$transaction` as the
 * stock/status writes it accounts for: logging it afterwards (as both used
 * to) meant a failed insert surfaced as a crash after stock had already
 * moved, and retrying re-applied the stock. Never estimates — a zero total
 * logs nothing and returns null. Module-private, so not a client-callable
 * endpoint despite living in a `"use server"` file.
 */
export async function logGroceriesExpense(
  tx: Prisma.TransactionClient,
  { householdId, userId, amount, description }: { householdId: string; userId: string; amount: number; description: string },
): Promise<LoggedExpense | null> {
  if (amount <= 0) return null;
  const category = await resolveShoppingExpenseCategory(tx, householdId);
  const transaction = await tx.transaction.create({
    data: {
      householdId,
      categoryId: category.id,
      amount,
      type: "EXPENSE",
      description,
      date: new Date(),
      createdByUserId: userId,
    },
    select: { id: true },
  });
  return { transactionId: transaction.id, amount, categoryName: category.name };
}

// The "Logged 123 kr to Groceries" toast. Names the category the expense
// actually went to, since that's now the household's choice (and may have
// been renamed) rather than always "Groceries".
export async function formatExpenseLogged(template: string, currencyCode: string | null, expense: LoggedExpense) {
  const locale = await getLocale();
  // GAP-13: the household's display currency, like the list itself.
  const amountLabel = createMoneyFormat(locale, currencyCode).format(expense.amount);
  return format(template, { amount: amountLabel, category: expense.categoryName });
}
