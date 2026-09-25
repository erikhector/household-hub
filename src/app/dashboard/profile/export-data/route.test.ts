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
} = vi.hoisted(() => ({
  requireUserIdMock: vi.fn(async () => "user-1"),
  userFindUniqueOrThrowMock: vi.fn(),
  householdMemberFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  personalBudgetCategoryFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  personalTransactionFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  personalRecurringTemplateFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUniqueOrThrow: userFindUniqueOrThrowMock },
    householdMember: { findMany: householdMemberFindManyMock },
    personalBudgetCategory: { findMany: personalBudgetCategoryFindManyMock },
    personalTransaction: { findMany: personalTransactionFindManyMock },
    personalRecurringTemplate: { findMany: personalRecurringTemplateFindManyMock },
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
});
