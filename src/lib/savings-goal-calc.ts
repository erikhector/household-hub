// GAP-22: savings goals on a SAVINGS budget category — a target amount,
// optionally by a date. Kept dependency-free apart from zod (like
// budget-category-limit.ts and safe-to-spend-calc.ts) so the maths and the
// form parsing are unit-testable without React, Prisma or a request.
//
// Shared by both budgets the same way GAP-12's monthly limit is: the
// household (BudgetCategory) and personal (PersonalBudgetCategory) category
// actions parse the same form fields with `goalAmountField`/`goalDateField`
// and filter them with `goalForType`, and both pages feed
// `computeSavingsGoalProgress` into the shared SavingsGoals card. The two
// data layers stay separate (see docs/archive/PERSONAL_BUDGET_UNIFICATION.md
// §1); only this logic is shared.
//
// Deliberately informational only (BACKLOG.md's Guardrails: no
// streaks or loss-aversion framing on money): nothing here feeds a
// notification, a status colour or a transaction check. A goal whose date
// has passed just says so, neutrally, and keeps showing what's left.

import { z } from "zod";

/**
 * The CategoryManager form's optional "Savings goal" amount. Same rules as
 * GAP-12's monthlyLimitField: empty (or missing) means "no goal" and parses
 * to `null`, which also clears an existing goal on edit; anything else must
 * be a positive number, since a goal of 0 is "reached" from day one and
 * reads as a mistake rather than a target.
 */
export const goalAmountField = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : Number(trimmed);
  },
  z
    .number({ error: "Savings goal must be a number" })
    .positive("Savings goal must be greater than 0")
    .nullable(),
);

const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The optional "Reach it by" date, as a native `<input type="date">` posts
 * it (`YYYY-MM-DD`). Parsed to UTC midnight of that day — the same instant
 * `new Date("YYYY-MM-DD")` gives a transaction's date — so the calendar day
 * round-trips through the edit form (`toISOString().slice(0, 10)`) and
 * computeSavingsGoalProgress's UTC read regardless of the server's zone.
 *
 * A date in the past is accepted on purpose: rejecting it would stop the
 * user from saving an unrelated edit (a rename) once the date has gone by,
 * and the card already handles a passed date gracefully.
 */
export const goalDateField = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (trimmed === "") return null;
    const match = DATE_INPUT_RE.exec(trimmed);
    if (!match) return "invalid";
    const [, y, m, d] = match.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    // Rejects rollovers like 2026-02-31 → Mar 3 rather than silently
    // storing a different day than the one typed.
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
      return "invalid";
    }
    return date;
  },
  z.date({ error: "Goal date must be a valid date" }).nullable(),
);

/**
 * Only SAVINGS categories can carry a goal (money put aside towards
 * something), so income and expense categories always store null for both
 * fields — the counterpart of GAP-12's `limitForType`, which keeps a cap
 * off everything but EXPENSE. A date without an amount is dropped too: it
 * has nothing to count down towards, and keeping it would silently bring an
 * old date back the next time an amount is set.
 */
export function goalForType(
  type: "INCOME" | "EXPENSE" | "SAVINGS",
  goalAmount: number | null,
  goalDate: Date | null,
): { goalAmount: number | null; goalDate: Date | null } {
  if (type !== "SAVINGS" || goalAmount == null) return { goalAmount: null, goalDate: null };
  return { goalAmount, goalDate };
}

export type SavingsGoalStatus =
  /** Saved at least the goal amount. */
  | "reached"
  /** A goal with no date: progress only, no monthly pace. */
  | "noDate"
  /** The goal day is today or later: a monthly pace is suggested. */
  | "inProgress"
  /** The goal day is before today and the goal isn't reached yet. */
  | "datePassed";

export type SavingsGoalProgress = {
  status: SavingsGoalStatus;
  /** What's been saved, floored at 0 (a net withdrawal isn't "negative
   * progress" on the bar). */
  saved: number;
  goal: number;
  /** goal − saved, never below 0. */
  remaining: number;
  /** saved / goal as a percentage, unclamped (120 = 20% past the goal). */
  percent: number;
  /** `percent` clamped to 0–100, for the bar's CSS width. */
  fillPercent: number;
  /**
   * Calendar months left to save in, *counting the current one* — a goal
   * dated later this month still has this month to go, so it's 1, never 0,
   * while status is "inProgress". Null for every other status.
   */
  monthsLeft: number | null;
  /** remaining / monthsLeft — the "save ~X/month" figure. Null unless
   * status is "inProgress". */
  perMonth: number | null;
};

// Half a cent: saving 999.999 towards 1,000 counts as reached, so float
// noise from summing many transactions can't leave a goal stuck at "0.00
// left".
const EPSILON = 0.005;

/**
 * How far a SAVINGS category is towards its goal, and — when it has a date
 * that hasn't passed — how much a month it would take to get there.
 *
 * `today` is read in the server's local time (the budget pages' month
 * convention, see budget-date-utils.ts), `goalDate` in UTC (how
 * goalDateField stores the picked day), so both compare as plain calendar
 * days. The monthly pace spreads what's left evenly over the months from
 * `today`'s through the goal's, inclusive: saving towards a December goal
 * in late September means four more deposits (Sep, Oct, Nov, Dec), which is
 * how a recurring monthly saving (a RecurringTemplate) would actually
 * contribute. A goal dated later this month has one month left — the whole
 * remainder — rather than a division by zero.
 *
 * Returns null when there's no usable goal amount, so callers can just
 * skip the category.
 */
export function computeSavingsGoalProgress({
  saved,
  goalAmount,
  goalDate,
  today,
}: {
  saved: number;
  goalAmount: number | null | undefined;
  goalDate: Date | null | undefined;
  today: Date;
}): SavingsGoalProgress | null {
  if (goalAmount == null || !Number.isFinite(goalAmount) || goalAmount <= 0) return null;

  const safeSaved = Number.isFinite(saved) ? Math.max(saved, 0) : 0;
  const reached = safeSaved >= goalAmount - EPSILON;
  const remaining = reached ? 0 : goalAmount - safeSaved;
  const percent = (safeSaved / goalAmount) * 100;
  const base = {
    saved: safeSaved,
    goal: goalAmount,
    remaining,
    percent,
    fillPercent: Math.min(percent, 100),
  };

  if (reached) return { ...base, status: "reached", monthsLeft: null, perMonth: null };
  if (goalDate == null || Number.isNaN(goalDate.getTime())) {
    return { ...base, status: "noDate", monthsLeft: null, perMonth: null };
  }

  const goalDay = Date.UTC(goalDate.getUTCFullYear(), goalDate.getUTCMonth(), goalDate.getUTCDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (goalDay < todayDay) return { ...base, status: "datePassed", monthsLeft: null, perMonth: null };

  const monthsLeft =
    goalDate.getUTCFullYear() * 12 +
    goalDate.getUTCMonth() -
    (today.getFullYear() * 12 + today.getMonth()) +
    1;
  return { ...base, status: "inProgress", monthsLeft, perMonth: remaining / monthsLeft };
}

/**
 * Every SAVINGS category with a goal, paired with its progress, in the
 * order given — the SavingsGoals card's rows. `savedByCategory` is each
 * category's all-time SAVINGS total; a goal category missing from it has
 * saved nothing yet.
 */
export function savingsGoalRows<
  C extends {
    id: string;
    name: string;
    type: "INCOME" | "EXPENSE" | "SAVINGS";
    goalAmount: number | null;
    goalDate: Date | null;
  },
>(
  categories: C[],
  savedByCategory: Map<string, number>,
  today: Date,
): { id: string; name: string; goalDate: Date | null; progress: SavingsGoalProgress }[] {
  const rows = [];
  for (const category of categories) {
    if (category.type !== "SAVINGS") continue;
    const progress = computeSavingsGoalProgress({
      saved: savedByCategory.get(category.id) ?? 0,
      goalAmount: category.goalAmount,
      goalDate: category.goalDate,
      today,
    });
    if (progress) rows.push({ id: category.id, name: category.name, goalDate: category.goalDate, progress });
  }
  return rows;
}
