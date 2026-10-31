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
  entryCount: vi.fn(),
  memberFindMany: vi.fn(),
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
    mealPlanEntry: {
      create: m.entryCreate,
      findMany: m.entryFindMany,
      deleteMany: m.entryDeleteMany,
      count: m.entryCount,
    },
    householdMember: { findMany: m.memberFindMany },
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

// A Wednesday, so "this week" starts Monday 26 October 2026 and MONDAY
// below is next week. Only Date is faked; promises and timers run as usual.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));

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

  it("refuses a week that is over", async () => {
    m.recipeCount.mockResolvedValue(1);
    const result = await addPicksAction("2026-10-19", [{ recipeId: "r1", portions: 4 }]);
    expect(result.error).toBe("That week is over. Pick meals for this week or a later one.");
    expect(m.planUpsert).not.toHaveBeenCalled();
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
    m.entryCount.mockResolvedValue(0);
    m.entryCreate.mockResolvedValueOnce({ id: "e1" }).mockResolvedValueOnce({ id: "e2" });

    const result = await placePicksAction([
      { pickId: "p1", date: MONDAY },
      { pickId: "p2", date: "2026-11-04" },
    ]);

    expect(result).toEqual({
      placed: [
        { pickId: "p1", entryId: "e1" },
        { pickId: "p2", entryId: "e2" },
      ],
      skipped: 0,
    });
    expect(m.entryCreate.mock.calls.map((c) => [c[0].data.mealType, c[0].data.freeformName])).toEqual([
      ["DINNER", null],
      ["DINNER", "Tacos"],
    ]);
  });

  it("skips a dinner planned since the preview, leaving that pick in the tray", async () => {
    m.pickFindMany.mockResolvedValue([
      { id: "p1", recipeId: "r1", freeformName: null, portions: 4 },
      { id: "p2", recipeId: "r2", freeformName: null, portions: 4 },
    ]);
    // Monday's dinner is taken now; Wednesday's is still free.
    m.entryCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    m.pickDeleteMany.mockResolvedValue({ count: 1 });
    m.planUpsert.mockResolvedValue({ id: "plan-1" });
    m.entryCreate.mockResolvedValue({ id: "e2" });

    const result = await placePicksAction([
      { pickId: "p1", date: MONDAY },
      { pickId: "p2", date: "2026-11-04" },
    ]);

    expect(result).toEqual({ placed: [{ pickId: "p2", entryId: "e2" }], skipped: 1 });
    expect(m.entryCount.mock.calls[0][0].where).toEqual({
      mealPlan: { householdId: "household-1" },
      date: new Date("2026-11-02T00:00:00.000Z"),
      mealType: "DINNER",
    });
    expect(m.pickDeleteMany).toHaveBeenCalledTimes(1);
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
      { id: "e1", mealPlanId: "plan-1", recipeId: "r1", freeformName: null, portions: 2, mealPlan: { weekStartDate: new Date("2026-11-02T00:00:00.000Z") } },
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
      carriedFromWeek: null,
    });
  });

  it("refuses a meal in a week that is over", async () => {
    m.entryFindMany.mockResolvedValue([
      {
        id: "e1",
        mealPlanId: "plan-old",
        recipeId: "r1",
        freeformName: null,
        portions: 2,
        mealPlan: { weekStartDate: new Date("2026-10-19T00:00:00.000Z") },
      },
    ]);
    const result = await unplaceEntriesAction(["e1"]);
    expect(result.error).toMatch(/That week is over/);
    expect(m.entryDeleteMany).not.toHaveBeenCalled();
  });

  it("restores a placed pick's picker and carry-over week on Undo, when they check out", async () => {
    m.entryFindMany.mockResolvedValue([
      { id: "e1", mealPlanId: "plan-1", recipeId: "r1", freeformName: null, portions: 2, mealPlan: { weekStartDate: new Date("2026-11-02T00:00:00.000Z") } },
      { id: "e2", mealPlanId: "plan-1", recipeId: "r2", freeformName: null, portions: 2, mealPlan: { weekStartDate: new Date("2026-11-02T00:00:00.000Z") } },
    ]);
    m.memberFindMany.mockResolvedValue([{ userId: "anna" }]);
    m.entryDeleteMany.mockResolvedValue({ count: 1 });
    m.pickCreate.mockResolvedValue({ id: "p9" });

    await unplaceEntriesAction(
      ["e1", "e2"],
      [
        { entryId: "e1", createdByUserId: "anna", carriedFromWeek: "2026-10-26" },
        // Not a member, and not a Monday: both dropped.
        { entryId: "e2", createdByUserId: "stranger", carriedFromWeek: "2026-10-27" },
      ],
    );

    expect(m.memberFindMany.mock.calls[0][0].where).toEqual({
      householdId: "household-1",
      userId: { in: ["anna", "stranger"] },
    });
    expect(m.pickCreate.mock.calls.map((c) => [c[0].data.createdByUserId, c[0].data.carriedFromWeek])).toEqual([
      ["anna", new Date("2026-10-26T00:00:00.000Z")],
      ["user-1", null],
    ]);
  });

  it("puts a pick back in its own week's tray when the origin names one", async () => {
    // Cooked-today pick from next week: the meal sits in this week's plan.
    m.entryFindMany.mockResolvedValue([
      {
        id: "e1",
        mealPlanId: "plan-now",
        recipeId: "r1",
        freeformName: null,
        portions: 2,
        mealPlan: { weekStartDate: new Date("2026-10-26T00:00:00.000Z") },
      },
    ]);
    m.entryDeleteMany.mockResolvedValue({ count: 1 });
    m.planUpsert.mockResolvedValue({ id: "plan-next" });
    m.pickCreate.mockResolvedValue({ id: "p9" });

    await unplaceEntriesAction(
      ["e1"],
      [{ entryId: "e1", createdByUserId: null, carriedFromWeek: null, weekStartDate: "2026-11-02" }],
    );

    expect(m.planUpsert.mock.calls[0][0].where.householdId_weekStartDate).toEqual({
      householdId: "household-1",
      weekStartDate: new Date("2026-11-02T00:00:00.000Z"),
    });
    expect(m.pickCreate.mock.calls[0][0].data.mealPlanId).toBe("plan-next");
  });

  it("drops a carry-over week that isn't before the plan's week", async () => {
    m.entryFindMany.mockResolvedValue([
      { id: "e1", mealPlanId: "plan-1", recipeId: "r1", freeformName: null, portions: 2, mealPlan: { weekStartDate: new Date("2026-11-02T00:00:00.000Z") } },
    ]);
    m.entryDeleteMany.mockResolvedValue({ count: 1 });
    m.pickCreate.mockResolvedValue({ id: "p9" });
    await unplaceEntriesAction(["e1"], [{ entryId: "e1", createdByUserId: null, carriedFromWeek: "2026-11-02" }]);
    expect(m.pickCreate.mock.calls[0][0].data).toMatchObject({ createdByUserId: null, carriedFromWeek: null });
  });

  it("leaves a meal cooked in the meantime on its day", async () => {
    m.entryFindMany.mockResolvedValue([
      { id: "e1", mealPlanId: "plan-1", recipeId: "r1", freeformName: null, portions: 2, mealPlan: { weekStartDate: new Date("2026-11-02T00:00:00.000Z") } },
    ]);
    m.entryDeleteMany.mockResolvedValue({ count: 0 });
    const result = await unplaceEntriesAction(["e1"]);
    expect(result.error).toMatch(/can't go back/);
    expect(m.pickCreate).not.toHaveBeenCalled();
  });
});
