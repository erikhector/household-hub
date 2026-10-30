// GAP-56: the planner's bulk edit. Prisma, the session and next/cache are
// mocked, as in planner-actions.test.ts; no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  findManyMock,
  updateManyMock,
  deleteManyMock,
  planUpsertMock,
  notificationUpdateManyMock,
  batchFindFirstMock,
  batchUpdateManyMock,
  transactionMock,
  revalidatePathMock,
  countMock,
  recipeUpdateManyMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
  planUpsertMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  batchFindFirstMock: vi.fn(),
  batchUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  countMock: vi.fn(),
  recipeUpdateManyMock: vi.fn(),
}));

const prismaMock = {
  mealPlanEntry: {
    findMany: findManyMock,
    updateMany: updateManyMock,
    deleteMany: deleteManyMock,
    count: countMock,
  },
  recipe: { updateMany: recipeUpdateManyMock },
  mealPlan: { upsert: planUpsertMock },
  notification: { updateMany: notificationUpdateManyMock },
  preparedBatch: { findFirst: batchFindFirstMock, updateMany: batchUpdateManyMock },
  $transaction: transactionMock,
};
transactionMock.mockImplementation((arg: unknown) =>
  typeof arg === "function" ? arg(prismaMock) : Promise.all(arg as unknown[]),
);

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { bulkEditMealEntriesAction, undoBulkMealEditAction, undoBulkMarkEatenAction } = await import(
  "@/app/dashboard/meal-planning/bulk-meal-actions"
);

const household = { id: "household-1" };
updateManyMock.mockResolvedValue({ count: 1 });

afterEach(() => {
  vi.clearAllMocks();
  updateManyMock.mockResolvedValue({ count: 1 });
  requireHouseholdMock.mockResolvedValue({ household });
});
requireHouseholdMock.mockResolvedValue({ household });

function row(id: string, date: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    date: new Date(`${date}T00:00:00.000Z`),
    mealType: "DINNER",
    portions: 4,
    recipeId: "recipe-1",
    consumedAt: null,
    preparedBatchId: null,
    preparedPortionsUsed: 0,
    ...extra,
  };
}

describe("bulkEditMealEntriesAction: move", () => {
  it("shifts the group by one day offset, upserts each target week and writes in one transaction", async () => {
    // Sun 4 Jan 2026 is in the week of 29 Dec; Mon 5 Jan starts the next.
    findManyMock.mockResolvedValue([row("a", "2026-01-04"), row("b", "2026-01-05")]);
    planUpsertMock.mockImplementation(({ where }: { where: { householdId_weekStartDate: { weekStartDate: Date } } }) =>
      Promise.resolve({ id: `plan-${where.householdId_weekStartDate.weekStartDate.toISOString().slice(0, 10)}` }),
    );

    const result = await bulkEditMealEntriesAction({
      op: "move",
      entryIds: ["a", "b"],
      date: "2026-01-11",
      mealType: null,
    });

    expect(result.error).toBeUndefined();
    expect(result.changed).toBe(2);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "a", consumedAt: null },
      data: { mealPlanId: "plan-2026-01-05", date: new Date("2026-01-11T00:00:00.000Z"), mealType: "DINNER" },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "b", consumedAt: null },
      data: { mealPlanId: "plan-2026-01-12", date: new Date("2026-01-12T00:00:00.000Z"), mealType: "DINNER" },
    });
    expect(planUpsertMock).toHaveBeenCalledTimes(2);
    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("scopes the lookup to the session's household and never reads a household from the input", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05")]);
    planUpsertMock.mockResolvedValue({ id: "plan" });
    await bulkEditMealEntriesAction({ op: "move", entryIds: ["a"], date: "2026-01-06", mealType: "LUNCH" });
    expect(findManyMock.mock.calls[0][0].where).toEqual({
      id: { in: ["a"] },
      mealPlan: { householdId: "household-1" },
    });
  });

  it("skips cooked entries but still moves the rest, and reports the skip", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05"), row("b", "2026-01-06", { consumedAt: new Date() })]);
    planUpsertMock.mockResolvedValue({ id: "plan" });

    const result = await bulkEditMealEntriesAction({ op: "move", entryIds: ["a", "b"], date: "2026-01-07", mealType: null });

    expect(result.changed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock.mock.calls[0][0].where).toEqual({ id: "a", consumedAt: null });
  });

  it("fails the whole batch when a meal is cooked after the read", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05"), row("b", "2026-01-06")]);
    planUpsertMock.mockResolvedValue({ id: "plan" });
    updateManyMock.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const result = await bulkEditMealEntriesAction({ op: "move", entryIds: ["a", "b"], date: "2026-01-07", mealType: null });

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("errors when every selected meal is cooked", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05", { consumedAt: new Date() })]);
    const result = await bulkEditMealEntriesAction({ op: "move", entryIds: ["a"], date: "2026-01-07", mealType: null });
    expect(result.error).toBe("None of the selected meals can be changed");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects the whole batch when one id isn't the household's, writing nothing", async () => {
    // Only "a" is found under this household; "foreign" belongs elsewhere.
    findManyMock.mockResolvedValue([row("a", "2026-01-05")]);

    const result = await bulkEditMealEntriesAction({
      op: "move",
      entryIds: ["a", "foreign"],
      date: "2026-01-07",
      mealType: null,
    });

    expect(result.error).toBe("Meal not found");
    expect(transactionMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(planUpsertMock).not.toHaveBeenCalled();
  });

  it("returns the previous positions so Undo can put them back", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05", { mealType: "LUNCH" })]);
    planUpsertMock.mockResolvedValue({ id: "plan" });
    const result = await bulkEditMealEntriesAction({ op: "move", entryIds: ["a"], date: "2026-01-07", mealType: "DINNER" });
    expect(result.restore).toEqual([{ id: "a", date: "2026-01-05", mealType: "LUNCH" }]);
  });

  it("validates the date and the id list", async () => {
    expect((await bulkEditMealEntriesAction({ op: "move", entryIds: ["a"], date: "2026-02-31", mealType: null })).error).toBe(
      "Invalid date",
    );
    expect((await bulkEditMealEntriesAction({ op: "move", entryIds: [], date: "2026-02-01", mealType: null })).error).toBeTruthy();
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("bulkEditMealEntriesAction: portions", () => {
  it("sets portions on recipe meals only and leaves freeform, batch and cooked ones", async () => {
    findManyMock.mockResolvedValue([
      row("a", "2026-01-05"),
      row("free", "2026-01-05", { recipeId: null }),
      row("batch", "2026-01-05", { preparedBatchId: "b1" }),
      row("done", "2026-01-05", { consumedAt: new Date() }),
    ]);

    const result = await bulkEditMealEntriesAction({
      op: "portions",
      entryIds: ["a", "free", "batch", "done"],
      portions: 2,
    });

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["a"] }, consumedAt: null, preparedBatchId: null },
      data: { portions: 2 },
    });
    expect(result.changed).toBe(1);
    expect(result.skipped).toBe(3);
    expect(result.restore).toEqual([{ id: "a", portions: 4 }]);
  });

  it("rejects a foreign id for the whole batch", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05")]);
    const result = await bulkEditMealEntriesAction({ op: "portions", entryIds: ["a", "foreign"], portions: 2 });
    expect(result.error).toBe("Meal not found");
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects zero portions", async () => {
    const result = await bulkEditMealEntriesAction({ op: "portions", entryIds: ["a"], portions: 0 });
    expect(result.error).toBe("Portions must be at least 1");
  });

  it("errors when nothing can be re-portioned", async () => {
    findManyMock.mockResolvedValue([row("free", "2026-01-05", { recipeId: null })]);
    const result = await bulkEditMealEntriesAction({ op: "portions", entryIds: ["free"], portions: 2 });
    expect(result.error).toBe("None of the selected meals can be changed");
  });
});

describe("bulkEditMealEntriesAction: remove", () => {
  it("deletes uncooked meals in one transaction and skips cooked ones", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05"), row("done", "2026-01-05", { consumedAt: new Date() })]);
    deleteManyMock.mockResolvedValue({ count: 1 });

    const result = await bulkEditMealEntriesAction({ op: "remove", entryIds: ["a", "done"] });

    expect(result.changed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
    expect(deleteManyMock.mock.calls[0][0].where.id).toBe("a");
  });

  it("gives a batch meal's portions back", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05", { preparedBatchId: "b1", preparedPortionsUsed: 2 })]);
    deleteManyMock.mockResolvedValue({ count: 1 });
    batchFindFirstMock.mockResolvedValue({ remainingPortions: 1, totalPortions: 6 });
    batchUpdateManyMock.mockResolvedValue({ count: 1 });

    await bulkEditMealEntriesAction({ op: "remove", entryIds: ["a"] });

    expect(batchFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b1", householdId: "household-1" } }),
    );
    expect(batchUpdateManyMock).toHaveBeenCalled();
  });

  it("fails the whole batch when a meal changed under us", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05"), row("b", "2026-01-06")]);
    deleteManyMock.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const result = await bulkEditMealEntriesAction({ op: "remove", entryIds: ["a", "b"] });

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign id before deleting anything", async () => {
    findManyMock.mockResolvedValue([row("a", "2026-01-05")]);
    const result = await bulkEditMealEntriesAction({ op: "remove", entryIds: ["a", "foreign"] });
    expect(result.error).toBe("Meal not found");
    expect(deleteManyMock).not.toHaveBeenCalled();
  });
});

describe("undoBulkMealEditAction", () => {
  it("puts a moved meal back on its old day, slot and week", async () => {
    findManyMock.mockResolvedValue([{ id: "a", consumedAt: null }]);
    planUpsertMock.mockResolvedValue({ id: "plan-old" });

    const result = await undoBulkMealEditAction([{ id: "a", date: "2026-01-05", mealType: "LUNCH" }]);

    expect(result).toEqual({});
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "a", consumedAt: null },
      data: { date: new Date("2026-01-05T00:00:00.000Z"), mealPlanId: "plan-old", mealType: "LUNCH" },
    });
  });

  it("restores portions", async () => {
    findManyMock.mockResolvedValue([{ id: "a", consumedAt: null }]);
    await undoBulkMealEditAction([{ id: "a", portions: 4 }]);
    expect(updateManyMock).toHaveBeenCalledWith({ where: { id: "a", consumedAt: null }, data: { portions: 4 } });
  });

  it("fails the batch when a meal is cooked after the read", async () => {
    findManyMock.mockResolvedValue([{ id: "a", consumedAt: null }]);
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    const result = await undoBulkMealEditAction([{ id: "a", portions: 4 }]);
    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("leaves a meal cooked since the edit alone", async () => {
    findManyMock.mockResolvedValue([
      { id: "a", consumedAt: null },
      { id: "b", consumedAt: new Date() },
    ]);
    await undoBulkMealEditAction([
      { id: "a", portions: 4 },
      { id: "b", portions: 4 },
    ]);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock.mock.calls[0][0].where).toEqual({ id: "a", consumedAt: null });
  });

  it("rejects a foreign id for the whole batch", async () => {
    findManyMock.mockResolvedValue([{ id: "a", consumedAt: null }]);
    const result = await undoBulkMealEditAction([
      { id: "a", portions: 4 },
      { id: "foreign", portions: 4 },
    ]);
    expect(result.error).toBe("Meal not found");
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("bulkEditMealEntriesAction: eaten", () => {
  it("marks batch meals eaten in one guarded write and skips fresh, custom and cooked ones", async () => {
    findManyMock.mockResolvedValue([
      row("p1", "2026-01-05", { preparedBatchId: "b1", preparedPortionsUsed: 1, portions: 1 }),
      row("p2", "2026-01-06", { preparedBatchId: "b1", preparedPortionsUsed: 1, portions: 1 }),
      row("fresh", "2026-01-06"),
      row("custom", "2026-01-06", { recipeId: null }),
      row("done", "2026-01-07", { preparedBatchId: "b1", consumedAt: new Date() }),
    ]);
    updateManyMock.mockResolvedValue({ count: 2 });

    const result = await bulkEditMealEntriesAction({
      op: "eaten",
      entryIds: ["p1", "p2", "fresh", "custom", "done"],
    });

    expect(result).toEqual({ changed: 2, skipped: 3, eatenIds: ["p1", "p2"] });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] }, consumedAt: null, preparedBatchId: { not: null } },
      data: { consumedAt: expect.any(Date) },
    });
    // No inventory is touched: the batch was cooked at prep time.
    expect(batchUpdateManyMock).not.toHaveBeenCalled();
    // Off the Cook soon shelf once, for the one recipe.
    expect(recipeUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(recipeUpdateManyMock.mock.calls[0][0].where).toMatchObject({ id: "recipe-1", householdId: "household-1" });
  });

  it("fails the whole batch when a meal was eaten or unlinked after the read", async () => {
    findManyMock.mockResolvedValue([
      row("p1", "2026-01-05", { preparedBatchId: "b1", preparedPortionsUsed: 1 }),
      row("p2", "2026-01-06", { preparedBatchId: "b1", preparedPortionsUsed: 1 }),
    ]);
    updateManyMock.mockResolvedValue({ count: 1 });

    const result = await bulkEditMealEntriesAction({ op: "eaten", entryIds: ["p1", "p2"] });

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("errors when no selected meal eats from a batch", async () => {
    findManyMock.mockResolvedValue([row("fresh", "2026-01-05")]);
    const result = await bulkEditMealEntriesAction({ op: "eaten", entryIds: ["fresh"] });
    expect(result.error).toBe("None of the selected meals can be changed");
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign id before marking anything", async () => {
    findManyMock.mockResolvedValue([row("p1", "2026-01-05", { preparedBatchId: "b1" })]);
    const result = await bulkEditMealEntriesAction({ op: "eaten", entryIds: ["p1", "foreign"] });
    expect(result.error).toBe("Meal not found");
    expect(findManyMock.mock.calls[0][0].where.mealPlan).toEqual({ householdId: "household-1" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});

describe("undoBulkMarkEatenAction", () => {
  it("clears consumedAt on the household's batch meals only", async () => {
    countMock.mockResolvedValue(2);

    const result = await undoBulkMarkEatenAction(["p1", "p2"]);

    expect(result).toEqual({});
    expect(countMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] }, mealPlan: { householdId: "household-1" } },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] }, preparedBatchId: { not: null }, consumedAt: { not: null } },
      data: { consumedAt: null },
    });
  });

  it("rejects a foreign id for the whole batch", async () => {
    countMock.mockResolvedValue(1);
    const result = await undoBulkMarkEatenAction(["p1", "foreign"]);
    expect(result.error).toBe("Meal not found");
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects an empty list", async () => {
    const result = await undoBulkMarkEatenAction([]);
    expect(result.error).toBeDefined();
    expect(countMock).not.toHaveBeenCalled();
  });
});
