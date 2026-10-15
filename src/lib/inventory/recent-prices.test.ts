import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, findManyMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { priceHistory: { findMany: findManyMock } } }));

import { getRecentPrices, perUnitPrice, RECENT_PRICES_LIMIT } from "./recent-prices";

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  date: new Date("2026-09-01"),
  store: null,
  price: 30,
  quantity: 2,
  unit: "l",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household: { id: "h1" } });
  findManyMock.mockResolvedValue([]);
});

describe("perUnitPrice", () => {
  it("divides the line price by its quantity", () => {
    expect(perUnitPrice(30, 2)).toBe(15);
  });

  it("is null without a usable quantity", () => {
    expect(perUnitPrice(30, null)).toBeNull();
    expect(perUnitPrice(30, 0)).toBeNull();
    expect(perUnitPrice(30, -1)).toBeNull();
  });
});

describe("getRecentPrices", () => {
  it("scopes the read to the session's household, not to the caller", async () => {
    await getRecentPrices("item-1");
    expect(requireHouseholdMock).toHaveBeenCalledOnce();
    expect(findManyMock.mock.calls[0][0].where).toEqual({
      inventoryItemId: "item-1",
      inventoryItem: { householdId: "h1" },
    });
  });

  it("asks for the newest first, capped at ten, with a stable tie-break", async () => {
    await getRecentPrices("item-1");
    const args = findManyMock.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ date: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(RECENT_PRICES_LIMIT);
    expect(RECENT_PRICES_LIMIT).toBe(10);
  });

  it("keeps the database's order and adds per-unit prices", async () => {
    findManyMock.mockResolvedValue([
      row("b", { date: new Date("2026-09-10"), price: 33, quantity: 2 }),
      row("a", { date: new Date("2026-09-01"), quantity: null, unit: null }),
    ]);
    const result = await getRecentPrices("item-1");
    expect(result.map((r) => r.id)).toEqual(["b", "a"]);
    expect(result[0].unitPrice).toBe(16.5);
    expect(result[1].unitPrice).toBeNull();
  });

  it("returns nothing for an item with no history or another household's item", async () => {
    expect(await getRecentPrices("someone-elses")).toEqual([]);
  });

  it("reads nothing when there is no household", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("redirect"));
    await expect(getRecentPrices("item-1")).rejects.toThrow();
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
