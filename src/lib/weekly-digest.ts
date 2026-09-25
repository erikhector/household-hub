import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { emailLogoUrl, sendWeeklyDigestEmail } from "@/lib/email";
import { getDictionaryForLocale } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale } from "@/lib/i18n/locales";
import { EXPIRY_WARNING_DAYS } from "@/lib/inventory/expiry";
import { computeSafeToSpend } from "@/lib/safe-to-spend-calc";
import { computeTemplateStatuses } from "@/lib/recurring-template-calc";
import { addMonths, getMonthEnd, getMonthStart } from "@/lib/budget-date-utils";
import { getWeekStart, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { createDigestUnsubscribeToken } from "@/lib/digest-unsubscribe-token";
import {
  DIGEST_MEAL_WINDOW_DAYS,
  renderWeeklyDigest,
  summarizeWeeklyDigest,
  type WeeklyDigestInput,
} from "@/lib/weekly-digest-content";

// GAP-27: the weekly household digest email. Run from
// `GET /api/cron/weekly-digest` (see that route and DEPLOYMENT.md's
// "Scheduled jobs" section). What goes *in* the email is decided by the pure
// src/lib/weekly-digest-content.ts; this module is the Prisma loading and
// the who-gets-it/has-it-already-gone-out bookkeeping around it.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Bounds how many households are processed concurrently — same reasoning as
// /api/cron/sync-notifications's BATCH_SIZE: each household makes several
// Prisma queries, so an unbatched Promise.all over every household would
// scale connection-pool pressure with household count.
export const DIGEST_BATCH_SIZE = 10;

// Same trailing window the household budget page gives computeSafeToSpend/
// computeTemplateStatuses (RECURRING_LOOKBACK_MONTHS in
// src/app/dashboard/budget/page.tsx) — the digest's headline must be the
// exact number the Budget page shows, not a cheaper approximation of it.
const RECURRING_LOOKBACK_MONTHS = 12;

// WeeklyDigestSend rows only matter for the current week's idempotency
// check; older ones are pruned on each run so the table stays tiny. A few
// weeks of slack keeps recent history around for diagnosing "did I get it?".
const SEND_RETENTION_DAYS = 35;

/** Monday (UTC) of the week `now` falls in, as yyyy-mm-dd — the idempotency
 * key. Same Monday-start week the Tasks recap uses. */
export function digestWeekKey(now: Date): string {
  return toDateKey(getWeekStart(now));
}

type Recipient = { userId: string; email: string; locale: string };

/**
 * Loads one household's digest inputs. Every query is scoped to
 * `householdId`, which only ever comes from the household table itself
 * (never from a request).
 */
export async function loadHouseholdDigestInput(householdId: string, now: Date): Promise<WeeklyDigestInput> {
  const weekStart = getWeekStart(now);
  const mealWindowStart = new Date(now.getTime() - DIGEST_MEAL_WINDOW_DAYS * MS_PER_DAY);
  // One day of slack past the warning threshold so the pure classifier
  // (getExpiryStatus) makes the actual call rather than this query.
  const expiryHorizon = new Date(now.getTime() + (EXPIRY_WARNING_DAYS + 1) * MS_PER_DAY);
  const monthStart = getMonthStart(now);
  const monthEnd = getMonthEnd(now);

  const [members, mealEntries, completedTasks, inventoryItems, budgetCategoryCount] = await Promise.all([
    prisma.householdMember.findMany({
      where: { householdId },
      select: { id: true, user: { select: { displayName: true } } },
    }),
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId }, date: { gte: mealWindowStart, lte: now } },
      select: { date: true, recipeId: true },
    }),
    prisma.householdTask.findMany({
      where: { householdId, completedAt: { gte: weekStart } },
      select: { title: true, completedAt: true, completedByMemberId: true },
      orderBy: { completedAt: "asc" },
    }),
    prisma.inventoryItem.findMany({
      where: { householdId, quantity: { gt: 0 }, expiresAt: { not: null, lte: expiryHorizon } },
      select: { name: true, expiresAt: true, expiresAtEstimated: true },
      orderBy: { expiresAt: "asc" },
    }),
    prisma.budgetCategory.count({ where: { householdId } }),
  ]);

  return {
    now,
    mealEntries,
    completedTasks,
    memberNames: new Map(members.map((m) => [m.id, m.user.displayName])),
    inventoryItems,
    budget:
      budgetCategoryCount > 0 ? await loadHouseholdSafeToSpend(householdId, monthStart, monthEnd) : null,
  };
}

// The household Budget page's SafeToSpend computation (BudgetTabsSection in
// src/app/dashboard/budget/page.tsx), narrowed to just the queries that
// feed it.
async function loadHouseholdSafeToSpend(householdId: string, monthStart: Date, monthEnd: Date) {
  const lookbackStart = addMonths(monthStart, -RECURRING_LOOKBACK_MONTHS);
  const [transactions, templates, acks] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, date: { gte: lookbackStart, lt: monthEnd } },
      select: {
        categoryId: true,
        category: { select: { name: true } },
        type: true,
        amount: true,
        date: true,
        isRecurring: true,
        recurringTemplateId: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.recurringTemplate.findMany({
      where: { householdId, active: true },
      select: {
        id: true,
        name: true,
        categoryId: true,
        type: true,
        amount: true,
        frequency: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.recurringTemplateAck.findMany({
      where: { recurringTemplate: { householdId } },
      select: { recurringTemplateId: true, periodKey: true },
    }),
  ]);

  let income = 0;
  let expense = 0;
  let savings = 0;
  for (const t of transactions) {
    if (t.date < monthStart) continue;
    if (t.type === "INCOME") income += t.amount;
    else if (t.type === "EXPENSE") expense += t.amount;
    else savings += t.amount;
  }

  const statusRows = computeTemplateStatuses({
    templates,
    transactions: transactions.map((t) => ({ recurringTemplateId: t.recurringTemplateId, date: t.date })),
    acks,
    referenceDate: monthStart,
    monthEnd,
  });

  return computeSafeToSpend({
    transactions: transactions.map((t) => ({
      categoryId: t.categoryId,
      categoryName: t.category.name,
      type: t.type,
      amount: t.amount,
      date: t.date,
      isRecurring: t.isRecurring,
    })),
    monthStart,
    monthEnd,
    incomeSoFar: income,
    expenseSoFar: expense,
    savingsSoFar: savings,
    templates: statusRows.map((row) => ({
      id: row.template.id,
      name: row.template.name,
      categoryId: row.template.categoryId,
      type: row.template.type,
      amount: row.template.amount,
      status: row.status,
    })),
  });
}

export type HouseholdDigestResult = { sent: number; failed: number };

/**
 * Sends this week's digest to every opted-in, verified member of one
 * household who hasn't already had it. Idempotency is claim-then-send: a
 * WeeklyDigestSend row is inserted *before* the email goes out, so a second
 * concurrent or retried run hits the unique constraint and skips that
 * recipient. If the send itself fails the claim is released again, so the
 * next run can retry. The one gap — the process dying between claim and
 * send — costs that person one week's digest rather than risking a
 * duplicate, which is the right way round for email.
 */
export async function sendHouseholdDigest({
  household,
  now,
  appUrl,
  secret,
}: {
  household: { id: string; name: string };
  now: Date;
  appUrl: string;
  secret: string;
}): Promise<HouseholdDigestResult> {
  const weekKey = digestWeekKey(now);

  // Only verified addresses: an unverified one may not belong to the
  // account holder at all (see User.emailVerifiedAt), and a recurring email
  // to a stranger is exactly what the verification gate exists to prevent.
  const memberships = await prisma.householdMember.findMany({
    where: {
      householdId: household.id,
      user: {
        weeklyDigestEnabled: true,
        emailVerifiedAt: { not: null },
        weeklyDigestSends: { none: { householdId: household.id, weekKey } },
      },
    },
    select: { user: { select: { id: true, email: true, locale: true } } },
  });
  const recipients: Recipient[] = memberships.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    locale: m.user.locale,
  }));
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const summary = summarizeWeeklyDigest(await loadHouseholdDigestInput(household.id, now));
  // Nothing to say this week: no email, and no claim either — a later run
  // in the same week (e.g. a manual re-trigger) is free to send once there
  // is something.
  if (!summary) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  // Sequential within a household: households are already the unit of
  // concurrency (DIGEST_BATCH_SIZE), and a household has a handful of
  // members at most.
  for (const recipient of recipients) {
    try {
      await prisma.weeklyDigestSend.create({
        data: { userId: recipient.userId, householdId: household.id, weekKey },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }

    // Stored per user (User.locale, the same account-level preference the
    // app UI uses), so each member gets the digest in their own language.
    const locale = isLocale(recipient.locale) ? recipient.locale : defaultLocale;
    const unsubscribeUrl = `${appUrl}/api/digest/unsubscribe/${encodeURIComponent(
      createDigestUnsubscribeToken(recipient.userId, secret),
    )}`;
    const rendered = renderWeeklyDigest({
      summary,
      dict: getDictionaryForLocale(locale),
      locale,
      householdName: household.name,
      appUrl,
      unsubscribeUrl,
      logoUrl: emailLogoUrl(),
    });

    const result = await sendWeeklyDigestEmail({ to: recipient.email, unsubscribeUrl, ...rendered });
    if (result.error) {
      failed += 1;
      logger.error("Weekly digest send failed", {
        householdId: household.id,
        userId: recipient.userId,
        error: result.error,
      });
      await prisma.weeklyDigestSend
        .deleteMany({ where: { userId: recipient.userId, householdId: household.id, weekKey } })
        .catch((error) => logger.error("Failed to release weekly digest claim", { error }));
      continue;
    }
    sent += 1;
  }

  return { sent, failed };
}

export type WeeklyDigestRunResult = {
  householdsProcessed: number;
  emailsSent: number;
  emailsFailed: number;
  failedHouseholdIds: string[];
};

/** Processes every household with at least one opted-in member, in batches
 * of DIGEST_BATCH_SIZE. One household failing never stops the others. */
export async function runWeeklyDigest({
  now,
  appUrl,
  secret,
}: {
  now: Date;
  appUrl: string;
  secret: string;
}): Promise<WeeklyDigestRunResult> {
  // Housekeeping first, and never fatal — see SEND_RETENTION_DAYS.
  await prisma.weeklyDigestSend
    .deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - SEND_RETENTION_DAYS * MS_PER_DAY) } } })
    .catch((error) => logger.error("Failed to prune old weekly digest sends", { error }));

  // Only households someone actually wants a digest from — with the
  // feature default-off, that's a small fraction of the table.
  const households = await prisma.household.findMany({
    where: { members: { some: { user: { weeklyDigestEnabled: true, emailVerifiedAt: { not: null } } } } },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  let emailsSent = 0;
  let emailsFailed = 0;
  let householdsProcessed = 0;
  const failedHouseholdIds: string[] = [];

  for (let i = 0; i < households.length; i += DIGEST_BATCH_SIZE) {
    const batch = households.slice(i, i + DIGEST_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((household) => sendHouseholdDigest({ household, now, appUrl, secret })),
    );
    results.forEach((result, index) => {
      const householdId = batch[index].id;
      if (result.status === "rejected") {
        console.error(`Weekly digest failed for household ${householdId}:`, result.reason);
        failedHouseholdIds.push(householdId);
        return;
      }
      householdsProcessed += 1;
      emailsSent += result.value.sent;
      emailsFailed += result.value.failed;
      if (result.value.failed > 0) failedHouseholdIds.push(householdId);
    });
  }

  return { householdsProcessed, emailsSent, emailsFailed, failedHouseholdIds };
}
