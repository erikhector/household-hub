import { afterEach, describe, expect, it, vi } from "vitest";

const { preparedBatchFindManyMock } = vi.hoisted(() => ({
  preparedBatchFindManyMock: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { preparedBatch: { findMany: preparedBatchFindManyMock } },
}));
const { getActiveBatches } = await import("./prepared-batches");

afterEach(() => {
  vi.clearAllMocks();
});

function row(overrides: {
  id: string;
  remainingPortions?: number;
  linked?: number;
  expiryDate?: Date | null;
  cookedAt?: Date;
  cook?: string | null;
}) {
  return {
    id: overrides.id,
    recipeId: `recipe-${overrides.id}`,
    totalPortions: 8,
    remainingPortions: overrides.remainingPortions ?? 4,
    cookedAt: overrides.cookedAt ?? new Date("2026-10-12T17:00:00.000Z"),
    expiryDate: overrides.expiryDate === undefined ? new Date("2026-10-15T17:00:00.000Z") : overrides.expiryDate,
    recipe: { name: `Dish ${overrides.id}` },
    cookedByMember: overrides.cook === null ? null : { user: { displayName: overrides.cook ?? "Anna" } },
    _count: { mealPlanEntries: overrides.linked ?? 0 },
  };
}

describe("getActiveBatches", () => {
  it("scopes the query to the household and counts every linked entry", async () => {
    preparedBatchFindManyMock.mockResolvedValue([]);
    await getActiveBatches("household-1");
    expect(preparedBatchFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: "household-1" },
        include: expect.objectContaining({ _count: { select: { mealPlanEntries: true } } }),
      }),
    );
  });

  it("drops an empty batch nothing is planned from, but keeps an empty planned one", async () => {
    preparedBatchFindManyMock.mockResolvedValue([
      row({ id: "gone", remainingPortions: 0, linked: 0 }),
      row({ id: "planned", remainingPortions: 0, linked: 2 }),
      row({ id: "left", remainingPortions: 3, linked: 0 }),
    ]);
    const batches = await getActiveBatches("household-2");
    expect(batches.map((b) => b.id).sort()).toEqual(["left", "planned"]);
    expect(batches.find((b) => b.id === "planned")?.plannedCount).toBe(2);
  });

  it("sorts soonest eat-by first, undated batches last", async () => {
    preparedBatchFindManyMock.mockResolvedValue([
      row({ id: "undated", expiryDate: null }),
      row({ id: "later", expiryDate: new Date("2026-10-18T00:00:00.000Z") }),
      row({ id: "sooner", expiryDate: new Date("2026-10-14T00:00:00.000Z") }),
    ]);
    const batches = await getActiveBatches("household-3");
    expect(batches.map((b) => b.id)).toEqual(["sooner", "later", "undated"]);
  });

  it("maps to the display shape, with the cook's name or null", async () => {
    preparedBatchFindManyMock.mockResolvedValue([
      row({ id: "a", cook: "Erik" }),
      row({ id: "b", cook: null, expiryDate: null }),
    ]);
    const [a, b] = await getActiveBatches("household-4");
    expect(a).toEqual({
      id: "a",
      recipeId: "recipe-a",
      recipeName: "Dish a",
      totalPortions: 8,
      remainingPortions: 4,
      cookedAt: "2026-10-12T17:00:00.000Z",
      expiryDate: "2026-10-15T17:00:00.000Z",
      cookedByName: "Erik",
      plannedCount: 0,
    });
    expect(b.cookedByName).toBeNull();
    expect(b.expiryDate).toBeNull();
  });
});
