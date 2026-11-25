// MAINT-110: what more than one of the household budget's action files
// needs (transaction-actions.ts, recurring-actions.ts, settlement-actions.ts).
// A plain module on purpose: a "use server" file can only export Server
// Actions, and these helpers must never become callable from the client
// (see src/lib/use-server-exports.test.ts).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/actions/errors";
import { getPeriodBounds, getPeriodKey, type TemplateFrequency } from "@/lib/recurring-template-calc";

/**
 * Guards against the same recurring template being logged twice for the
 * same period — the same period-matching logic computeTemplateStatuses
 * (src/lib/recurring-template-calc.ts) uses to derive "posted" at read time,
 * enforced here at write time too. Needed because a template's period can be
 * logged from three independent entry points (the household budget's "Log
 * as-is"/"Log transaction", and Personal Budget's "Log payment" via
 * createSharedExpenseFromPersonalBudgetAction in transaction-actions.ts) that don't otherwise
 * know about each other within one request — e.g. two household members
 * racing each other, or Personal Budget's due-row widget being a request
 * behind the household budget's own revalidation.
 *
 * UX-134: `startDay` is the household's budget month start day, which
 * decides what a MONTHLY template's period is.
 */
export async function assertNoDuplicateTemplatePeriod(
  recurringTemplateId: string,
  frequency: TemplateFrequency,
  date: Date,
  startDay: number,
): Promise<{ error: string } | null> {
  const periodKey = getPeriodKey(date, frequency, startDay);
  // Bounded to the period's date range so the read doesn't grow with every
  // period the template has ever been logged in (PERF-17). The key check
  // below stays as the exact definition of "same period".
  const { start, end } = getPeriodBounds(date, frequency, startDay);
  const existing = await prisma.transaction.findMany({
    where: { recurringTemplateId, date: { gte: start, lt: end } },
    select: { date: true },
  });
  const alreadyLogged = existing.some((t) => getPeriodKey(t.date, frequency, startDay) === periodKey);
  return alreadyLogged ? fail("recurringItemAlreadyLogged") : null;
}

export type ParsedSplit = { householdMemberId: string; amountOwed: number; amountPaid: number };

/** Every page that reads split transactions or repayments: the household
 * budget, Personal Budget (your share, "owed from earlier months") and the
 * dashboard's "Your budget" card (the same number). */
export function revalidateBudgetPages() {
  revalidatePath("/dashboard/budget");
  revalidatePath("/dashboard/personal-budget");
  revalidatePath("/dashboard");
}
