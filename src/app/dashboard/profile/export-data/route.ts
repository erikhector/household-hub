import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";

// Streams a GDPR data-export download of the caller's own personal data —
// deliberately bounded, mirroring the scope decision in
// PRODUCTION_READINESS.md's task M: this includes only data that's
// genuinely *this user's own*, never household-*shared* operational data
// (InventoryItem, Transaction, ShoppingList, ...), which other members
// co-own and which is already reachable to anyone with household access via
// the existing per-feature CSV export buttons (see
// src/components/export/export-button.tsx) — duplicating it here would
// misrepresent it as this user's exclusive data. `passwordHash` is never
// included. User (not household) is derived server-side via
// requireUserId(), never from a query param, same trust posture as
// src/app/dashboard/inventory/export/route.ts.
export async function GET() {
  const userId = await requireUserId();

  const [user, memberships, personalBudgetCategories, personalTransactions, personalRecurringTemplates] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.householdMember.findMany({
        where: { userId },
        include: { household: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.personalBudgetCategory.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.personalTransaction.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.personalRecurringTemplate.findMany({
        where: { userId },
        include: { acknowledgements: true },
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
    },
    // Just the membership record — household name, role, joined date. Not
    // the household's inventory/shopping/budget contents (see doc comment
    // above): those belong to every member, not just this one.
    householdMemberships: memberships.map((membership) => ({
      householdName: membership.household.name,
      role: membership.role,
      joinedAt: membership.createdAt,
    })),
    personalBudgetCategories: personalBudgetCategories.map((category) => ({
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
      createdAt: transaction.createdAt,
    })),
    personalRecurringTemplates: personalRecurringTemplates.map((template) => ({
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
  };

  const json = JSON.stringify(data, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="household-hub-my-data-${date}.json"`,
    },
  });
}
