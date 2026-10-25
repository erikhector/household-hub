// Tests the /dashboard/profile/export-data Route Handler (GDPR data export
// — see docs/archive/PRODUCTION_READINESS.md task M). Prisma and requireUserId are
// mocked, same pattern as src/app/api/health/route.test.ts — no database is
// touched. The core assertion is scope: the export includes the caller's
// own profile/membership/personal-budget data, never `passwordHash` and
// never household-*shared* operational data (that's already reachable via
// the existing per-feature CSV export buttons for anyone with household
// access, so duplicating it here would misrepresent it as this user's own).
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireUserIdMock,
  userFindUniqueOrThrowMock,
  householdMemberFindManyMock,
  personalBudgetCategoryFindManyMock,
  personalTransactionFindManyMock,
  personalRecurringTemplateFindManyMock,
  personalPlannedExpenseFindManyMock,
  pushSubscriptionFindManyMock,
  householdNoteFindManyMock,
  householdTaskFindManyMock,
  transactionSplitFindManyMock,
  recurringTemplateSplitFindManyMock,
  plannedExpenseSplitFindManyMock,
  memberSettlementFindManyMock,
  invitationFindManyMock,
} = vi.hoisted(() => ({
  requireUserIdMock: vi.fn(async () => "user-1"),
  userFindUniqueOrThrowMock: vi.fn(),
  householdMemberFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  personalBudgetCategoryFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  personalTransactionFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  personalRecurringTemplateFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  personalPlannedExpenseFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  pushSubscriptionFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  householdNoteFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  householdTaskFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  transactionSplitFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  recurringTemplateSplitFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  plannedExpenseSplitFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  memberSettlementFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  invitationFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUniqueOrThrow: userFindUniqueOrThrowMock },
    householdMember: { findMany: householdMemberFindManyMock },
    personalBudgetCategory: { findMany: personalBudgetCategoryFindManyMock },
    personalTransaction: { findMany: personalTransactionFindManyMock },
    personalRecurringTemplate: { findMany: personalRecurringTemplateFindManyMock },
    personalPlannedExpense: { findMany: personalPlannedExpenseFindManyMock },
    pushSubscription: { findMany: pushSubscriptionFindManyMock },
    householdNote: { findMany: householdNoteFindManyMock },
    householdTask: { findMany: householdTaskFindManyMock },
    transactionSplit: { findMany: transactionSplitFindManyMock },
    recurringTemplateSplit: { findMany: recurringTemplateSplitFindManyMock },
    plannedExpenseSplit: { findMany: plannedExpenseSplitFindManyMock },
    memberSettlement: { findMany: memberSettlementFindManyMock },
    invitation: { findMany: invitationFindManyMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));

const { GET } = await import("@/app/dashboard/profile/export-data/route");

afterEach(() => {
  vi.clearAllMocks();
  requireUserIdMock.mockResolvedValue("user-1");
});

const fixedNow = new Date("2026-01-01T00:00:00.000Z");
const verifiedAt = new Date("2025-12-01T00:00:00.000Z");

describe("GET /dashboard/profile/export-data", () => {
  it("includes the caller's own profile, membership, and personal-budget data, and never leaks passwordHash", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      displayName: "Erik",
      passwordHash: "super-secret-hash",
      createdAt: fixedNow,
      emailVerifiedAt: verifiedAt,
      swishNumber: "46701234567",
    });
    householdMemberFindManyMock.mockResolvedValue([
      {
        id: "membership-1",
        householdId: "household-1",
        role: "OWNER",
        createdAt: fixedNow,
        household: { name: "The Hectors" },
      },
    ]);
    personalBudgetCategoryFindManyMock.mockResolvedValue([
      { id: "cat-1", userId: "user-1", name: "Groceries", type: "EXPENSE", createdAt: fixedNow },
    ]);
    personalTransactionFindManyMock.mockResolvedValue([
      {
        id: "txn-1",
        userId: "user-1",
        categoryId: "cat-1",
        amount: 42.5,
        type: "EXPENSE",
        description: "Weekly shop",
        date: fixedNow,
        isRecurring: false,
        recurrenceFrequency: null,
        recurringTemplateId: null,
        createdAt: fixedNow,
      },
    ]);
    personalRecurringTemplateFindManyMock.mockResolvedValue([
      {
        id: "template-1",
        userId: "user-1",
        categoryId: "cat-1",
        name: "Rent",
        amount: 1000,
        type: "EXPENSE",
        frequency: "MONTHLY",
        dayOfMonth: 1,
        active: true,
        createdAt: fixedNow,
        acknowledgements: [{ id: "ack-1", personalRecurringTemplateId: "template-1", periodKey: "2026-01", createdAt: fixedNow }],
      },
    ]);

    const response = await GET();
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    // SEC-10: one person's full data must never sit in a shared cache.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");

    // Own data present.
    expect(body.profile).toEqual({
      email: "erik@example.com",
      displayName: "Erik",
      createdAt: fixedNow.toISOString(),
      emailVerifiedAt: verifiedAt.toISOString(),
      // GAP-7: personal data shown to household members, so it's exported.
      swishNumber: "46701234567",
    });
    expect(body.householdMemberships).toEqual([
      { householdName: "The Hectors", role: "OWNER", joinedAt: fixedNow.toISOString() },
    ]);
    expect(body.personalBudgetCategories).toHaveLength(1);
    expect(body.personalBudgetCategories[0].name).toBe("Groceries");
    expect(body.personalTransactions).toHaveLength(1);
    expect(body.personalTransactions[0].amount).toBe(42.5);
    expect(body.personalRecurringTemplates).toHaveLength(1);
    expect(body.personalRecurringTemplates[0].acknowledgements).toEqual([
      { periodKey: "2026-01", createdAt: fixedNow.toISOString() },
    ]);

    // Never leaked, anywhere in the payload.
    expect(bodyText).not.toContain("super-secret-hash");
    expect(bodyText).not.toContain("passwordHash");

    // Household-shared operational data (name aside) is out of scope —
    // there's no inventory/shoppingList/transaction-from-the-household key
    // at all, only this user's own membership record and personal budget.
    expect(body).not.toHaveProperty("household");
    expect(body).not.toHaveProperty("inventory");
    expect(body).not.toHaveProperty("shoppingLists");
    expect(body).not.toHaveProperty("transactions");

    expect(householdMemberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
    expect(personalBudgetCategoryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
  });

  it("derives the user from the session server-side, never from a query param", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      displayName: "Erik",
      passwordHash: "hash",
      createdAt: fixedNow,
      emailVerifiedAt: null,
    });

    await GET();

    expect(requireUserIdMock).toHaveBeenCalledTimes(1);
    expect(userFindUniqueOrThrowMock).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });

  // SEC-10: the export's shape is a contract with the user (and with the
  // privacy page's promise that "Export my data" gives them a copy), so any
  // key added or dropped has to show up here on purpose. Fills every
  // collection with one row so nested keys are covered too.
  describe("with one row in every collection", () => {
    const member = (userId: string, displayName: string) => ({ userId, user: { displayName } });

    function seedEverything() {
      userFindUniqueOrThrowMock.mockResolvedValue({
        id: "user-1",
        email: "erik@example.com",
        displayName: "Erik",
        passwordHash: "super-secret-hash",
        passwordChangedAt: fixedNow,
        createdAt: fixedNow,
        emailVerifiedAt: verifiedAt,
        swishNumber: null,
        locale: "sv",
        theme: "light",
        weeklyDigestEnabled: true,
        inventoryViewPrefs: { groupBy: "location" },
        personalBudgetMonthStartDay: 25,
      });
      householdMemberFindManyMock.mockResolvedValue([
        { id: "m-1", role: "OWNER", createdAt: fixedNow, household: { name: "The Hectors" } },
      ]);
      pushSubscriptionFindManyMock.mockResolvedValue([
        {
          id: "push-1",
          userId: "user-1",
          endpoint: "https://fcm.googleapis.com/fcm/send/device-secret-path",
          p256dh: "p256dh-public-key",
          auth: "auth-secret-key",
          createdAt: fixedNow,
          quietHoursStart: 22,
          quietHoursEnd: 7,
          timeZone: "Europe/Stockholm",
        },
      ]);
      personalBudgetCategoryFindManyMock.mockResolvedValue([
        { id: "cat-1", userId: "user-1", name: "Groceries", type: "EXPENSE", createdAt: fixedNow },
      ]);
      personalTransactionFindManyMock.mockResolvedValue([
        {
          id: "txn-1",
          categoryId: "cat-1",
          amount: 42.5,
          type: "EXPENSE",
          description: "Weekly shop",
          date: fixedNow,
          isRecurring: false,
          recurrenceFrequency: null,
          recurringTemplateId: "template-1",
          plannedExpenseId: null,
          createdAt: fixedNow,
        },
      ]);
      personalRecurringTemplateFindManyMock.mockResolvedValue([
        {
          id: "template-1",
          categoryId: "cat-1",
          name: "Rent",
          amount: 1000,
          type: "EXPENSE",
          frequency: "MONTHLY",
          dayOfMonth: 1,
          active: true,
          createdAt: fixedNow,
          acknowledgements: [{ id: "ack-1", periodKey: "2026-01", createdAt: fixedNow }],
        },
      ]);
      personalPlannedExpenseFindManyMock.mockResolvedValue([
        {
          id: "bill-1",
          userId: "user-1",
          categoryId: "cat-1",
          name: "Dentist",
          amount: 1200,
          dueDate: fixedNow,
          createdAt: fixedNow,
        },
      ]);
      householdNoteFindManyMock.mockResolvedValue([
        { id: "note-1", body: "Plumber on Thursday", createdAt: fixedNow, household: { name: "The Hectors" } },
      ]);
      householdTaskFindManyMock.mockResolvedValue([
        {
          id: "task-1",
          title: "Take out the bins",
          completedAt: fixedNow,
          recurrenceIntervalDays: 7,
          rotationMemberIds: ["m-1", "m-2"],
          createdAt: fixedNow,
          household: { name: "The Hectors" },
          assignedToMember: { userId: "user-2" },
          completedByMember: { userId: "user-1" },
        },
      ]);
      transactionSplitFindManyMock.mockResolvedValue([
        {
          id: "split-1",
          amountOwed: 150,
          amountPaid: 0,
          createdAt: fixedNow,
          transaction: {
            description: "Electricity",
            amount: 300,
            type: "EXPENSE",
            date: fixedNow,
            household: { name: "The Hectors" },
          },
        },
      ]);
      recurringTemplateSplitFindManyMock.mockResolvedValue([
        {
          id: "rsplit-1",
          amountOwed: 5000,
          createdAt: fixedNow,
          recurringTemplate: {
            name: "Rent",
            amount: 10000,
            type: "EXPENSE",
            frequency: "MONTHLY",
            household: { name: "The Hectors" },
          },
        },
      ]);
      plannedExpenseSplitFindManyMock.mockResolvedValue([
        {
          id: "psplit-1",
          amountOwed: 2000,
          createdAt: fixedNow,
          plannedExpense: {
            name: "Car insurance",
            amount: 4000,
            dueDate: fixedNow,
            household: { name: "The Hectors" },
          },
        },
      ]);
      memberSettlementFindManyMock.mockResolvedValue([
        {
          id: "settle-1",
          amount: 200,
          date: fixedNow,
          createdAt: fixedNow,
          household: { name: "The Hectors" },
          fromMember: member("user-1", "Erik"),
          toMember: member("user-2", "Anna"),
        },
        {
          id: "settle-2",
          amount: 50,
          date: fixedNow,
          createdAt: fixedNow,
          household: { name: "The Hectors" },
          fromMember: member("user-2", "Anna"),
          toMember: member("user-1", "Erik"),
        },
      ]);
      invitationFindManyMock.mockResolvedValue([
        {
          id: "inv-1",
          token: "invite-bearer-token",
          householdId: "household-1",
          invitedById: "user-1",
          createdAt: fixedNow,
          expiresAt: fixedNow,
          acceptedAt: null,
          household: { name: "The Hectors" },
        },
      ]);
    }

    // Every key path in the payload, arrays collapsed to their first item.
    function keyPaths(value: unknown, prefix = ""): string[] {
      if (Array.isArray(value)) return value.length ? keyPaths(value[0], `${prefix}[]`) : [];
      if (value === null || typeof value !== "object") return [];
      return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        // Opaque user-controlled JSON: its inner keys aren't the export's shape.
        if (key === "inventoryViewPrefs") return [path];
        return [path, ...keyPaths(child, path)];
      });
    }

    it("has exactly the documented keys", async () => {
      seedEverything();
      const body = await (await GET()).json();

      expect(keyPaths(body)).toMatchInlineSnapshot(`
        [
          "exportedAt",
          "profile",
          "profile.email",
          "profile.displayName",
          "profile.createdAt",
          "profile.emailVerifiedAt",
          "profile.swishNumber",
          "preferences",
          "preferences.locale",
          "preferences.theme",
          "preferences.weeklyDigestEnabled",
          "preferences.inventoryViewPrefs",
          "preferences.personalBudgetMonthStartDay",
          "householdMemberships",
          "householdMemberships[].householdName",
          "householdMemberships[].role",
          "householdMemberships[].joinedAt",
          "pushSubscriptions",
          "pushSubscriptions[].pushService",
          "pushSubscriptions[].createdAt",
          "pushSubscriptions[].quietHoursStart",
          "pushSubscriptions[].quietHoursEnd",
          "pushSubscriptions[].timeZone",
          "personalBudgetCategories",
          "personalBudgetCategories[].id",
          "personalBudgetCategories[].name",
          "personalBudgetCategories[].type",
          "personalBudgetCategories[].createdAt",
          "personalTransactions",
          "personalTransactions[].categoryId",
          "personalTransactions[].amount",
          "personalTransactions[].type",
          "personalTransactions[].description",
          "personalTransactions[].date",
          "personalTransactions[].isRecurring",
          "personalTransactions[].recurrenceFrequency",
          "personalTransactions[].recurringTemplateId",
          "personalTransactions[].plannedExpenseId",
          "personalTransactions[].createdAt",
          "personalRecurringTemplates",
          "personalRecurringTemplates[].id",
          "personalRecurringTemplates[].categoryId",
          "personalRecurringTemplates[].name",
          "personalRecurringTemplates[].amount",
          "personalRecurringTemplates[].type",
          "personalRecurringTemplates[].frequency",
          "personalRecurringTemplates[].dayOfMonth",
          "personalRecurringTemplates[].active",
          "personalRecurringTemplates[].createdAt",
          "personalRecurringTemplates[].acknowledgements",
          "personalRecurringTemplates[].acknowledgements[].periodKey",
          "personalRecurringTemplates[].acknowledgements[].createdAt",
          "personalPlannedExpenses",
          "personalPlannedExpenses[].id",
          "personalPlannedExpenses[].categoryId",
          "personalPlannedExpenses[].name",
          "personalPlannedExpenses[].amount",
          "personalPlannedExpenses[].dueDate",
          "personalPlannedExpenses[].createdAt",
          "householdNotes",
          "householdNotes[].householdName",
          "householdNotes[].body",
          "householdNotes[].createdAt",
          "householdTasks",
          "householdTasks[].householdName",
          "householdTasks[].title",
          "householdTasks[].assignedToMe",
          "householdTasks[].completedByMe",
          "householdTasks[].completedAt",
          "householdTasks[].recurrenceIntervalDays",
          "householdTasks[].createdAt",
          "transactionSplits",
          "transactionSplits[].householdName",
          "transactionSplits[].transactionDescription",
          "transactionSplits[].transactionAmount",
          "transactionSplits[].transactionType",
          "transactionSplits[].transactionDate",
          "transactionSplits[].amountOwed",
          "transactionSplits[].amountPaid",
          "transactionSplits[].createdAt",
          "recurringTemplateSplits",
          "recurringTemplateSplits[].householdName",
          "recurringTemplateSplits[].templateName",
          "recurringTemplateSplits[].templateAmount",
          "recurringTemplateSplits[].templateType",
          "recurringTemplateSplits[].frequency",
          "recurringTemplateSplits[].amountOwed",
          "recurringTemplateSplits[].createdAt",
          "plannedExpenseSplits",
          "plannedExpenseSplits[].householdName",
          "plannedExpenseSplits[].billName",
          "plannedExpenseSplits[].billAmount",
          "plannedExpenseSplits[].dueDate",
          "plannedExpenseSplits[].amountOwed",
          "plannedExpenseSplits[].createdAt",
          "memberSettlements",
          "memberSettlements[].householdName",
          "memberSettlements[].direction",
          "memberSettlements[].counterpartyName",
          "memberSettlements[].amount",
          "memberSettlements[].date",
          "memberSettlements[].createdAt",
          "invitationsSent",
          "invitationsSent[].householdName",
          "invitationsSent[].createdAt",
          "invitationsSent[].expiresAt",
          "invitationsSent[].acceptedAt",
        ]
      `);
    });

    it("leaves out push credentials and keeps only the push service's origin", async () => {
      seedEverything();
      const bodyText = await (await GET()).text();
      const body = JSON.parse(bodyText);

      expect(body.pushSubscriptions).toEqual([
        {
          pushService: "https://fcm.googleapis.com",
          createdAt: fixedNow.toISOString(),
          quietHoursStart: 22,
          quietHoursEnd: 7,
          timeZone: "Europe/Stockholm",
        },
      ]);
      expect(bodyText).not.toContain("device-secret-path");
      expect(bodyText).not.toContain("auth-secret-key");
      expect(bodyText).not.toContain("p256dh-public-key");
    });

    it("exports preferences, and category/template ids so references resolve", async () => {
      seedEverything();
      const body = await (await GET()).json();

      expect(body.preferences).toEqual({
        locale: "sv",
        theme: "light",
        weeklyDigestEnabled: true,
        inventoryViewPrefs: { groupBy: "location" },
        personalBudgetMonthStartDay: 25,
      });
      expect(body.personalTransactions[0].categoryId).toBe(body.personalBudgetCategories[0].id);
      expect(body.personalTransactions[0].recurringTemplateId).toBe(body.personalRecurringTemplates[0].id);
      expect(body.personalRecurringTemplates[0].categoryId).toBe(body.personalBudgetCategories[0].id);
    });

    it("marks tasks and settlements from the caller's side", async () => {
      seedEverything();
      const body = await (await GET()).json();

      expect(body.householdTasks[0]).toMatchObject({ assignedToMe: false, completedByMe: true });
      const settlements = body.memberSettlements as { direction: string; counterpartyName: string }[];
      expect(settlements.map((s) => [s.direction, s.counterpartyName])).toEqual([
        ["paid", "Anna"],
        ["received", "Anna"],
      ]);
      // The rotation lists other members' ids: household schedule, not mine.
      expect(JSON.stringify(body)).not.toContain("m-2");
    });

    it("scopes every per-member query to the caller's own memberships", async () => {
      seedEverything();
      await GET();

      const mine = { userId: "user-1" };
      expect(pushSubscriptionFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: mine }));
      expect(householdNoteFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { authorMember: mine } }),
      );
      expect(householdTaskFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ assignedToMember: mine }, { completedByMember: mine }] } }),
      );
      expect(transactionSplitFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { householdMember: mine } }),
      );
      expect(recurringTemplateSplitFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { householdMember: mine } }),
      );
      expect(plannedExpenseSplitFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { householdMember: mine } }),
      );
      expect(memberSettlementFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ fromMember: mine }, { toMember: mine }] } }),
      );
      expect(invitationFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { invitedById: "user-1" } }),
      );
    });

    it("lists the invite links the caller made, without their tokens", async () => {
      seedEverything();
      const bodyText = await (await GET()).text();

      expect(JSON.parse(bodyText).invitationsSent).toEqual([
        {
          householdName: "The Hectors",
          createdAt: fixedNow.toISOString(),
          expiresAt: fixedNow.toISOString(),
          acceptedAt: null,
        },
      ]);
      expect(bodyText).not.toContain("invite-bearer-token");
    });
  });
});
