// Pure status logic for planned bills (PlannedExpense: a one-off bill with a
// due date that isn't a recurring template) and planned income (the same
// table, in an INCOME category: a bonus or tax refund expected on a date) —
// see REQUIREMENTS.md, "Planned bills" and "Planned income" (design history:
// docs/archive/PLANNED_BILLS_DESIGN.md, section 2).
// Kept dependency-free (no Prisma import) so it's
// unit-testable with plain fixtures.
//
// "Paid" is judged as of `monthEnd`, not as of today: a bill due in October
// and paid on 3 November is still `due` when October is viewed and only
// `paid` from November on. That keeps past months historical — October's
// numbers don't change retroactively when a bill is settled later.

export type PlannedExpenseStatus = "paid" | "due" | "overdue" | "upcoming";

/**
 * `paidAt` is the date of the linked transaction, or null when the bill has
 * none. `monthStart`/`monthEnd` are the month being viewed, `monthEnd`
 * exclusive.
 */
export function getPlannedExpenseStatus(
  bill: { dueDate: Date; paidAt: Date | null },
  monthStart: Date,
  monthEnd: Date,
): PlannedExpenseStatus {
  if (bill.paidAt !== null && bill.paidAt < monthEnd) return "paid";
  if (bill.dueDate >= monthEnd) return "upcoming";
  if (bill.dueDate >= monthStart) return "due";
  return "overdue";
}

/** due or overdue: what counts against the month's numbers. */
export function isPlannedExpenseOutstanding(status: PlannedExpenseStatus): boolean {
  return status === "due" || status === "overdue";
}

/** A planned item's type: its category's. Only expense and income
 * categories can hold one (the planned-item actions reject savings). */
export type PlannedItemType = "EXPENSE" | "INCOME";

/** A planned item's type from its category's. The actions only ever store
 * an expense or income category on one, so anything else is read as a bill
 * rather than trusted as income. */
export function plannedItemType(categoryType: string): PlannedItemType {
  return categoryType === "INCOME" ? "INCOME" : "EXPENSE";
}

/**
 * Whether a planned item counts in the viewed month's numbers (Safe to
 * spend, the due strip). A bill counts while due or overdue: money owed
 * doesn't go away because its date passed. Expected income counts only in
 * the month it's due: income that didn't arrive may never come, and
 * carrying it forward would keep promising money that isn't there. Late
 * income still shows on the Manage tab ("Not received") until it's logged
 * or deleted, it just stops inflating the number.
 */
export function isPlannedItemCounted(status: PlannedExpenseStatus, type: PlannedItemType): boolean {
  return type === "INCOME" ? status === "due" : isPlannedExpenseOutstanding(status);
}

/**
 * A due date from the form's YYYY-MM-DD. Due dates are calendar days, stored
 * at UTC noon so no timezone shifts the day. Returns null for an impossible
 * date such as 2026-02-31. Shared by the household and personal planned-bill
 * actions.
 */
export function parseDueDate(value: string): Date | null {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}
