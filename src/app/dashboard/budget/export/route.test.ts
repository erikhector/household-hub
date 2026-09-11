// Tests the /dashboard/budget/export Route Handler. Prisma, requireHousehold,
// and getDictionary are mocked — no database is touched, same pattern as
// src/app/dashboard/profile/export-data/route.test.ts and
// src/app/dashboard/shopping-list/actions.test.ts's getDictionary mock. See
// REQUIREMENTS.md's "Data export (CSV)" subsection: the household is always
// re-derived server-side via requireHousehold() (never a client-supplied
// id), and only the current calendar month's transactions
// (`[monthStart, monthEnd)`) are exported, not the household's full history.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, transactionFindManyMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  transactionFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: transactionFindManyMock } },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    budget: {
      type: { income: "Income", expense: "Expense", savings: "Savings" },
    },
    export: {
      yes: "Yes",
      no: "No",
      budget: {
        fileNamePrefix: "budget-transactions",
        headerDate: "Date",
        headerCategory: "Category",
        headerType: "Type",
        headerAmount: "Amount",
        headerDescription: "Description",
        headerRecurring: "Recurring",
      },
    },
  })),
}));

const { GET } = await import("@/app/dashboard/budget/export/route");

function household(id: string) {
  return {
    userId: "user-1",
    household: { id, name: `Household ${id}` },
    role: "OWNER" as const,
    households: [{ id, name: `Household ${id}`, role: "OWNER" as const }],
  };
}

beforeEach(() => {
  requireHouseholdMock.mockResolvedValue(household("household-1"));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("GET /dashboard/budget/export", () => {
  it("scopes the query to the session's household id, never a client-supplied one", async () => {
    await GET();

    expect(requireHouseholdMock).toHaveBeenCalledTimes(1);
    expect(transactionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ householdId: "household-1" }),
      }),
    );
  });

  it("queries only the current calendar month's [monthStart, monthEnd) window, not full history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0));

    await GET();

    expect(transactionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: { gte: new Date(2026, 2, 1), lt: new Date(2026, 3, 1) },
        }),
      }),
    );
  });

  it("returns CSV Content-Type and a Content-Disposition attachment filename", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="budget-transactions-2026-03.csv"',
    );
  });

  it("renders a transaction row with date, category, type, amount, description, and recurring columns", async () => {
    transactionFindManyMock.mockResolvedValue([
      {
        id: "txn-1",
        date: new Date("2026-03-10T00:00:00.000Z"),
        category: { name: "Groceries" },
        type: "EXPENSE",
        amount: 42.5,
        description: "Weekly shop",
        isRecurring: true,
      },
    ]);

    const response = await GET();
    const csv = await response.text();

    expect(csv).toBe(
      "Date,Category,Type,Amount,Description,Recurring\r\n" +
        "2026-03-10,Groceries,Expense,42.5,Weekly shop,Yes\r\n",
    );
  });

  it("rejects an unauthenticated request the same way requireHousehold does elsewhere (redirect)", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("REDIRECT:/login"));

    await expect(GET()).rejects.toThrow("REDIRECT:/login");
    expect(transactionFindManyMock).not.toHaveBeenCalled();
  });
});
