// Pure aggregation logic for the "safe to spend" hero stat — see
// REQUIREMENTS.md's "Safe to spend" subsection under Budgeting. Kept
// dependency-free (no Prisma import) so it's unit-testable with plain
// fixtures; src/app/dashboard/budget/page.tsx is the only caller, feeding it
// data from the same `transactions` query it already runs for the rest of
// the page.

export type SafeToSpendTransaction = {
  categoryId: string;
  categoryName: string;
  // Only EXPENSE transactions feed the "not yet logged" recurring estimate
  // below (filtered out alongside INCOME by the `type !== "EXPENSE"`
  // check) — this type only needs to accept INCOME/SAVINGS too so callers
  // can pass a household's/user's full transaction list as-is, without
  // filtering it down themselves first. Savings still reduces the headline
  // number, just via the separate `savingsSoFar` total below rather than
  // this per-transaction list.
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  amount: number;
  date: Date;
  isRecurring: boolean;
};

export type ExpectedRecurringExpense = {
  categoryId: string;
  categoryName: string;
  amount: number;
};

// Ratio of income-so-far below which a still-positive `safeToSpend` counts
// as "tight" rather than "healthy" — see the "status" doc comment below.
const TIGHT_THRESHOLD_RATIO = 0.1;

export type SafeToSpendStatus = "over" | "tight" | "healthy";

export type SafeToSpendResult = {
  /** Income so far this month, minus expenses so far this month, minus
   * savings so far this month, minus the sum of `expectedRecurring` amounts
   * below. */
  safeToSpend: number;
  /** Recurring expense categories estimated as "expected but not yet
   * logged" this month, sorted largest-first for the breakdown UI. */
  expectedRecurring: ExpectedRecurringExpense[];
  /** Calmer three-way read on `safeToSpend`, for copy/color in the UI (see
   * JOY_GAP_BACKLOG.md item 3): "over" once spent past zero, "tight" once
   * what's left drops under `TIGHT_THRESHOLD_RATIO` of this month's income
   * so far, "healthy" otherwise. Ratio-based (not a fixed amount) so it
   * holds up across households and currencies; with no income logged yet
   * this month there's no ratio to judge "tight" against, so a non-negative
   * balance reads as "healthy" rather than guessing.
   */
  status: SafeToSpendStatus;
};

/**
 * Estimates recurring EXPENSE categories that haven't posted a transaction
 * yet this month, and derives the headline "safe to spend" number from
 * them.
 *
 * Algorithm (see AGENT_TASKS_PHASE2.md task 5): for every EXPENSE category
 * with at least one `isRecurring` transaction dated before this month,
 * check whether that category already has *any* transaction dated in this
 * month; if not, take the amount of its most recent recurring transaction
 * (by date) as the "expected but not yet logged" amount for that category.
 * Subtract the sum of all such amounts from this month's income-so-far
 * minus expense-so-far minus savings-so-far — savings put aside is money
 * that isn't safe to spend either, same as an expense already paid.
 */
export function computeSafeToSpend({
  transactions,
  monthStart,
  monthEnd,
  incomeSoFar,
  expenseSoFar,
  savingsSoFar,
}: {
  transactions: SafeToSpendTransaction[];
  monthStart: Date;
  monthEnd: Date;
  incomeSoFar: number;
  expenseSoFar: number;
  savingsSoFar: number;
}): SafeToSpendResult {
  const expenseTxByCategory = new Map<string, SafeToSpendTransaction[]>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    const existing = expenseTxByCategory.get(t.categoryId);
    if (existing) {
      existing.push(t);
    } else {
      expenseTxByCategory.set(t.categoryId, [t]);
    }
  }

  const expectedRecurring: ExpectedRecurringExpense[] = [];

  for (const categoryTransactions of expenseTxByCategory.values()) {
    const priorRecurring = categoryTransactions.filter(
      (t) => t.isRecurring && t.date < monthStart,
    );
    if (priorRecurring.length === 0) continue;

    const postedThisMonth = categoryTransactions.some(
      (t) => t.date >= monthStart && t.date < monthEnd,
    );
    if (postedThisMonth) continue;

    const mostRecent = priorRecurring.reduce((latest, t) =>
      t.date > latest.date ? t : latest,
    );
    expectedRecurring.push({
      categoryId: mostRecent.categoryId,
      categoryName: mostRecent.categoryName,
      amount: mostRecent.amount,
    });
  }

  expectedRecurring.sort((a, b) => b.amount - a.amount);

  const expectedTotal = expectedRecurring.reduce((sum, e) => sum + e.amount, 0);
  const safeToSpend = incomeSoFar - expenseSoFar - savingsSoFar - expectedTotal;

  const status: SafeToSpendStatus =
    safeToSpend < 0
      ? "over"
      : incomeSoFar > 0 && safeToSpend <= incomeSoFar * TIGHT_THRESHOLD_RATIO
        ? "tight"
        : "healthy";

  return {
    safeToSpend,
    expectedRecurring,
    status,
  };
}
