// GAP-12: per-category monthly spending caps. Kept dependency-free apart
// from zod (like safe-to-spend-calc.ts) so the maths and the form parsing
// are unit-testable without React, Prisma or a request.
//
// Shared by both budgets: the household (BudgetCategory) and personal
// (PersonalBudgetCategory) category actions parse the same form field with
// `monthlyLimitField`, and both pages fold the limits into PeriodSummary's
// totals with `withCategoryLimits`. The two data layers stay separate (see
// docs/archive/PERSONAL_BUDGET_UNIFICATION.md §1); only this logic is shared.

import { z } from "zod";
import { computeCategoryRollover } from "@/lib/budget-rollover-calc";
import type { CategoryEnvelope } from "@/lib/safe-to-spend-calc";

/**
 * The CategoryManager form's optional "Monthly limit" input. An empty (or
 * missing) field means "no limit" and parses to `null`, which also clears an
 * existing limit on edit. Anything else must be a positive number: a limit
 * of 0 would read as "permanently over budget" rather than "no limit", so
 * it's rejected instead of silently treated as either.
 */
export const monthlyLimitField = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : Number(trimmed);
  },
  z
    .number({ error: "Monthly limit must be a number" })
    .positive("Monthly limit must be greater than 0")
    .nullable(),
);

/**
 * Only EXPENSE categories can carry a cap ("spending" limit). Income and
 * savings categories always store null, so switching a form field on the
 * client can never leave a stray limit on a category PeriodSummary would
 * then draw against.
 */
export function limitForType(
  type: "INCOME" | "EXPENSE" | "SAVINGS",
  limit: number | null,
): number | null {
  return type === "EXPENSE" ? limit : null;
}

/**
 * GAP-21's "Roll unspent budget over" checkbox (see budget-rollover-calc.ts).
 * A native checkbox posts "on" when ticked and nothing at all when not, so
 * anything but "on" (or an explicit "true") is off — including the field
 * being absent because the dialog didn't render it (income/savings).
 */
export const rolloverEnabledField = z.preprocess(
  (value) => value === "on" || value === "true",
  z.boolean(),
);

/**
 * Rollover carries forward what's left of a limit, so without one there's
 * nothing to carry. Stored false whenever the (already type-filtered)
 * limit is null, so clearing a limit also clears the flag instead of
 * leaving it to silently come back the next time a limit is set.
 */
export function rolloverForLimit(limit: number | null, enabled: boolean): boolean {
  return limit != null && enabled;
}

export type LimitProgress = {
  /** spent / limit as a percentage, unclamped (150 = 50% over). */
  percent: number;
  /** `percent` clamped to 0–100, for the bar's CSS width. */
  fillPercent: number;
  /** Strictly past the limit. Spending exactly the limit is "on budget". */
  over: boolean;
  /** UX-115: at {@link NEAR_LIMIT_PERCENT} or more of the limit but not
   * past it, the "Almost at limit" state. Never true together with `over`. */
  near: boolean;
};

/**
 * How far into its monthly limit a category's spending is. Returns null when
 * there is no usable limit, so the caller falls back to the old
 * proportional-to-the-other-categories bar.
 */
export function limitProgress(spent: number, limit: number | null | undefined): LimitProgress | null {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return null;
  const percent = (Math.max(spent, 0) / limit) * 100;
  return {
    percent,
    fillPercent: Math.min(percent, 100),
    over: percent > 100,
    near: percent >= NEAR_LIMIT_PERCENT && percent <= 100,
  };
}

/** Structurally the same as CategoryBreakdown's `CategoryTotal`. */
export type LimitedTotal = { id: string; name: string; total: number; limit?: number | null };

/**
 * Attach each category's `monthlyLimit` to its row in a per-category totals
 * list (PeriodSummary's expenseByCategory). A capped category with no
 * spending yet this month is appended with a zero total, so "0 / 3,000" is
 * visible from the first day of the month rather than the cap only showing
 * up once something is logged against it. Rows whose id isn't a category
 * (the personal budget's `shared:` mirror rows) pass through with no limit.
 */
export function withCategoryLimits(
  totals: { id: string; name: string; total: number }[],
  categories: { id: string; name: string; monthlyLimit: number | null }[],
): LimitedTotal[] {
  const limits = new Map(categories.map((c) => [c.id, c.monthlyLimit]));
  const rows: LimitedTotal[] = totals.map((row) => ({
    ...row,
    limit: limits.get(row.id) ?? null,
  }));
  const present = new Set(totals.map((row) => row.id));
  for (const category of categories) {
    if (category.monthlyLimit != null && !present.has(category.id)) {
      rows.push({ id: category.id, name: category.name, total: 0, limit: category.monthlyLimit });
    }
  }
  return rows;
}

/** UX-108: a category counts as "near its limit" from this share of it. */
export const NEAR_LIMIT_PERCENT = 90;

export type LimitAlert = {
  id: string;
  name: string;
  spent: number;
  /** The envelope the bar is drawn against: the monthly limit plus any
   * rollover carried in (GAP-21), the same figure Insights shows. */
  available: number;
  over: boolean;
  /** spent / available as a percentage, unclamped. */
  percent: number;
};

/**
 * UX-108: the capped categories at {@link NEAR_LIMIT_PERCENT} or more of
 * their limit, for the budget Overview. Takes the same rows Insights'
 * "Expenses by category" is drawn from, so both tabs agree on what is over.
 * Over ones come first, then by how far in each is, so the worst is on top.
 * Rows with no usable limit (and the personal budget's `shared:` mirror
 * rows) never qualify.
 */
export function categoriesNearLimit(
  rows: { id: string; name: string; total: number; limit?: number | null; carried?: number | null }[],
): LimitAlert[] {
  const alerts: LimitAlert[] = [];
  for (const row of rows) {
    if (row.limit == null) continue;
    const available = row.limit + (row.carried ?? 0);
    const progress = limitProgress(row.total, available);
    if (!progress || progress.percent < NEAR_LIMIT_PERCENT) continue;
    alerts.push({
      id: row.id,
      name: row.name,
      spent: row.total,
      available,
      over: progress.over,
      percent: progress.percent,
    });
  }
  return alerts.sort((a, b) => Number(b.over) - Number(a.over) || b.percent - a.percent);
}

/**
 * UX-138: each EXPENSE category with a monthly limit, as the envelope the
 * month may spend there (limit plus any GAP-21 rollover carried in) and what
 * is already spent in it, for computeStillBudgeted. `transactions` is any
 * window that covers the rollover lookback and the viewed month. Uses the
 * same envelope the "Near or over their limit" list is drawn against, so
 * Safe to spend and that list agree on what is left.
 */
export function categoryEnvelopes({
  categories,
  transactions,
  monthStart,
  monthEnd,
  startDay = 1,
}: {
  categories: {
    id: string;
    type: "INCOME" | "EXPENSE" | "SAVINGS";
    monthlyLimit: number | null;
    rolloverEnabled: boolean;
    createdAt: Date;
  }[];
  transactions: { categoryId: string; type: "INCOME" | "EXPENSE" | "SAVINGS"; amount: number; date: Date }[];
  monthStart: Date;
  monthEnd: Date;
  /** UX-134: the household's budget month start day, for the rollover. */
  startDay?: number;
}): CategoryEnvelope[] {
  const spentById = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE" || t.date < monthStart || t.date >= monthEnd) continue;
    spentById.set(t.categoryId, (spentById.get(t.categoryId) ?? 0) + t.amount);
  }
  const envelopes: CategoryEnvelope[] = [];
  for (const category of categories) {
    const limit = limitForType(category.type, category.monthlyLimit);
    if (limit == null || !Number.isFinite(limit) || limit <= 0) continue;
    const rollover = computeCategoryRollover({
      category: { ...category, monthlyLimit: limit },
      transactions,
      monthStart,
      startDay,
    });
    envelopes.push({
      id: category.id,
      spent: spentById.get(category.id) ?? 0,
      available: rollover?.available ?? limit,
    });
  }
  return envelopes;
}
