// searchHouseholdAction: tenancy scoping, validation and rate limiting. Prisma,
// the session and the rate limiter are mocked; no database is touched.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  checkRateLimitMock,
  inventoryMock,
  recipeMock,
  listMock,
  taskMock,
  categoryMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  inventoryMock: vi.fn(),
  recipeMock: vi.fn(),
  listMock: vi.fn(),
  taskMock: vi.fn(),
  categoryMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: { findMany: inventoryMock },
    recipe: { findMany: recipeMock },
    shoppingList: { findMany: listMock },
    householdTask: { findMany: taskMock },
    budgetCategory: { findMany: categoryMock },
  },
}));

import { searchHouseholdAction } from "@/lib/actions/search";

const allMocks = [inventoryMock, recipeMock, listMock, taskMock, categoryMock];

beforeEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ userId: "u1", household: { id: "h1" } });
  checkRateLimitMock.mockResolvedValue(true);
  for (const mock of allMocks) mock.mockResolvedValue([]);
});

describe("searchHouseholdAction", () => {
  it("scopes every query to the session's household, never a client value", async () => {
    await searchHouseholdAction("milk");
    for (const mock of allMocks) {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0][0].where.householdId).toBe("h1");
      expect(mock.mock.calls[0][0].take).toBe(5);
    }
  });

  it("matches names case-insensitively and hides archived shopping lists", async () => {
    await searchHouseholdAction("  Milk ");
    expect(inventoryMock.mock.calls[0][0].where.name).toEqual({ contains: "Milk", mode: "insensitive" });
    expect(taskMock.mock.calls[0][0].where.title).toEqual({ contains: "Milk", mode: "insensitive" });
    expect(listMock.mock.calls[0][0].where.archivedAt).toBeNull();
  });

  it("returns only non-empty groups, each hit with a link to its row", async () => {
    inventoryMock.mockResolvedValue([{ id: "i1", name: "Milk" }]);
    taskMock.mockResolvedValue([{ id: "t1", title: "Buy milk" }]);
    categoryMock.mockResolvedValue([{ id: "c1", name: "Milk run" }]);
    const result = await searchHouseholdAction("milk");
    expect(result).toEqual({
      ok: true,
      groups: [
        { key: "inventory", hits: [{ id: "i1", name: "Milk", href: "/dashboard/inventory/items/i1" }] },
        { key: "tasks", hits: [{ id: "t1", name: "Buy milk", href: "/dashboard/tasks" }] },
        {
          key: "budgetCategories",
          hits: [{ id: "c1", name: "Milk run", href: "/dashboard/budget?tab=transactions&category=c1" }],
        },
      ],
    });
  });

  it.each([["a"], [" "], ["x".repeat(81)], [undefined as unknown as string], [{} as unknown as string]])(
    "treats %j as an empty search without querying",
    async (query) => {
      expect(await searchHouseholdAction(query)).toEqual({ ok: true, groups: [] });
      for (const mock of allMocks) expect(mock).not.toHaveBeenCalled();
    },
  );

  it("refuses without querying once the rate limit is hit", async () => {
    checkRateLimitMock.mockResolvedValue(false);
    expect(await searchHouseholdAction("milk")).toEqual({ ok: false, rateLimited: true });
    expect(checkRateLimitMock.mock.calls[0][0]).toBe("search:u1");
    for (const mock of allMocks) expect(mock).not.toHaveBeenCalled();
  });
});
