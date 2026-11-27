// Tests Squirrel Wrapped's loader (src/lib/wrapped/load.ts): every query is
// scoped to the household it was given and to the year, sample data stays
// out, and the rows reach the calculator in its shape. Prisma is mocked; the
// calculator is the real one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shoppingList: vi.fn(),
  shoppingListItem: vi.fn(),
  mealPlanEntry: vi.fn(),
  inventoryItemEvent: vi.fn(),
  householdTask: vi.fn(),
  householdEvent: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: Object.fromEntries(Object.entries(mocks).map(([model, findMany]) => [model, { findMany }])),
}));

const { loadWrapped } = await import("@/lib/wrapped/load");

const NOW = new Date("2026-11-27T12:00:00Z");

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue([]);
});

describe("loadWrapped", () => {
  it("scopes every query to the household", async () => {
    await loadWrapped("h1", 2026, NOW, "UTC");
    const where = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls[0][0].where;
    expect(where(mocks.shoppingList).householdId).toBe("h1");
    expect(where(mocks.shoppingListItem).shoppingList).toEqual({ householdId: "h1" });
    expect(where(mocks.mealPlanEntry).mealPlan).toEqual({ householdId: "h1" });
    expect(where(mocks.inventoryItemEvent).householdId).toBe("h1");
    expect(where(mocks.householdTask).householdId).toBe("h1");
    expect(where(mocks.householdEvent).householdId).toBe("h1");
    expect(where(mocks.transaction).householdId).toBe("h1");
  });

  it("bounds the instants by the year so far and leaves sample data out", async () => {
    await loadWrapped("h1", 2026, NOW, "UTC");
    const where = mocks.householdTask.mock.calls[0][0].where;
    expect(where.sample).toBeNull();
    expect(where.completedAt).toEqual({
      gte: new Date("2026-01-01T00:00:00Z"),
      lt: new Date("2026-11-28T00:00:00Z"),
    });
    expect(mocks.inventoryItemEvent.mock.calls[0][0].where.item).toEqual({ sample: null });
    expect(mocks.transaction.mock.calls[0][0].where.date).toEqual({
      gte: new Date("2026-01-01T00:00:00Z"),
      lt: new Date("2026-11-28T00:00:00Z"),
    });
  });

  it("is thin for a household with nothing this year", async () => {
    expect(await loadWrapped("h1", 2026, NOW, "UTC")).toEqual({ state: "thin", year: 2026 });
  });

  it("hands the rows to the calculator", async () => {
    mocks.householdTask.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ completedAt: new Date(Date.UTC(2026, 2, 1 + i, 12)) })),
    );
    mocks.mealPlanEntry.mockResolvedValue([
      { consumedAt: new Date("2026-04-01T18:00:00Z"), recipeId: "r1", recipe: { name: "Soup" } },
      { consumedAt: new Date("2026-04-02T18:00:00Z"), recipeId: "r1", recipe: { name: "Soup" } },
    ]);
    const result = await loadWrapped("h1", 2026, NOW, "UTC");
    if (result.state !== "story") throw new Error("expected a story");
    expect(result.stats.tasks.completed).toBe(10);
    expect(result.stats.meals).toEqual({ cooked: 2, topRecipe: { name: "Soup", count: 2 } });
  });
});
