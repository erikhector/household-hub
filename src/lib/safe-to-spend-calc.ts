// Pure aggregation logic for the "safe to spend" hero stat — "Remaining
// after expenses and savings" in the UI — see REQUIREMENTS.md's "Safe to
// spend" subsection under Budgeting. Kept dependency-free (no Prisma import)
// so it's unit-testable with plain fixtures. Callers: the household budget
// page directly, and Personal Budget + the dashboard through
// src/lib/personal-budget-position.ts.

import {
  isPlannedItemCounted,
  type PlannedExpenseStatus,
  type PlannedItemType,
} from "@/lib/planned-expense-calc";

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
   * savings"), "INCOME" for a recurring income that hasn't come in yet
   * ("expected income" — added to the number rather than subtracted);
   * anything else is a due payment. Unset means "EXPENSE", which is all the
   * transaction-based estimate below ever produces. */
  type?: "EXPENSE" | "SAVINGS" | "INCOME";
  /** The unpaid part of the user's share of a shared bill that's already
   * logged — see settle-up-calc.ts's computeBillPositions — rather than a
   * recurring item that hasn't been logged at all. Display only. */
  leftDue?: boolean;
  /** UX-138: the budget category a due payment belongs to, when it has
   * one. Lets "still budgeted" skip what a due bill already takes out of
   * the same category's limit, so a limited category isn't counted twice. */
  budgetCategoryId?: string;
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

// UX-154: "unset" is the fourth status. With no income, logged or expected,
// there is nothing to judge a balance against, and a 0.00 would read as a
// green "on track" about a budget nobody has set up. It renders neutral,
// with no sign, and points at adding income.
export type SafeToSpendStatus = "over" | "tight" | "healthy" | "unset";

/** Each term of the headline number, for the breakdown under it. All
 * non-negative; `safeToSpend = income + dueIncome - expense - savings
 * - owedFromEarlier - duePayments - dueSavings - stillBudgeted`. */
export type SafeToSpendBreakdown = {
  income: number;
  /** Recurring income still due this month — see computeSafeToSpend. */
  dueIncome: number;
  expense: number;
  savings: number;
  owedFromEarlier: number;
  duePayments: number;
  dueSavings: number;
  /** UX-138: the unspent remainder of every category with a monthly limit
   * (see computeStillBudgeted). Money already earmarked for that category,
   * so it isn't safe to spend elsewhere. */
  stillBudgeted: number;
};

/** One part of the month's money in the Safe to spend card's split bar. */
export type IncomeSplitPart = {
  key: "spent" | "saved" | "due" | "budgeted" | "safe";
  value: number;
};

/** Chart redesign (Oct 2026): the month's income (logged and still
 * expected) split into where it goes — spent, saved, still due (bills,
 * savings and anything owed from earlier), kept for categories' unspent
 * limits, and what's safe to spend — the same terms as the arithmetic, so the
 * bar and "How we got this number" always agree. Zero parts are left out.
 * `scale` is what the bar's full width stands for: the income, or, when the
 * month is over (more going out than coming in), everything going out, with
 * `over` saying by how much. Null with no income to split. */
export function incomeSplit(
  breakdown: SafeToSpendBreakdown,
  safeToSpend: number,
): { parts: IncomeSplitPart[]; income: number; scale: number; over: number } | null {
  const income = breakdown.income + breakdown.dueIncome;
  if (income <= 0) return null;
  const parts: IncomeSplitPart[] = [
    { key: "spent", value: breakdown.expense },
    { key: "saved", value: breakdown.savings },
    { key: "due", value: breakdown.duePayments + breakdown.dueSavings + breakdown.owedFromEarlier },
    { key: "budgeted", value: breakdown.stillBudgeted },
    { key: "safe", value: Math.max(0, safeToSpend) },
  ];
  const kept = parts.filter((p) => p.value > 0.005);
  const going = kept.filter((p) => p.key !== "safe").reduce((sum, p) => sum + p.value, 0);
  const over = Math.max(0, going - income);
  return { parts: kept, income, scale: Math.max(income, going), over };
}

/** UX-116: true while there is nothing to compute a safe-to-spend number
 * from: nothing recorded at all, so no income (logged or expected), no
 * recurring or due items, and no logged expenses or savings (a month with
 * spending but no income is a real negative number and must stay visible).
 * The card then shows a setup prompt instead of a green "+0.00", since "you're
 * in good shape" would be a claim about data that isn't there. */
export function needsSafeToSpendSetup(
  breakdown: SafeToSpendBreakdown,
  expectedRecurring: readonly unknown[],
): boolean {
  const EPS = 0.005;
  return (
    breakdown.income < EPS &&
    breakdown.dueIncome < EPS &&
    breakdown.duePayments < EPS &&
    breakdown.dueSavings < EPS &&
    breakdown.owedFromEarlier < EPS &&
    breakdown.expense < EPS &&
    breakdown.savings < EPS &&
    expectedRecurring.length === 0
  );
}

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

/** A category with a monthly limit, for {@link computeStillBudgeted}. */
export type CategoryEnvelope = {
  id: string;
  /** EXPENSE logged in this category in the viewed month. */
  spent: number;
  /** What the month may spend there: the limit plus any rollover carried
   * in (GAP-21), the same envelope Insights draws its bar against. */
  available: number;
};

/**
 * UX-138: how much of the month's limits is still unspent, as one number.
 * A category with a limit has money earmarked for it, so what's left of
 * that limit is not "safe to spend" on something else, even though it
 * hasn't been spent yet. Without this a 3,000 food limit with nothing logged
 * on the 1st left all 3,000 in the headline, and the headline then fell as
 * the food was bought.
 *
 * Per category: `available - spent - what a due payment in it already takes`,
 * never below zero. The floor matters twice: an overspent category has no
 * remainder to hold back (the overspend is already in the expenses
 * total, so a negative remainder would add money back), and a due bill
 * in the same category is already subtracted as a due payment, so only the
 * rest of the limit is held back, not the bill twice. Categories without a
 * limit are not in `categories`, and contribute nothing.
 */
export function computeStillBudgeted(
  categories: readonly CategoryEnvelope[],
  expectedRecurring: readonly ExpectedRecurringExpense[],
): number {
  const dueByCategory = new Map<string, number>();
  for (const e of expectedRecurring) {
    if (!e.budgetCategoryId) continue;
    if (e.type === "SAVINGS" || e.type === "INCOME") continue;
    dueByCategory.set(e.budgetCategoryId, (dueByCategory.get(e.budgetCategoryId) ?? 0) + e.amount);
  }
  let total = 0;
  for (const c of categories) {
    total += Math.max(0, c.available - c.spent - (dueByCategory.get(c.id) ?? 0));
  }
  return total;
}

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
  stillBudgeted = 0,
  expectedRecurring,
}: {
  incomeSoFar: number;
  expenseSoFar: number;
  savingsSoFar: number;
  /** Personal budget only: what the user still owed household members, or
   * still owed on shared bills, when the month started — debts carry over
   * until they're cleared (see src/lib/personal-budget-position.ts). */
  owedFromEarlier?: number;
  /** UX-138: computeStillBudgeted's total. Computed by the caller because
   * it needs the categories' limits, which this function never sees. */
  stillBudgeted?: number;
  expectedRecurring: ExpectedRecurringExpense[];
}): { safeToSpend: number; status: SafeToSpendStatus; breakdown: SafeToSpendBreakdown } {
  let duePayments = 0;
  let dueSavings = 0;
  let dueIncome = 0;
  for (const e of expectedRecurring) {
    if (e.type === "SAVINGS") dueSavings += e.amount;
    else if (e.type === "INCOME") dueIncome += e.amount;
    else duePayments += e.amount;
  }
  const safeToSpend =
    incomeSoFar +
    dueIncome -
    expenseSoFar -
    savingsSoFar -
    owedFromEarlier -
    duePayments -
    dueSavings -
    stillBudgeted;

  // "Tight" is judged against the month's whole expected income, due
  // salary included — otherwise a future month (nothing logged yet) would
  // never have an income to compare against.
  const expectedIncome = incomeSoFar + dueIncome;
  // UX-154: a non-negative balance with no income to judge it against is
  // "unset", not "healthy". Limits with no income already push the balance
  // below zero (stillBudgeted), so they read "over" before reaching here.
  const status: SafeToSpendStatus =
    safeToSpend < 0
      ? "over"
      : expectedIncome < 0.005
        ? "unset"
        : safeToSpend <= expectedIncome * TIGHT_THRESHOLD_RATIO
          ? "tight"
          : "healthy";

  return {
    safeToSpend,
    status,
    breakdown: {
      income: incomeSoFar,
      dueIncome,
      expense: expenseSoFar,
      savings: savingsSoFar,
      owedFromEarlier,
      duePayments,
      dueSavings,
      stillBudgeted,
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

/** A planned bill or planned income (PlannedExpense) with its status for
 * the month being viewed — see getPlannedExpenseStatus in
 * src/lib/planned-expense-calc.ts. */
export type SafeToSpendPlannedExpense = {
  id: string;
  name: string;
  amount: number;
  status: PlannedExpenseStatus;
  /** Its category's type. Unset means "EXPENSE", a bill. */
  type?: PlannedItemType;
  /** UX-138: its category, so a due bill isn't also held back as still
   * budgeted in that category's limit. */
  categoryId?: string;
};

/**
 * Works out what's still due this month and derives the headline "safe to
 * spend" number from it.
 *
 * Recurring items (`templates`) come first: every active one still "due"
 * this month is subtracted at its full amount, payments and savings alike,
 * and a due income item (a salary not logged yet) is added at its full
 * amount as "expected income". Without that, any month the salary hadn't
 * been logged in yet — every future month — showed the recurring bills and
 * savings but none of the income paying for them.
 * One that's "posted" (a transaction was logged from it) counts only through
 * that transaction, even when it was logged for less than the item says — a
 * 5000 saving logged as 3000 means 3000 was saved, not that 2000 is still
 * owed. "Acknowledged" counts as handled.
 *
 * Planned bills (`plannedExpenses`, one-off bills with a due date) are a
 * separate input rather than extra `templates` on purpose: templates also
 * build `templateCategoryIds` below, which switches off the "this repeats"
 * estimate for their category, and a one-off bill must never do that. Every
 * one that's "due" or "overdue" is subtracted at its full amount under its
 * own name; a "paid" one already counts through its transaction in
 * `expenseSoFar`, and an "upcoming" one belongs to a later month. Planned
 * income (a bonus, a tax refund) comes in the same list with `type:
 * "INCOME"` and is added as expected income, but only while "due": see
 * isPlannedItemCounted for why late income stops counting.
 *
 * Limited categories (`categoryLimits`, UX-138) then hold back what is still
 * unspent of their limit: see computeStillBudgeted.
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
  plannedExpenses = [],
  owedFromEarlier = 0,
  categoryLimits = [],
}: {
  transactions: SafeToSpendTransaction[];
  monthStart: Date;
  monthEnd: Date;
  incomeSoFar: number;
  expenseSoFar: number;
  savingsSoFar: number;
  /** Active recurring items with their status this month. */
  templates?: SafeToSpendTemplate[];
  /** Planned bills with their status this month. */
  plannedExpenses?: SafeToSpendPlannedExpense[];
  owedFromEarlier?: number;
  /** UX-138: the limited categories' envelopes this month. */
  categoryLimits?: CategoryEnvelope[];
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
      budgetCategoryId: mostRecent.categoryId,
    });
  }

  for (const t of templates) {
    if (t.status !== "due") continue;
    expectedRecurring.push({
      categoryId: t.id,
      categoryName: t.name,
      amount: t.amount,
      type: t.type,
      budgetCategoryId: t.categoryId,
    });
  }

  for (const p of plannedExpenses) {
    const type = p.type ?? "EXPENSE";
    if (!isPlannedItemCounted(p.status, type)) continue;
    expectedRecurring.push({
      categoryId: p.id,
      categoryName: p.name,
      amount: p.amount,
      type,
      budgetCategoryId: p.categoryId,
    });
  }

  expectedRecurring.sort((a, b) => b.amount - a.amount);

  const { safeToSpend, status, breakdown } = deriveSafeToSpend({
    incomeSoFar,
    expenseSoFar,
    savingsSoFar,
    owedFromEarlier,
    stillBudgeted: computeStillBudgeted(categoryLimits, expectedRecurring),
    expectedRecurring,
  });

  return {
    safeToSpend,
    breakdown,
    expectedRecurring,
    status,
  };
}
