import { prisma } from "@/lib/prisma";
import { normalizeStartDay } from "@/lib/budget-date-utils";

/**
 * The user's Personal Budget month start day (User.personalBudgetMonthStartDay),
 * normalized to 1..28 — the personal counterpart of the household's
 * budgetMonthStartDay (UX-134). The Personal Budget page, the dashboard's
 * "Your budget" card and the personal recurring actions all read it, so the
 * same transaction lands in the same period everywhere. A user that can't be
 * found gets the calendar month (1); the callers have already checked the
 * session.
 */
export async function getPersonalBudgetStartDay(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { personalBudgetMonthStartDay: true },
  });
  return normalizeStartDay(user?.personalBudgetMonthStartDay);
}
