// Pure aggregation logic for the "safe to spend" hero stat — "Remaining
// after expenses and savings" in the UI — see REQUIREMENTS.md's "Safe to
// spend" subsection under Budgeting. Kept dependency-free (no Prisma import)
// so it's unit-testable with plain fixtures. Callers: the household budget
// page directly, and Personal Budget + the dashboard through
// src/lib/personal-budget-position.ts.

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
  /** A stable key for the row — a category id for the transaction-based
   * estimate, a template or transaction id otherwise. */
  categoryId: string;
  /** The row's label (category, template or bill name). */
  categoryName: string;
  amount: number;
  /** "SAVINGS" for a recurring saving that hasn't been put aside yet ("due
   * savings"); anything else is a due payment. Unset means "EXPENSE", which
   * is all the transaction-based estimate below ever produces. */
  type?: "EXPENSE" | "SAVINGS";
  /** The unpaid part of the user's share of a shared bill that's already
   * logged — see settle-up-calc.ts's computeBillPositions — rather than a
   * recurring item that hasn't been logged at all. Display only. */
  leftDue?: boolean;
  // Purely additive, display-layer tags — computeSafeToSpend itself never
  // sets these (every row it produces is implicitly "personal"); a caller
  // that wants to show shared-household rows alongside them (see
  // docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md and personal-budget/page.tsx) appends
  // its own rows with `source: "shared"` before re-deriving the headline
  // number via deriveSafeToSpend below. Household-budget callers never set
  // either field and keep working exactly as before.
  source?: "personal" | "shared";
  /** Which household a `source: "shared"` row's cost is shared with — unset
   * for "personal" rows. */
  householdName?: string;
};

/** Personal budget only: the user's standing with the other members of one
 * household, as of the end of the month being viewed — shown under the
 * headline number (see src/lib/personal-budget-position.ts). */
export type HouseholdDebt = {
  householdId: string;
  householdName: string;
  /** Positive: the user owes the other members this much. Negative: they
   * owe the user. Never includes unpaid bills (see `owedToBills`). */
  owedToMembers: number;
  /** The user's unpaid share of this household's bills. */
  owedToBills: number;
};

// Ratio of income-so-far below which a still-positive `safeToSpend` counts
// as "tight" rather than "healthy" — see the "status" doc comment below.
const TIGHT_THRESHOLD_RATIO = 0.1;

export type SafeToSpendStatus = "over" | "tight" | "healthy";

/** Each term of the headline number, for the breakdown under it. All
 * non-negative; `safeToSpend = income - expense - savings - owedFromEarlier
 * - duePayments - dueSavings`. */
export type SafeToSpendBreakdown = {
  income: number;
  expense: number;
  savings: number;
  owedFromEarlier: number;
  duePayments: number;
  dueSavings: number;
};

export type SafeToSpendResult = {
  /** Income so far this month, minus expenses so far this month, minus
   * savings so far this month, minus anything still owed from earlier
   * months, minus the sum of `expectedRecurring` amounts below. */
  safeToSpend: number;
  breakdown: SafeToSpendBreakdown;
  /** Recurring expense categories estimated as "expected but not yet
   * logged" this month, sorted largest-first for the breakdown UI. */
  expectedRecurring: ExpectedRecurringExpense[];
  /** Calmer three-way read on `safeToSpend`, for copy/color in the UI (see
   * docs/archive/JOY_GAP_BACKLOG.md item 3): "over" once spent past zero, "tight" once
   * what's left drops under `TIGHT_THRESHOLD_RATIO` of this month's income
   * so far, "healthy" otherwise. Ratio-based (not a fixed amount) so it
   * holds up across households and currencies; with no income logged yet
   * this month there's no ratio to judge "tight" against, so a non-negative
   * balance reads as "healthy" rather than guessing.
   */
  status: SafeToSpendStatus;
};

/**
 * The final aggregation step of computeSafeToSpend below, pulled out so a
 * caller can re-derive the headline number and status after appending its
 * own extra `ExpectedRecurringExpense` rows to the ones computeSafeToSpend
 * already estimated — e.g. the personal budget page folding in a signed-in
 * user's due share of a *shared* household RecurringTemplate (see
 * docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md), which computeSafeToSpend's own
 * category/transaction-based estimate has no way to know about. Kept as a
 * separate exported function (rather than inlining this into
 * computeSafeToSpend) precisely so that re-derivation doesn't need to
 * duplicate the income/expense/savings/status math.
 */
export function deriveSafeToSpend({
  incomeSoFar,
  expenseSoFar,
  savingsSoFar,
  owedFromEarlier = 0,
  expectedRecurring,
}: {
  incomeSoFar: number;
  expenseSoFar: number;
  savingsSoFar: number;
  /** Personal budget only: what the user still owed household members, or
   * still owed on shared bills, when the month started — debts carry over
   * until they're cleared (see src/lib/personal-budget-position.ts). */
  owedFromEarlier?: number;
  expectedRecurring: ExpectedRecurringExpense[];
}): { safeToSpend: number; status: SafeToSpendStatus; breakdown: SafeToSpendBreakdown } {
  let duePayments = 0;
  let dueSavings = 0;
  for (const e of expectedRecurring) {
    if (e.type === "SAVINGS") dueSavings += e.amount;
    else duePayments += e.amount;
  }
  const safeToSpend =
    incomeSoFar - expenseSoFar - savingsSoFar - owedFromEarlier - duePayments - dueSavings;

  const status: SafeToSpendStatus =
    safeToSpend < 0
      ? "over"
      : incomeSoFar > 0 && safeToSpend <= incomeSoFar * TIGHT_THRESHOLD_RATIO
        ? "tight"
        : "healthy";

  return {
    safeToSpend,
    status,
    breakdown: {
      income: incomeSoFar,
      expense: expenseSoFar,
      savings: savingsSoFar,
      owedFromEarlier,
      duePayments,
      dueSavings,
    },
  };
}

/** A recurring item (RecurringTemplate/PersonalRecurringTemplate) with its
 * status for the month being viewed — see computeTemplateStatuses in
 * src/lib/recurring-template-calc.ts. */
export type SafeToSpendTemplate = {
  id: string;
  name: string;
  categoryId: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  amount: number;
  status: "posted" | "acknowledged" | "due";
};

/**
 * Works out what's still due this month and derives the headline "safe to
 * spend" number from it.
 *
 * Recurring items (`templates`) come first: every active one still "due"
 * this month is subtracted at its full amount, payments and savings alike.
 * One that's "posted" (a transaction was logged from it) counts only through
 * that transaction, even when it was logged for less than the item says — a
 * 5000 saving logged as 3000 means 3000 was saved, not that 2000 is still
 * owed. "Acknowledged" counts as handled.
 *
 * Categories without a recurring item fall back to the older estimate below,
 * so households that only ever ticked "this repeats" on a transaction keep
 * getting one. A category that has an active recurring item is skipped
 * there, so the two never count the same bill twice.
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
  templates = [],
  owedFromEarlier = 0,
}: {
  transactions: SafeToSpendTransaction[];
  monthStart: Date;
  monthEnd: Date;
  incomeSoFar: number;
  expenseSoFar: number;
  savingsSoFar: number;
  /** Active recurring items with their status this month. */
  templates?: SafeToSpendTemplate[];
  owedFromEarlier?: number;
}): SafeToSpendResult {
  const templateCategoryIds = new Set(templates.map((t) => t.categoryId));
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

  for (const [categoryId, categoryTransactions] of expenseTxByCategory) {
    if (templateCategoryIds.has(categoryId)) continue;

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

  for (const t of templates) {
    if (t.status !== "due" || t.type === "INCOME") continue;
    expectedRecurring.push({
      categoryId: t.id,
      categoryName: t.name,
      amount: t.amount,
      type: t.type,
    });
  }

  expectedRecurring.sort((a, b) => b.amount - a.amount);

  const { safeToSpend, status, breakdown } = deriveSafeToSpend({
    incomeSoFar,
    expenseSoFar,
    savingsSoFar,
    owedFromEarlier,
    expectedRecurring,
  });

  return {
    safeToSpend,
    breakdown,
    expectedRecurring,
    status,
  };
}
