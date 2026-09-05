// Tests getNotifications() (src/lib/notifications.ts): the low-stock filter
// and the today+2-days meal-plan-gap window. Prisma is mocked so this never
// touches a real database — see REQUIREMENTS.md's "Testing" section.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { inventoryFindManyMock, mealPlanEntryFindManyMock } = vi.hoisted(() => ({
  inventoryFindManyMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: { findMany: inventoryFindManyMock },
    mealPlanEntry: { findMany: mealPlanEntryFindManyMock },
  },
}));

const { getNotifications } = await import("@/lib/notifications");

function inventoryItem(overrides: Partial<{
  id: string;
  name: string;
  quantity: number;
  lowStockThreshold: number;
  unit: string;
}>) {
  return {
    id: "item-1",
    name: "Milk",
    quantity: 5,
    lowStockThreshold: 2,
    unit: "L",
    ...overrides,
  };
}

beforeEach(() => {
  // "Today" is fixed so the meal-plan-gap window (today + next 2 days) is
  // deterministic: 2026-09-05, -06, -07.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
  inventoryFindManyMock.mockResolvedValue([]);
  mealPlanEntryFindManyMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("getNotifications", () => {
  it("only includes inventory items at or below their low-stock threshold", async () => {
    inventoryFindManyMock.mockResolvedValue([
      inventoryItem({ id: "out-1", name: "Eggs", quantity: 0, lowStockThreshold: 6, unit: "pcs" }),
      inventoryItem({ id: "low-1", name: "Milk", quantity: 1, lowStockThreshold: 2, unit: "L" }),
      inventoryItem({ id: "in-1", name: "Rice", quantity: 10, lowStockThreshold: 2, unit: "kg" }),
    ]);
    mealPlanEntryFindManyMock.mockResolvedValue([
      { date: new Date("2026-09-05T00:00:00.000Z") },
      { date: new Date("2026-09-06T00:00:00.000Z") },
      { date: new Date("2026-09-07T00:00:00.000Z") },
    ]);

    const notifications = await getNotifications("household-1");
    const lowStock = notifications.filter((n) => n.kind === "lowStock");

    expect(lowStock).toHaveLength(2);
    expect(lowStock.map((n) => n.itemId).sort()).toEqual(["low-1", "out-1"]);
    expect(lowStock.find((n) => n.itemId === "out-1")).toMatchObject({ status: "out" });
    expect(lowStock.find((n) => n.itemId === "low-1")).toMatchObject({ status: "low" });
  });

  it("flags any of the next 3 days (today + 2) with zero meal-plan entries", async () => {
    // Only tomorrow (09-06) has a planned meal; today and the day after don't.
    mealPlanEntryFindManyMock.mockResolvedValue([{ date: new Date("2026-09-06T00:00:00.000Z") }]);

    const notifications = await getNotifications("household-1");
    const gaps = notifications.filter((n) => n.kind === "mealGap");

    expect(gaps.map((g) => g.dateKey).sort()).toEqual(["2026-09-05", "2026-09-07"]);
    expect(gaps.find((g) => g.dateKey === "2026-09-05")).toMatchObject({ offsetDays: 0 });
    expect(gaps.find((g) => g.dateKey === "2026-09-07")).toMatchObject({ offsetDays: 2 });
  });

  it("returns no meal-plan-gap alerts when every day in the window has an entry", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([
      { date: new Date("2026-09-05T00:00:00.000Z") },
      { date: new Date("2026-09-06T00:00:00.000Z") },
      { date: new Date("2026-09-07T00:00:00.000Z") },
    ]);

    const notifications = await getNotifications("household-1");

    expect(notifications.filter((n) => n.kind === "mealGap")).toHaveLength(0);
  });

  it("scopes both queries to the given household", async () => {
    await getNotifications("household-42");

    expect(inventoryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-42" } }),
    );
    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mealPlan: { householdId: "household-42" } }),
      }),
    );
  });
});
