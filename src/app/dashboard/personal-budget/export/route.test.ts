// Tests the /dashboard/personal-budget/export Route Handler (F9) — mirrors
// src/app/dashboard/budget/export/route.test.ts's pattern for the household
// budget's export. Prisma, requireUserId, and getDictionary are mocked — no
// database is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserIdMock, personalTransactionFindManyMock } = vi.hoisted(() => ({
  requireUserIdMock: vi.fn(),
  personalTransactionFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { personalTransaction: { findMany: personalTransactionFindManyMock } },
}));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    personalBudget: {
      type: { income: "Income", expense: "Expense", savings: "Savings" },
    },
    export: {
      yes: "Yes",
      no: "No",
      personalBudget: {
        fileNamePrefix: "personal-budget-transactions",
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

const { GET } = await import("@/app/dashboard/personal-budget/export/route");

beforeEach(() => {
  requireUserIdMock.mockResolvedValue("user-1");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("GET /dashboard/personal-budget/export", () => {
  it("scopes the query to the session's user id, never a client-supplied one", async () => {
    await GET();

    expect(requireUserIdMock).toHaveBeenCalledTimes(1);
    expect(personalTransactionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1" }),
      }),
    );
  });

  it("queries only the current calendar month's [monthStart, monthEnd) window, not full history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0));

    await GET();

    expect(personalTransactionFindManyMock).toHaveBeenCalledWith(
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
      'attachment; filename="personal-budget-transactions-2026-03.csv"',
    );
  });

  it("renders a transaction row with date, category, type, amount, description, and recurring columns", async () => {
    personalTransactionFindManyMock.mockResolvedValue([
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

  it("rejects an unauthenticated request the same way requireUserId does elsewhere (redirect)", async () => {
    requireUserIdMock.mockRejectedValue(new Error("REDIRECT:/login"));

    await expect(GET()).rejects.toThrow("REDIRECT:/login");
    expect(personalTransactionFindManyMock).not.toHaveBeenCalled();
  });
});
