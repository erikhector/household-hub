// Tests the week picks actions in pick-actions.ts. All I/O (Prisma,
// requireHousehold, next/cache) is mocked, following template-actions.test.ts.
// The transaction runs its callback against the same mocked client.
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireHousehold: vi.fn(),
  recipeCount: vi.fn(),
  recipeUpdateMany: vi.fn(),
  planUpsert: vi.fn(),
  pickCreateManyAndReturn: vi.fn(),
  pickCreate: vi.fn(),
  pickDeleteMany: vi.fn(),
  pickFindFirst: vi.fn(),
  pickFindMany: vi.fn(),
  entryCreate: vi.fn(),
  entryFindMany: vi.fn(),
  entryDeleteMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {
    recipe: { count: m.recipeCount, updateMany: m.recipeUpdateMany },
    mealPlan: { upsert: m.planUpsert },
    mealPlanPick: {
      createManyAndReturn: m.pickCreateManyAndReturn,
      create: m.pickCreate,
      deleteMany: m.pickDeleteMany,
      findFirst: m.pickFindFirst,
      findMany: m.pickFindMany,
    },
    mealPlanEntry: { create: m.entryCreate, findMany: m.entryFindMany, deleteMany: m.entryDeleteMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return { prisma: client };
});
vi.mock("@/lib/session", () => ({ requireHousehold: m.requireHousehold }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en), getLocale: vi.fn(async () => "en") };
});
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

const {
  addPicksAction,
  undoAddPicksAction,
  removePickAction,
  placePickAction,
  placePicksAction,
  unplaceEntriesAction,
} = await import("@/app/dashboard/meal-planning/pick-actions");

const household = { id: "household-1" };
const session = { household, userId: "user-1" };

afterEach(() => {
  vi.resetAllMocks();
  m.requireHousehold.mockResolvedValue(session);
});
m.requireHousehold.mockResolvedValue(session);

const MONDAY = "2026-11-02";

describe("addPicksAction", () => {
  it("rejects a week key that isn't a Monday", async () => {
    const result = await addPicksAction("2026-11-03", [{ recipeId: "r1", portions: 4 }]);
    expect(result.error).toBe("Invalid week");
    expect(m.pickCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it("needs a recipe or a name, not both and not neither", async () => {
    expect((await addPicksAction(MONDAY, [{ portions: 4 }])).error).toMatch(/Choose a recipe/);
    expect((await addPicksAction(MONDAY, [{ recipeId: "r1", freeformName: "Tacos", portions: 4 }])).error).toMatch(
      /Choose a recipe/,
    );
    expect((await addPicksAction(MONDAY, [{ recipeId: "r1", portions: 0 }])).error).toMatch(/Portions/);
  });

  it("refuses a recipe from another household", async () => {
    m.recipeCount.mockResolvedValue(0);
    const result = await addPicksAction(MONDAY, [{ recipeId: "theirs", portions: 4 }]);
    expect(result.error).toBe("Recipe not found");
    expect(m.recipeCount.mock.calls[0][0].where).toEqual({ id: { in: ["theirs"] }, householdId: "household-1" });
    expect(m.planUpsert).not.toHaveBeenCalled();
  });

  it("adds recipe and custom picks to this household's week, by this member", async () => {
    m.recipeCount.mockResolvedValue(1);
    m.planUpsert.mockResolvedValue({ id: "plan-1" });
    m.pickCreateManyAndReturn.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);

    const result = await addPicksAction(MONDAY, [
      { recipeId: "r1", portions: 2 },
      { freeformName: "  Taco night  ", portions: 4 },
    ]);

    expect(result).toEqual({ pickIds: ["p1", "p2"] });
    expect(m.planUpsert.mock.calls[0][0].where.householdId_weekStartDate).toEqual({
      householdId: "household-1",
      weekStartDate: new Date("2026-11-02T00:00:00.000Z"),
    });
    expect(m.pickCreateManyAndReturn.mock.calls[0][0].data).toEqual([
      { mealPlanId: "plan-1", recipeId: "r1", freeformName: null, portions: 2, createdByUserId: "user-1" },
      { mealPlanId: "plan-1", recipeId: null, freeformName: "Taco night", portions: 4, createdByUserId: "user-1" },
    ]);
    // Picking doesn't clear Cook soon: a pick has no day yet.
    expect(m.recipeUpdateMany).not.toHaveBeenCalled();
    expect(m.revalidatePath).toHaveBeenCalledWith("/dashboard/meal-planning");
  });
});

describe("undoAddPicksAction and removePickAction", () => {
  it("delete only this household's picks", async () => {
    m.pickDeleteMany.mockResolvedValue({ count: 1 });
    expect(await undoAddPicksAction(["p1", "p2"])).toEqual({});
    expect(m.pickDeleteMany.mock.calls[0][0].where).toEqual({
      id: { in: ["p1", "p2"] },
      mealPlan: { householdId: "household-1" },
    });
    expect(await removePickAction("p3")).toEqual({});
    expect(m.pickDeleteMany.mock.calls[1][0].where).toEqual({ id: "p3", mealPlan: { householdId: "household-1" } });
  });

  it("reject an empty or oversized id list", async () => {
    expect((await undoAddPicksAction([])).error).toBe("Invalid input");
    expect((await undoAddPicksAction(Array.from({ length: 31 }, (_, i) => `p${i}`))).error).toBe("Invalid input");
    expect(m.pickDeleteMany).not.toHaveBeenCalled();
  });
});

describe("placePickAction", () => {
  it("rejects a date that doesn't exist and an unknown slot", async () => {
    expect((await placePickAction("p1", "2026-02-31", "DINNER")).error).toBe("Invalid date");
    expect((await placePickAction("p1", MONDAY, "BRUNCH" as never)).error).toBeTruthy();
    expect(m.pickFindFirst).not.toHaveBeenCalled();
  });

  it("refuses a pick from another household", async () => {
    m.pickFindFirst.mockResolvedValue(null);
    const result = await placePickAction("theirs", MONDAY, "DINNER");
    expect(result.error).toMatch(/isn't in your picks/);
    expect(m.pickFindFirst.mock.calls[0][0].where).toEqual({ id: "theirs", mealPlan: { householdId: "household-1" } });
    expect(m.entryCreate).not.toHaveBeenCalled();
  });

  it("moves the pick onto the day in the date's own week and clears Cook soon", async () => {
    m.pickFindFirst.mockResolvedValue({ id: "p1", recipeId: "r1", freeformName: null, portions: 2 });
    m.pickDeleteMany.mockResolvedValue({ count: 1 });
    m.planUpsert.mockResolvedValue({ id: "plan-2" });
    m.entryCreate.mockResolvedValue({ id: "e1" });

    // A Thursday in the week of 9 November: the week comes from the date.
    const result = await placePickAction("p1", "2026-11-12", "LUNCH");

    expect(result).toEqual({ entryId: "e1" });
    expect(m.pickDeleteMany.mock.calls[0][0].where).toEqual({ id: "p1", mealPlan: { householdId: "household-1" } });
    expect(m.planUpsert.mock.calls[0][0].where.householdId_weekStartDate.weekStartDate).toEqual(
      new Date("2026-11-09T00:00:00.000Z"),
    );
    expect(m.entryCreate.mock.calls[0][0].data).toEqual({
      mealPlanId: "plan-2",
      date: new Date("2026-11-12T00:00:00.000Z"),
      mealType: "LUNCH",
      recipeId: "r1",
      freeformName: null,
      portions: 2,
    });
    expect(m.recipeUpdateMany.mock.calls[0][0].where).toEqual({
      id: "r1",
      householdId: "household-1",
      cookSoonAt: { not: null },
    });
  });

  it("makes no entry when the pick was placed meanwhile", async () => {
    m.pickFindFirst.mockResolvedValue({ id: "p1", recipeId: null, freeformName: "Tacos", portions: 4 });
    m.pickDeleteMany.mockResolvedValue({ count: 0 });
    const result = await placePickAction("p1", MONDAY, "DINNER");
    expect(result.error).toMatch(/isn't in your picks/);
    expect(m.entryCreate).not.toHaveBeenCalled();
  });
});

describe("placePicksAction", () => {
  it("rejects the same pick twice", async () => {
    const result = await placePicksAction([
      { pickId: "p1", date: MONDAY },
      { pickId: "p1", date: "2026-11-03" },
    ]);
    expect(result.error).toBe("Invalid input");
    expect(m.pickFindMany).not.toHaveBeenCalled();
  });

  it("fails as a whole when one pick isn't this household's", async () => {
    m.pickFindMany.mockResolvedValue([{ id: "p1", recipeId: "r1", freeformName: null, portions: 4 }]);
    const result = await placePicksAction([
      { pickId: "p1", date: MONDAY },
      { pickId: "theirs", date: "2026-11-03" },
    ]);
    expect(result.error).toMatch(/isn't in your picks/);
    expect(m.pickFindMany.mock.calls[0][0].where.mealPlan).toEqual({ householdId: "household-1" });
    expect(m.entryCreate).not.toHaveBeenCalled();
  });

  it("puts every pick on its day's dinner and returns the entries", async () => {
    m.pickFindMany.mockResolvedValue([
      { id: "p1", recipeId: "r1", freeformName: null, portions: 4 },
      { id: "p2", recipeId: null, freeformName: "Tacos", portions: 4 },
    ]);
    m.pickDeleteMany.mockResolvedValue({ count: 1 });
    m.planUpsert.mockResolvedValue({ id: "plan-1" });
    m.entryCreate.mockResolvedValueOnce({ id: "e1" }).mockResolvedValueOnce({ id: "e2" });

    const result = await placePicksAction([
      { pickId: "p1", date: MONDAY },
      { pickId: "p2", date: "2026-11-04" },
    ]);

    expect(result).toEqual({ entryIds: ["e1", "e2"] });
    expect(m.entryCreate.mock.calls.map((c) => [c[0].data.mealType, c[0].data.freeformName])).toEqual([
      ["DINNER", null],
      ["DINNER", "Tacos"],
    ]);
  });
});

describe("unplaceEntriesAction", () => {
  it("only reads this household's uncooked, unprepped meals", async () => {
    m.entryFindMany.mockResolvedValue([]);
    const result = await unplaceEntriesAction(["e1"]);
    expect(result.error).toMatch(/can't go back to your picks/);
    expect(m.entryFindMany.mock.calls[0][0].where).toEqual({
      id: { in: ["e1"] },
      mealPlan: { householdId: "household-1" },
      consumedAt: null,
      preparedBatchId: null,
    });
    expect(m.pickCreate).not.toHaveBeenCalled();
  });

  it("turns each meal back into a pick in the same week", async () => {
    m.entryFindMany.mockResolvedValue([
      { id: "e1", mealPlanId: "plan-1", recipeId: "r1", freeformName: null, portions: 2 },
    ]);
    m.entryDeleteMany.mockResolvedValue({ count: 1 });
    m.pickCreate.mockResolvedValue({ id: "p9" });

    const result = await unplaceEntriesAction(["e1"]);

    expect(result).toEqual({ pickIds: ["p9"] });
    expect(m.entryDeleteMany.mock.calls[0][0].where).toEqual({ id: "e1", consumedAt: null, preparedBatchId: null });
    expect(m.pickCreate.mock.calls[0][0].data).toEqual({
      mealPlanId: "plan-1",
      recipeId: "r1",
      freeformName: null,
      portions: 2,
      createdByUserId: "user-1",
    });
  });

  it("leaves a meal cooked in the meantime on its day", async () => {
    m.entryFindMany.mockResolvedValue([
      { id: "e1", mealPlanId: "plan-1", recipeId: "r1", freeformName: null, portions: 2 },
    ]);
    m.entryDeleteMany.mockResolvedValue({ count: 0 });
    const result = await unplaceEntriesAction(["e1"]);
    expect(result.error).toMatch(/can't go back/);
    expect(m.pickCreate).not.toHaveBeenCalled();
  });
});
