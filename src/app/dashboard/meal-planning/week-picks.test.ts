// Tests week-picks.ts: carry-over on read and the tray's data shape. Prisma
// is mocked; the transaction runs its callback against the same client.
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  pickFindMany: vi.fn(),
  pickUpdateMany: vi.fn(),
  planUpsert: vi.fn(),
  entryFindMany: vi.fn(),
  memberFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {
    mealPlanPick: { findMany: m.pickFindMany, updateMany: m.pickUpdateMany },
    mealPlan: { upsert: m.planUpsert },
    mealPlanEntry: { findMany: m.entryFindMany },
    householdMember: { findMany: m.memberFindMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return { prisma: client };
});

const { carryOverPastPicks, loadWeekPicks } = await import("@/app/dashboard/meal-planning/week-picks");

afterEach(() => vi.resetAllMocks());

// A Wednesday: the current week starts Monday 2 November.
const now = new Date("2026-11-04T10:00:00Z");
const thisWeek = new Date("2026-11-02T00:00:00.000Z");
const lastWeek = new Date("2026-10-26T00:00:00.000Z");

describe("carryOverPastPicks", () => {
  it("does nothing, and writes nothing, when no past week has picks left", async () => {
    m.pickFindMany.mockResolvedValue([]);
    expect(await carryOverPastPicks("household-1", now)).toBe(0);
    expect(m.pickFindMany.mock.calls[0][0].where).toEqual({
      mealPlan: { householdId: "household-1", weekStartDate: { lt: thisWeek } },
    });
    expect(m.planUpsert).not.toHaveBeenCalled();
  });

  it("moves past picks into this week, marked with the week they came from", async () => {
    m.pickFindMany.mockResolvedValue([
      { id: "p1", carriedFromWeek: null, mealPlan: { weekStartDate: lastWeek } },
      // Already carried once: keeps the week it first came from.
      { id: "p2", carriedFromWeek: new Date("2026-10-19T00:00:00.000Z"), mealPlan: { weekStartDate: lastWeek } },
    ]);
    m.planUpsert.mockResolvedValue({ id: "plan-now" });
    m.pickUpdateMany.mockResolvedValue({ count: 1 });

    expect(await carryOverPastPicks("household-1", now)).toBe(2);
    expect(m.planUpsert.mock.calls[0][0].where.householdId_weekStartDate).toEqual({
      householdId: "household-1",
      weekStartDate: thisWeek,
    });
    expect(m.pickUpdateMany.mock.calls.map((c) => c[0])).toEqual([
      {
        where: { id: "p1", mealPlan: { householdId: "household-1", weekStartDate: { lt: thisWeek } } },
        data: { mealPlanId: "plan-now", carriedFromWeek: lastWeek },
      },
      {
        where: { id: "p2", mealPlan: { householdId: "household-1", weekStartDate: { lt: thisWeek } } },
        data: { mealPlanId: "plan-now", carriedFromWeek: new Date("2026-10-19T00:00:00.000Z") },
      },
    ]);
  });

  it("counts only the picks this call moved (another load got there first)", async () => {
    m.pickFindMany.mockResolvedValue([{ id: "p1", carriedFromWeek: null, mealPlan: { weekStartDate: lastWeek } }]);
    m.planUpsert.mockResolvedValue({ id: "plan-now" });
    m.pickUpdateMany.mockResolvedValue({ count: 0 });
    expect(await carryOverPastPicks("household-1", now)).toBe(0);
  });
});

describe("loadWeekPicks", () => {
  const base = { householdId: "household-1", userId: "me", now };

  it("returns nothing, with no queries, for an empty tray", async () => {
    expect(await loadWeekPicks({ ...base, picks: [], recipes: [], inventoryItems: [] })).toEqual([]);
    expect(m.entryFindMany).not.toHaveBeenCalled();
  });

  it("names the picker, finds the habit day and the most perishable ingredient", async () => {
    // Pea soup cooked on two Thursdays.
    m.entryFindMany.mockResolvedValue([
      { recipeId: "soup", date: new Date("2026-10-15T00:00:00Z") },
      { recipeId: "soup", date: new Date("2026-10-22T00:00:00Z") },
    ]);
    m.memberFindMany.mockResolvedValue([{ userId: "anna", user: { displayName: "Anna" } }]);

    const picks = await loadWeekPicks({
      ...base,
      picks: [
        {
          id: "p1",
          recipeId: "soup",
          freeformName: null,
          portions: 4,
          carriedFromWeek: lastWeek,
          createdByUserId: "anna",
          recipe: { name: "Pea soup" },
        },
        {
          id: "p2",
          recipeId: null,
          freeformName: "Taco night",
          portions: 4,
          carriedFromWeek: null,
          createdByUserId: "me",
          recipe: null,
        },
      ],
      recipes: [
        {
          id: "soup",
          ingredients: [
            { name: "ham", inventoryItemId: "inv-ham", untracked: false },
            { name: "salt", inventoryItemId: "inv-salt", untracked: true },
          ],
        },
      ],
      inventoryItems: [
        { id: "inv-ham", name: "Ham", quantity: 0, expiresAt: null, shelfLifeDays: 3, category: "Meat" },
        { id: "inv-salt", name: "Salt", quantity: 0, expiresAt: null, shelfLifeDays: 1, category: "Pantry" },
      ],
    });

    expect(picks).toEqual([
      {
        id: "p1",
        recipeId: "soup",
        name: "Pea soup",
        portions: 4,
        carried: true,
        pickedBy: "Anna",
        habitWeekday: 3,
        // Salt is "Don't track", so it says nothing.
        freshness: { days: 3, item: "Ham" },
      },
      {
        id: "p2",
        recipeId: null,
        name: "Taco night",
        portions: 4,
        carried: false,
        pickedBy: null,
        habitWeekday: null,
        freshness: null,
      },
    ]);
    // Only this household's cooked history and members, never the viewer.
    expect(m.entryFindMany.mock.calls[0][0].where).toMatchObject({
      mealPlan: { householdId: "household-1" },
      recipeId: { in: ["soup"] },
      consumedAt: { not: null },
    });
    expect(m.memberFindMany.mock.calls[0][0].where).toEqual({ householdId: "household-1", userId: { in: ["anna"] } });
  });
});
