// Pure period-key and status logic for recurring budget templates — see
// prisma/schema.prisma's RecurringTemplate/RecurringTemplateAck doc comments
// for the "accounted for" model. Kept dependency-free (no Prisma import) so
// it's unit-testable with plain fixtures, same convention as
// safe-to-spend-calc.ts (also in src/lib/) and
// settle-up-calc.ts (also in src/lib/). Used identically for both the
// household budget (RecurringTemplate) and the personal budget
// (PersonalRecurringTemplate) — callers just map their Prisma rows into the
// shapes below first.

export type TemplateFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * ISO 8601 week number for a date: weeks start Monday, and week 1 is the
 * week containing the year's first Thursday.
 */
function getIsoWeek(date: Date): { isoYear: number; week: number } {
  // Copy and normalize to midnight UTC so DST/timezone don't shift the
  // day-of-week math below.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // getUTCDay(): 0 (Sun) - 6 (Sat) -> ISO 1 (Mon) - 7 (Sun).
  const isoDayOfWeek = d.getUTCDay() || 7;
  // Shift to the Thursday of this ISO week — its calendar year is the ISO
  // week-numbering year.
  d.setUTCDate(d.getUTCDate() + 4 - isoDayOfWeek);
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return { isoYear, week };
}

/**
 * The period a date falls into for a given frequency, as a stable, sortable
 * string: "YYYY-MM" for MONTHLY, "YYYY" for YEARLY, ISO-week "YYYY-Www" for
 * WEEKLY. Two dates share a period iff this returns the same string.
 */
export function getPeriodKey(date: Date, frequency: TemplateFrequency): string {
  if (frequency === "YEARLY") return String(date.getFullYear());
  if (frequency === "MONTHLY") return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  const { isoYear, week } = getIsoWeek(date);
  return `${isoYear}-W${pad2(week)}`;
}

/**
 * A template's amount converted to its per-month equivalent, so
 * WEEKLY/MONTHLY/YEARLY templates can be summed on one scale (see
 * computeFixedMonthlySummary below): a WEEKLY amount is scaled by 52/12
 * weeks-per-month and a YEARLY amount is divided by 12; MONTHLY passes
 * through unchanged.
 */
export function monthlyEquivalentAmount(amount: number, frequency: TemplateFrequency): number {
  if (frequency === "WEEKLY") return (amount * 52) / 12;
  if (frequency === "YEARLY") return amount / 12;
  return amount;
}

export type FixedItemType = "INCOME" | "EXPENSE" | "SAVINGS";

export type FixedTemplateSummaryInput = {
  amount: number;
  frequency: TemplateFrequency;
  type: FixedItemType;
  active: boolean;
  /** When this template was created — see computeFixedMonthlySummary's doc
   * comment for why this gates inclusion per viewed month. */
  createdAt: Date;
};

export type FixedMonthlySummary = {
  monthlyIncome: number;
  monthlyExpense: number;
  monthlySavings: number;
};

/**
 * The "Fixed income & costs" headline numbers: every active template's
 * amount, normalized to a monthly equivalent (see monthlyEquivalentAmount)
 * and summed by type. SAVINGS is kept as its own total rather than folded
 * into income or expense — see TransactionType's doc comment in
 * schema.prisma for why it's excluded from both. A template created on or
 * after `monthEnd` is excluded too, so a past month's headline doesn't
 * inflate with templates that didn't exist yet ("not backward propagating"
 * — same createdAt cutoff as computeTemplateStatuses).
 */
export function computeFixedMonthlySummary(
  templates: FixedTemplateSummaryInput[],
  monthEnd: Date,
): FixedMonthlySummary {
  let monthlyIncome = 0;
  let monthlyExpense = 0;
  let monthlySavings = 0;

  for (const template of templates) {
    if (!template.active || template.createdAt >= monthEnd) continue;
    const monthly = monthlyEquivalentAmount(template.amount, template.frequency);
    if (template.type === "INCOME") monthlyIncome += monthly;
    else if (template.type === "EXPENSE") monthlyExpense += monthly;
    else monthlySavings += monthly;
  }

  return { monthlyIncome, monthlyExpense, monthlySavings };
}

export type RecurringMonthlyTotalsInput = {
  type: FixedItemType;
  amount: number;
  date: Date;
  recurringTemplateId: string | null;
};

export type RecurringMonthlyTotals = {
  /** "YYYY-MM" */
  month: string;
  income: number;
  expense: number;
  savings: number;
};

/**
 * How the household's logged fixed (recurring-template-linked) transactions
 * have actually trended over the last `monthsBack` months, one bucket per
 * calendar month ending at `referenceDate`'s month — always `monthsBack`
 * entries, even for months with no activity, so a trend chart gets a stable
 * x-axis. Transactions not linked to a recurring template (recurringTemplateId
 * null) are ignored: this tracks the planned/fixed side of the budget, not
 * every transaction.
 */
export function computeRecurringMonthlyTotals({
  transactions,
  referenceDate,
  monthsBack,
}: {
  transactions: RecurringMonthlyTotalsInput[];
  referenceDate: Date;
  monthsBack: number;
}): RecurringMonthlyTotals[] {
  const months: RecurringMonthlyTotals[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
    months.push({
      month: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      income: 0,
      expense: 0,
      savings: 0,
    });
  }

  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const t of transactions) {
    if (!t.recurringTemplateId) continue;
    const key = `${t.date.getFullYear()}-${pad2(t.date.getMonth() + 1)}`;
    const bucket = byMonth.get(key);
    if (!bucket) continue;
    if (t.type === "INCOME") bucket.income += t.amount;
    else if (t.type === "EXPENSE") bucket.expense += t.amount;
    else bucket.savings += t.amount;
  }

  return months;
}

export type RecurringBreakdownInput = {
  id: string;
  name: string;
  amount: number;
  frequency: TemplateFrequency;
  type: FixedItemType;
  active: boolean;
  /** Same cutoff as computeFixedMonthlySummary/computeTemplateStatuses. */
  createdAt: Date;
};

export type RecurringBreakdownItem = {
  id: string;
  name: string;
  /** monthlyEquivalentAmount(amount, frequency) — comparable across
   * WEEKLY/MONTHLY/YEARLY templates, same scale as computeFixedMonthlySummary. */
  monthlyAmount: number;
};

/**
 * Every active INCOME (or EXPENSE) template's monthly-equivalent amount, one
 * row per template, sorted largest-first — the per-item breakdown behind
 * computeFixedMonthlySummary's INCOME/EXPENSE totals, for a proportional-bar
 * visualization of what makes up the fixed budget (see
 * components/budget/category-breakdown.tsx). Shares computeFixedMonthlySummary's
 * "not backward propagating" createdAt cutoff so the two always agree on
 * which templates count for a given month.
 */
export function computeRecurringBreakdown(
  templates: RecurringBreakdownInput[],
  type: FixedItemType,
  monthEnd: Date,
): RecurringBreakdownItem[] {
  return templates
    .filter((t) => t.active && t.type === type && t.createdAt < monthEnd)
    .map((t) => ({ id: t.id, name: t.name, monthlyAmount: monthlyEquivalentAmount(t.amount, t.frequency) }))
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

// Ratio of fixed monthly income below which a non-negative net counts as
// "tight" rather than "balanced" — same shape as safe-to-spend-calc.ts's
// TIGHT_THRESHOLD_RATIO, applied to the planned/fixed budget instead of
// month-to-date actuals.
const BALANCE_TIGHT_THRESHOLD_RATIO = 0.1;

export type BudgetBalanceStatus = "balanced" | "tight" | "deficit";

/**
 * Calmer three-way read on the fixed budget's net (monthlyIncome -
 * monthlyExpense), for copy/color in the UI — same idea as
 * safe-to-spend-calc.ts's SafeToSpendStatus: "deficit" once fixed costs
 * exceed fixed income, "tight" once what's left over drops under
 * BALANCE_TIGHT_THRESHOLD_RATIO of fixed income, "balanced" otherwise. With
 * no fixed income planned yet, a non-negative net reads as "balanced" rather
 * than guessing at a ratio.
 */
export function computeBudgetBalanceStatus({
  monthlyIncome,
  monthlyExpense,
}: {
  monthlyIncome: number;
  monthlyExpense: number;
}): BudgetBalanceStatus {
  const net = monthlyIncome - monthlyExpense;
  if (net < 0) return "deficit";
  if (monthlyIncome > 0 && net <= monthlyIncome * BALANCE_TIGHT_THRESHOLD_RATIO) return "tight";
  return "balanced";
}

export type TemplateStatus = "posted" | "acknowledged" | "due";

export type RecurringTemplateInput = {
  id: string;
  frequency: TemplateFrequency;
  active: boolean;
  /** When this template was created — see computeTemplateStatuses's doc
   * comment for why this gates inclusion per viewed month. */
  createdAt: Date;
};

export type TemplateTransactionInput = {
  recurringTemplateId: string | null;
  date: Date;
};

export type TemplateAckInput = {
  recurringTemplateId: string;
  periodKey: string;
};

export type TemplateStatusRow<T extends RecurringTemplateInput> = {
  template: T;
  periodKey: string;
  status: TemplateStatus;
};

/**
 * For every active template that already existed by the viewed period,
 * determines this period's status: "posted" if a transaction was logged
 * from it for the current period, else "acknowledged" if it was explicitly
 * checked off without one, else unconditionally "due" — a template's period
 * always shows in that period's view regardless of day-of-month, and is
 * cleared purely by a transaction or ack. Inactive (paused) templates are
 * omitted entirely — see RecurringTemplate.active's doc comment. A template
 * created after `monthEnd` is also omitted — it shouldn't "backward
 * propagate" into a budget view of a month before it existed (see
 * RecurringTemplateInput.createdAt).
 */
export function computeTemplateStatuses<T extends RecurringTemplateInput>({
  templates,
  transactions,
  acks,
  referenceDate,
  monthEnd,
}: {
  templates: T[];
  transactions: TemplateTransactionInput[];
  acks: TemplateAckInput[];
  referenceDate: Date;
  /** Exclusive upper bound of the viewed period (e.g. budget-date-utils.ts's
   * getMonthEnd) — a template created on or after this never shows for this
   * period. */
  monthEnd: Date;
}): TemplateStatusRow<T>[] {
  const ackedPeriods = new Set(acks.map((a) => `${a.recurringTemplateId}:${a.periodKey}`));

  return templates
    .filter((template) => template.active && template.createdAt < monthEnd)
    .map((template) => {
      const periodKey = getPeriodKey(referenceDate, template.frequency);

      const posted = transactions.some(
        (t) =>
          t.recurringTemplateId === template.id &&
          getPeriodKey(t.date, template.frequency) === periodKey,
      );

      const status: TemplateStatus = posted
        ? "posted"
        : ackedPeriods.has(`${template.id}:${periodKey}`)
          ? "acknowledged"
          : "due";

      return { template, periodKey, status };
    });
}
