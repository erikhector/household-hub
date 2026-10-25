import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";

// Streams a GDPR data-export download of the caller's own personal data —
// deliberately bounded, mirroring the scope decision in
// docs/archive/PRODUCTION_READINESS.md's task M: this includes only data that's
// genuinely *this user's own*, never household-*shared* operational data
// (InventoryItem, Transaction, ShoppingList, ...), which other members
// co-own and which is already reachable to anyone with household access via
// the existing per-feature CSV export buttons (see
// src/components/export/export-button.tsx) — duplicating it here would
// misrepresent it as this user's exclusive data. `passwordHash` is never
// included. User (not household) is derived server-side via
// requireUserId(), never from a query param, same trust posture as
// src/app/dashboard/inventory/export/route.ts.
//
// SEC-10: "this user's own" also covers the rows inside shared features that
// are *about* this user — the notes they wrote, the tasks assigned to or
// completed by them, their share of split bills and the repayments they made
// or received — since those are what a household member's data trail in the
// app actually is. Each is exported as the user's row plus just enough of
// the parent (household name, bill description) to make it readable, never
// the whole shared transaction list or task board.
export async function GET() {
  const userId = await requireUserId();
  // Every per-member row (splits, tasks, notes, settlements) hangs off a
  // HouseholdMember, so "mine" is always "a membership whose user is me".
  const mine = { userId };

  const [
    user,
    memberships,
    pushSubscriptions,
    personalBudgetCategories,
    personalTransactions,
    personalRecurringTemplates,
    personalPlannedExpenses,
    notes,
    tasks,
    transactionSplits,
    recurringTemplateSplits,
    plannedExpenseSplits,
    settlements,
    invitationsSent,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.householdMember.findMany({
      where: { userId },
      include: { household: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.personalBudgetCategory.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.personalTransaction.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    prisma.personalRecurringTemplate.findMany({
      where: { userId },
      include: { acknowledgements: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.personalPlannedExpense.findMany({ where: { userId }, orderBy: { dueDate: "asc" } }),
    prisma.householdNote.findMany({
      where: { authorMember: mine },
      include: { household: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.householdTask.findMany({
      where: { OR: [{ assignedToMember: mine }, { completedByMember: mine }] },
      include: {
        household: { select: { name: true } },
        assignedToMember: { select: { userId: true } },
        completedByMember: { select: { userId: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transactionSplit.findMany({
      where: { householdMember: mine },
      include: {
        transaction: {
          select: {
            description: true,
            amount: true,
            type: true,
            date: true,
            household: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.recurringTemplateSplit.findMany({
      where: { householdMember: mine },
      include: {
        recurringTemplate: {
          select: {
            name: true,
            amount: true,
            type: true,
            frequency: true,
            household: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    // BUDGET-8: this user's agreed share of a planned bill.
    prisma.plannedExpenseSplit.findMany({
      where: { householdMember: mine },
      include: {
        plannedExpense: {
          select: { name: true, amount: true, dueDate: true, household: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.memberSettlement.findMany({
      where: { OR: [{ fromMember: mine }, { toMember: mine }] },
      include: {
        household: { select: { name: true } },
        fromMember: { select: { userId: true, user: { select: { displayName: true } } } },
        toMember: { select: { userId: true, user: { select: { displayName: true } } } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.invitation.findMany({
      where: { invitedById: userId },
      include: { household: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const data = {
    exportedAt: new Date().toISOString(),
    profile: {
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      emailVerifiedAt: user.emailVerifiedAt,
      // GAP-7: shown to household members for Swish payments, so it's
      // personal data this export must include. Null when not set.
      swishNumber: user.swishNumber,
    },
    // Account-level settings synced across devices (src/lib/preferences.ts)
    // plus the weekly digest opt-in — choices the user made, so theirs.
    preferences: {
      locale: user.locale,
      theme: user.theme,
      weeklyDigestEnabled: user.weeklyDigestEnabled,
      inventoryViewPrefs: user.inventoryViewPrefs,
      personalBudgetMonthStartDay: user.personalBudgetMonthStartDay,
    },
    // Just the membership record — household name, role, joined date. Not
    // the household's inventory/shopping/budget contents (see doc comment
    // above): those belong to every member, not just this one.
    householdMemberships: memberships.map((membership) => ({
      householdName: membership.household.name,
      role: membership.role,
      joinedAt: membership.createdAt,
    })),
    // One per browser that has push turned on. The push service's origin
    // says which browser/vendor it is; the full `endpoint` URL and the
    // `p256dh`/`auth` keys are deliberately left out. Together they are a
    // bearer credential: anyone holding them can push notifications to that
    // device, and an export file tends to get emailed, synced and forgotten.
    // They're random values minted by the browser, not information about the
    // user, so dropping them costs the user nothing they could read.
    pushSubscriptions: pushSubscriptions.map((subscription) => ({
      pushService: originOf(subscription.endpoint),
      createdAt: subscription.createdAt,
      quietHoursStart: subscription.quietHoursStart,
      quietHoursEnd: subscription.quietHoursEnd,
      timeZone: subscription.timeZone,
    })),
    // `id` is included because personalTransactions and
    // personalRecurringTemplates refer to categories by `categoryId`, and
    // transactions to templates by `recurringTemplateId` — without it those
    // references can't be resolved.
    personalBudgetCategories: personalBudgetCategories.map((category) => ({
      id: category.id,
      name: category.name,
      type: category.type,
      createdAt: category.createdAt,
    })),
    personalTransactions: personalTransactions.map((transaction) => ({
      categoryId: transaction.categoryId,
      amount: transaction.amount,
      type: transaction.type,
      description: transaction.description,
      date: transaction.date,
      isRecurring: transaction.isRecurring,
      recurrenceFrequency: transaction.recurrenceFrequency,
      recurringTemplateId: transaction.recurringTemplateId,
      plannedExpenseId: transaction.plannedExpenseId,
      createdAt: transaction.createdAt,
    })),
    personalRecurringTemplates: personalRecurringTemplates.map((template) => ({
      id: template.id,
      categoryId: template.categoryId,
      name: template.name,
      amount: template.amount,
      type: template.type,
      frequency: template.frequency,
      dayOfMonth: template.dayOfMonth,
      active: template.active,
      createdAt: template.createdAt,
      acknowledgements: template.acknowledgements.map((ack) => ({
        periodKey: ack.periodKey,
        createdAt: ack.createdAt,
      })),
    })),
    // `id` so personalTransactions[].plannedExpenseId resolves, as above.
    personalPlannedExpenses: personalPlannedExpenses.map((bill) => ({
      id: bill.id,
      categoryId: bill.categoryId,
      name: bill.name,
      amount: bill.amount,
      dueDate: bill.dueDate,
      createdAt: bill.createdAt,
    })),
    // Notes on the household board this user wrote.
    householdNotes: notes.map((note) => ({
      householdName: note.household.name,
      body: note.body,
      createdAt: note.createdAt,
    })),
    // Tasks assigned to or last completed by this user. A task only keeps
    // its latest completion (see HouseholdTask's doc comment), so this is
    // all the task history there is. The rotation's other members are left
    // out: that's the household's schedule, not this user's data.
    householdTasks: tasks.map((task) => ({
      householdName: task.household.name,
      title: task.title,
      assignedToMe: task.assignedToMember?.userId === userId,
      completedByMe: task.completedByMember?.userId === userId,
      completedAt: task.completedAt,
      recurrenceIntervalDays: task.recurrenceIntervalDays,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
    })),
    // This user's share of split household bills, with the bill it belongs
    // to so the amounts mean something. Other members' shares stay out.
    transactionSplits: transactionSplits.map((split) => ({
      householdName: split.transaction.household.name,
      transactionDescription: split.transaction.description,
      transactionAmount: split.transaction.amount,
      transactionType: split.transaction.type,
      transactionDate: split.transaction.date,
      amountOwed: split.amountOwed,
      amountPaid: split.amountPaid,
      createdAt: split.createdAt,
    })),
    recurringTemplateSplits: recurringTemplateSplits.map((split) => ({
      householdName: split.recurringTemplate.household.name,
      templateName: split.recurringTemplate.name,
      templateAmount: split.recurringTemplate.amount,
      templateType: split.recurringTemplate.type,
      frequency: split.recurringTemplate.frequency,
      amountOwed: split.amountOwed,
      createdAt: split.createdAt,
    })),
    plannedExpenseSplits: plannedExpenseSplits.map((split) => ({
      householdName: split.plannedExpense.household.name,
      billName: split.plannedExpense.name,
      billAmount: split.plannedExpense.amount,
      dueDate: split.plannedExpense.dueDate,
      amountOwed: split.amountOwed,
      createdAt: split.createdAt,
    })),
    // Repayments this user made or received. The other member's display
    // name is what the Budget page already shows this user for the same
    // repayment, and without it "received 200" is unreadable.
    memberSettlements: settlements.map((settlement) => {
      const paid = settlement.fromMember.userId === userId;
      const counterparty = paid ? settlement.toMember : settlement.fromMember;
      return {
        householdName: settlement.household.name,
        direction: paid ? "paid" : "received",
        counterpartyName: counterparty.user.displayName,
        amount: settlement.amount,
        date: settlement.date,
        createdAt: settlement.createdAt,
      };
    }),
    // UX-62: invite links record who made them, so the links this user
    // made are theirs. The `token` is left out for the same reason as the
    // push keys: an unused one is a bearer credential to join the household.
    invitationsSent: invitationsSent.map((invitation) => ({
      householdName: invitation.household.name,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
    })),
  };

  const json = JSON.stringify(data, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="squirrel-my-data-${date}.json"`,
      // A full copy of one person's data: never let a shared proxy or the
      // browser's back/forward cache keep it.
      "Cache-Control": "private, no-store",
    },
  });
}

// The push service's origin (e.g. https://fcm.googleapis.com) without the
// per-device path that makes the endpoint a credential. Null if a stored
// endpoint somehow isn't a URL, rather than failing the whole export.
function originOf(endpoint: string): string | null {
  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}
