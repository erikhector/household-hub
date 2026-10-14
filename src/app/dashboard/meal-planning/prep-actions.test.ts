// Tests src/app/dashboard/meal-planning/prep-actions.ts (GAP-49 meal prep:
// recording a prep session and undoing it) through its exported Server
// Actions. All I/O (Prisma, requireHousehold, next/cache, i18n) is mocked —
// no database call is made — following cooking-actions.test.ts. The stock
// deduction/credit helpers in cook-inventory.ts run for real against the
// mocked transaction client; only its recipe-expanding preview is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  recipeFindManyMock,
  inventoryItemFindManyMock,
  inventoryItemUpdateMock,
  householdMemberFindUniqueMock,
  preparedBatchCreateMock,
  preparedBatchDeleteManyMock,
  mealPlanEntryCountMock,
  transactionMock,
  revalidatePathMock,
  revalidateAutoAddedMock,
  addToDefaultListOnLowStockMock,
  previewCookedIngredientsForRecipeMock,
  recipeFindFirstMock,
  householdMemberFindFirstMock,
  preparedBatchFindFirstMock,
  preparedBatchFindUniqueMock,
  preparedBatchUpdateManyMock,
  mealPlanUpsertMock,
  mealPlanEntryFindFirstMock,
  mealPlanEntryFindManyMock,
  mealPlanEntryCreateMock,
  mealPlanEntryUpdateManyMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  recipeFindManyMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  inventoryItemUpdateMock: vi.fn(),
  householdMemberFindUniqueMock: vi.fn(),
  preparedBatchCreateMock: vi.fn(),
  preparedBatchDeleteManyMock: vi.fn(),
  mealPlanEntryCountMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  revalidateAutoAddedMock: vi.fn(),
  addToDefaultListOnLowStockMock: vi.fn(),
  previewCookedIngredientsForRecipeMock: vi.fn(),
  recipeFindFirstMock: vi.fn(),
  householdMemberFindFirstMock: vi.fn(),
  preparedBatchFindFirstMock: vi.fn(),
  preparedBatchFindUniqueMock: vi.fn(),
  preparedBatchUpdateManyMock: vi.fn(),
  mealPlanUpsertMock: vi.fn(),
  mealPlanEntryFindFirstMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(),
  mealPlanEntryCreateMock: vi.fn(),
  mealPlanEntryUpdateManyMock: vi.fn(),
}));

const txClient = {
  inventoryItem: { findMany: inventoryItemFindManyMock, update: inventoryItemUpdateMock },
  householdMember: { findUnique: householdMemberFindUniqueMock, findFirst: householdMemberFindFirstMock },
  preparedBatch: {
    create: preparedBatchCreateMock,
    deleteMany: preparedBatchDeleteManyMock,
    findFirst: preparedBatchFindFirstMock,
    findUnique: preparedBatchFindUniqueMock,
    updateMany: preparedBatchUpdateManyMock,
  },
  mealPlan: { upsert: mealPlanUpsertMock },
  mealPlanEntry: {
    count: mealPlanEntryCountMock,
    findFirst: mealPlanEntryFindFirstMock,
    findMany: mealPlanEntryFindManyMock,
    create: mealPlanEntryCreateMock,
    updateMany: mealPlanEntryUpdateManyMock,
  },
};
transactionMock.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findMany: recipeFindManyMock, findFirst: recipeFindFirstMock },
    inventoryItem: { findMany: inventoryItemFindManyMock },
    householdMember: { findUnique: householdMemberFindUniqueMock },
    preparedBatch: { findFirst: preparedBatchFindFirstMock },
    mealPlanEntry: { findFirst: mealPlanEntryFindFirstMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({})),
  getLocale: vi.fn(async () => "en"),
}));
vi.mock("@/lib/notifications", () => ({ recordOutOfStockTransition: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/shopping/default-list", () => ({
  addToDefaultListOnLowStock: addToDefaultListOnLowStockMock,
  revalidateAutoAdded: revalidateAutoAddedMock,
}));
vi.mock("@/app/dashboard/meal-planning/cook-inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/dashboard/meal-planning/cook-inventory")>()),
  previewCookedIngredientsForRecipe: previewCookedIngredientsForRecipeMock,
}));

const {
  recordPrepAction,
  undoRecordPrepAction,
  previewPrepIngredientsAction,
  assignBatchPortionsAction,
  unassignBatchPortionAction,
  discardBatchAction,
  undoDiscardBatchAction,
} = await import("@/app/dashboard/meal-planning/prep-actions");

const household = { id: "household-1" };
const userId = "user-1";

type Dish = { recipeId: string; portions: string; expiry?: string };

function prepForm(dishes: Dish[], items: { itemId: string; quantity: string }[] = []) {
  const fd = new FormData();
  for (const dish of dishes) {
    fd.append("dishRecipeId", dish.recipeId);
    fd.append("dishPortions", dish.portions);
    fd.append("dishExpiry", dish.expiry ?? "");
  }
  for (const item of items) {
    fd.append("itemId", item.itemId);
    fd.append("itemQuantity", item.quantity);
  }
  return fd;
}

function recipesFor(ids: string[]) {
  return ids.map((id) => ({ id, servings: 4 }));
}

let batchSeq = 0;
beforeEach(() => {
  requireHouseholdMock.mockResolvedValue({ household, userId });
  householdMemberFindUniqueMock.mockResolvedValue({ id: "member-1" });
  addToDefaultListOnLowStockMock.mockResolvedValue(null);
  batchSeq = 0;
  preparedBatchCreateMock.mockImplementation(async () => ({ id: `batch-${++batchSeq}` }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("recordPrepAction", () => {
  it("rejects a recipe from another household", async () => {
    recipeFindManyMock.mockResolvedValue(recipesFor(["recipe-a"]));

    const result = await recordPrepAction(
      {},
      prepForm([
        { recipeId: "recipe-a", portions: "4" },
        { recipeId: "recipe-other-household", portions: "4" },
      ]),
    );

    expect(result).toEqual({ error: "Recipe not found" });
    expect(recipeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["recipe-a", "recipe-other-household"] }, householdId: household.id },
      }),
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects 6 dishes", async () => {
    const dishes = Array.from({ length: 6 }, (_, i) => ({ recipeId: `recipe-${i}`, portions: "2" }));

    const result = await recordPrepAction({}, prepForm(dishes));

    expect(result).toEqual({ error: "You can prep up to 5 dishes at once" });
    expect(recipeFindManyMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects 0 portions", async () => {
    const result = await recordPrepAction({}, prepForm([{ recipeId: "recipe-a", portions: "0" }]));

    expect(result).toEqual({ error: "Enter 1 to 100 portions" });
    expect(recipeFindManyMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates one batch per dish with remaining = total", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T18:30:00.000Z"));
    recipeFindManyMock.mockResolvedValue(recipesFor(["recipe-a", "recipe-b"]));

    const result = await recordPrepAction(
      {},
      prepForm([
        { recipeId: "recipe-a", portions: "8" },
        { recipeId: "recipe-b", portions: "6", expiry: "2026-10-20" },
      ]),
    );

    expect(result.error).toBeUndefined();
    expect(householdMemberFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId_userId: { householdId: household.id, userId } },
      }),
    );
    expect(preparedBatchCreateMock).toHaveBeenCalledTimes(2);
    expect(preparedBatchCreateMock).toHaveBeenNthCalledWith(1, {
      data: {
        householdId: household.id,
        recipeId: "recipe-a",
        cookedByMemberId: "member-1",
        totalPortions: 8,
        remainingPortions: 8,
        cookedAt: new Date("2026-10-14T18:30:00.000Z"),
        // Blank expiry → the leftovers shelf life (3 days) from now.
        expiryDate: new Date("2026-10-17T18:30:00.000Z"),
      },
      select: { id: true },
    });
    expect(preparedBatchCreateMock).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        householdId: household.id,
        recipeId: "recipe-b",
        totalPortions: 6,
        remainingPortions: 6,
        expiryDate: new Date("2026-10-20T00:00:00.000Z"),
      }),
      select: { id: true },
    });
    expect(result).toMatchObject({ portions: 14, dishCount: 2 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/inventory");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
    expect(revalidateAutoAddedMock).toHaveBeenCalledWith([]);
  });

  it("deducts the reviewed ingredients", async () => {
    recipeFindManyMock.mockResolvedValue(recipesFor(["recipe-a"]));
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "item-rice", householdId: household.id, quantity: 1000 },
    ]);

    await recordPrepAction(
      {},
      prepForm([{ recipeId: "recipe-a", portions: "8" }], [{ itemId: "item-rice", quantity: "400" }]),
    );

    expect(inventoryItemFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["item-rice"] }, householdId: household.id },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-rice" },
      data: { quantity: 600, updatedByUserId: userId },
    });
  });

  it("returns an undo payload with batch ids and rows", async () => {
    recipeFindManyMock.mockResolvedValue(recipesFor(["recipe-a", "recipe-b"]));
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "item-rice", householdId: household.id, quantity: 1000 },
      { id: "item-chicken", householdId: household.id, quantity: 2 },
    ]);
    const autoAdded = { shoppingListItemId: "sli-1", listId: "list-1", listName: "Next shop", itemName: "Chicken" };
    addToDefaultListOnLowStockMock.mockImplementation(async (_tx, _h, itemId: string) =>
      itemId === "item-chicken" ? autoAdded : null,
    );

    const result = await recordPrepAction(
      {},
      prepForm(
        [
          { recipeId: "recipe-a", portions: "8" },
          { recipeId: "recipe-b", portions: "4" },
        ],
        [
          { itemId: "item-rice", quantity: "400" },
          { itemId: "item-chicken", quantity: "2" },
          // A row the household zeroed out deducts nothing, so it has
          // nothing to credit back either.
          { itemId: "item-salt", quantity: "0" },
        ],
      ),
    );

    expect(result.undo).toEqual({
      batchIds: ["batch-1", "batch-2"],
      rows: [
        { itemId: "item-rice", quantity: 400 },
        { itemId: "item-chicken", quantity: 2 },
      ],
      autoAdded: [autoAdded],
    });
    expect(revalidateAutoAddedMock).toHaveBeenCalledWith([autoAdded]);
  });
});

describe("undoRecordPrepAction", () => {
  const undo = {
    batchIds: ["batch-1", "batch-2"],
    rows: [{ itemId: "item-rice", quantity: 400 }],
    autoAdded: [],
  };

  it("refuses once a portion is planned", async () => {
    mealPlanEntryCountMock.mockResolvedValue(1);

    const result = await undoRecordPrepAction(undo);

    expect(result).toEqual({
      error: "Some of these portions are already planned. Unplan them first.",
    });
    expect(mealPlanEntryCountMock).toHaveBeenCalledWith({
      where: { preparedBatchId: { in: undo.batchIds }, mealPlan: { householdId: household.id } },
    });
    expect(preparedBatchDeleteManyMock).not.toHaveBeenCalled();
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
  });

  it("deletes the batches and credits ingredients back", async () => {
    mealPlanEntryCountMock.mockResolvedValue(0);
    preparedBatchDeleteManyMock.mockResolvedValue({ count: 2 });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "item-rice", householdId: household.id, quantity: 600 },
    ]);

    const result = await undoRecordPrepAction(undo);

    expect(result).toEqual({});
    expect(preparedBatchDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: undo.batchIds }, householdId: household.id },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-rice" },
      data: { quantity: 1000, updatedByUserId: userId },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/inventory");
  });

  it("doesn't credit twice when the batches are already gone", async () => {
    mealPlanEntryCountMock.mockResolvedValue(0);
    preparedBatchDeleteManyMock.mockResolvedValue({ count: 0 });

    expect(await undoRecordPrepAction(undo)).toEqual({});
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
  });

  it("ignores a malformed payload", async () => {
    for (const payload of [
      null,
      { batchIds: [], rows: [], autoAdded: [] },
      { batchIds: ["batch-1"], rows: [{ itemId: "item-rice", quantity: -5 }], autoAdded: [] },
      { batchIds: Array.from({ length: 6 }, (_, i) => `batch-${i}`), rows: [], autoAdded: [] },
    ]) {
      expect(await undoRecordPrepAction(payload as unknown as typeof undo)).toEqual({});
    }
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("previewPrepIngredientsAction", () => {
  it("merges the same inventory item across two dishes", async () => {
    recipeFindManyMock.mockResolvedValue([
      { id: "recipe-a", servings: 4 },
      { id: "recipe-b", servings: 2 },
    ]);
    const row = (over: Partial<Record<string, unknown>>) => ({
      key: "item-rice",
      inventoryItemId: "item-rice",
      name: "Rice",
      unit: "g",
      onHandQuantity: 1000,
      suggestedQuantity: 0,
      requiredQuantity: 0,
      requiredUnit: "g",
      unitMismatch: false,
      ...over,
    });
    previewCookedIngredientsForRecipeMock.mockImplementation(async (_h, recipeId: string) =>
      recipeId === "recipe-a"
        ? [row({ suggestedQuantity: 300, requiredQuantity: 300 }), row({ key: "item-oil", inventoryItemId: "item-oil", name: "Oil", unit: "ml", requiredUnit: "ml", suggestedQuantity: 20, requiredQuantity: 20 })]
        : [row({ suggestedQuantity: 0, requiredQuantity: 1, requiredUnit: "cup", unitMismatch: true })],
    );

    const result = await previewPrepIngredientsAction([
      { recipeId: "recipe-a", portions: 8 },
      { recipeId: "recipe-b", portions: 2 },
    ]);

    expect(previewCookedIngredientsForRecipeMock).toHaveBeenCalledWith(household.id, "recipe-a", 8, 4);
    expect(previewCookedIngredientsForRecipeMock).toHaveBeenCalledWith(household.id, "recipe-b", 2, 2);
    expect(result).toEqual({
      items: [
        row({ key: "item-oil", inventoryItemId: "item-oil", name: "Oil", unit: "ml", requiredUnit: "ml", suggestedQuantity: 20, requiredQuantity: 20 }),
        row({ suggestedQuantity: 300, requiredQuantity: 301, unitMismatch: true }),
      ],
    });
  });

  it("rejects a recipe not in the household", async () => {
    recipeFindManyMock.mockResolvedValue([]);

    expect(await previewPrepIngredientsAction([{ recipeId: "recipe-x", portions: 4 }])).toEqual({
      error: "Recipe not found",
    });
    expect(previewCookedIngredientsForRecipeMock).not.toHaveBeenCalled();
  });
});

describe("assignBatchPortionsAction", () => {
  const batch = { id: "batch-1", recipeId: "recipe-a" };
  // 2026-10-14 is a Wednesday; its week starts Monday 2026-10-12.
  const wed = new Date("2026-10-14T00:00:00.000Z");
  const thu = new Date("2026-10-15T00:00:00.000Z");
  const monday = new Date("2026-10-12T00:00:00.000Z");

  beforeEach(() => {
    preparedBatchFindFirstMock.mockResolvedValue(batch);
    preparedBatchUpdateManyMock.mockResolvedValue({ count: 1 });
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });
    mealPlanEntryFindManyMock.mockResolvedValue([]);
    mealPlanEntryUpdateManyMock.mockResolvedValue({ count: 1 });
    let entrySeq = 0;
    mealPlanEntryCreateMock.mockImplementation(async () => ({ id: `entry-${++entrySeq}` }));
  });

  it("rejects a batch from another household", async () => {
    preparedBatchFindFirstMock.mockResolvedValue(null);

    const result = await assignBatchPortionsAction({
      batchId: "batch-other",
      slots: [{ date: "2026-10-14", mealType: "DINNER", portions: 2 }],
    });

    expect(result).toEqual({ error: "Batch not found" });
    expect(preparedBatchFindFirstMock).toHaveBeenCalledWith({
      where: { id: "batch-other", householdId: household.id },
      select: { id: true, recipeId: true },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("fails with not-enough-portions when the conditional decrement matches 0 rows", async () => {
    preparedBatchUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await assignBatchPortionsAction({
      batchId: batch.id,
      slots: [
        { date: "2026-10-14", mealType: "DINNER", portions: 2 },
        { date: "2026-10-15", mealType: "LUNCH", portions: 3 },
      ],
    });

    expect(result).toEqual({ error: "Not enough portions left in this batch" });
    // One decrement for the whole assignment, guarded so it can't go negative.
    expect(preparedBatchUpdateManyMock).toHaveBeenCalledWith({
      where: { id: batch.id, householdId: household.id, remainingPortions: { gte: 5 } },
      data: { remainingPortions: { decrement: 5 } },
    });
    expect(mealPlanEntryCreateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("creates entries in empty slots, linked, with portions", async () => {
    const result = await assignBatchPortionsAction({
      batchId: batch.id,
      slots: [
        { date: "2026-10-14", mealType: "DINNER", portions: 2 },
        { date: "2026-10-15", mealType: "LUNCH", portions: 3 },
      ],
    });

    expect(result).toEqual({});
    expect(mealPlanUpsertMock).toHaveBeenCalledWith({
      where: { householdId_weekStartDate: { householdId: household.id, weekStartDate: monday } },
      update: {},
      create: { householdId: household.id, weekStartDate: monday },
      select: { id: true },
    });
    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mealPlanId: "plan-1", date: wed, mealType: "DINNER" } }),
    );
    expect(mealPlanEntryCreateMock).toHaveBeenCalledWith({
      data: {
        mealPlanId: "plan-1",
        date: wed,
        mealType: "DINNER",
        recipeId: batch.recipeId,
        portions: 2,
        preparedBatchId: batch.id,
        preparedPortionsUsed: 2,
      },
      select: { id: true },
    });
    expect(mealPlanEntryCreateMock).toHaveBeenCalledWith({
      data: {
        mealPlanId: "plan-1",
        date: thu,
        mealType: "LUNCH",
        recipeId: batch.recipeId,
        portions: 3,
        preparedBatchId: batch.id,
        preparedPortionsUsed: 3,
      },
      select: { id: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("links an existing unlinked entry of the same recipe", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([
      { id: "entry-planned", recipeId: batch.recipeId, preparedBatchId: null, consumedAt: null },
    ]);

    const result = await assignBatchPortionsAction({
      batchId: batch.id,
      slots: [{ date: "2026-10-14", mealType: "DINNER", portions: 2 }],
    });

    expect(result).toEqual({});
    expect(mealPlanEntryCreateMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "entry-planned", preparedBatchId: null, consumedAt: null },
      data: { portions: 2, preparedBatchId: batch.id, preparedPortionsUsed: 2 },
    });
  });

  it("rolls back when one slot is taken by another dish", async () => {
    mealPlanEntryFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "entry-pizza", recipeId: "recipe-pizza", preparedBatchId: null, consumedAt: null },
      ]);

    const result = await assignBatchPortionsAction({
      batchId: batch.id,
      slots: [
        { date: "2026-10-14", mealType: "DINNER", portions: 2 },
        { date: "2026-10-15", mealType: "DINNER", portions: 2 },
      ],
    });

    expect(result).toEqual({ error: "That meal slot already has something planned" });
    // The transaction callback rejected, so the decrement and the first
    // slot's create are rolled back with it.
    await expect(transactionMock.mock.results[0].value).rejects.toThrow();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("treats a slot with a linked or cooked entry of the same recipe as taken", async () => {
    for (const taken of [
      { id: "e1", recipeId: batch.recipeId, preparedBatchId: "batch-2", consumedAt: null },
      { id: "e2", recipeId: batch.recipeId, preparedBatchId: null, consumedAt: new Date() },
    ]) {
      mealPlanEntryFindManyMock.mockResolvedValueOnce([taken]);
      const result = await assignBatchPortionsAction({
        batchId: batch.id,
        slots: [{ date: "2026-10-14", mealType: "DINNER", portions: 1 }],
      });
      expect(result).toEqual({ error: "That meal slot already has something planned" });
    }
    expect(mealPlanEntryUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload before touching the database", async () => {
    const result = await assignBatchPortionsAction({
      batchId: batch.id,
      slots: [{ date: "2026-10-14", mealType: "DINNER", portions: 0 }],
    });

    expect(result).toEqual({ error: "Enter 1 to 100 portions" });
    expect(preparedBatchFindFirstMock).not.toHaveBeenCalled();
  });
});

describe("unassignBatchPortionAction", () => {
  it("returns the portions and clears the link", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({
      id: "entry-1",
      preparedBatchId: "batch-1",
      preparedPortionsUsed: 3,
      consumedAt: null,
    });
    mealPlanEntryUpdateManyMock.mockResolvedValue({ count: 1 });
    preparedBatchFindFirstMock.mockResolvedValue({ remainingPortions: 4, totalPortions: 8 });
    preparedBatchUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await unassignBatchPortionAction("entry-1");

    expect(result).toEqual({});
    expect(mealPlanEntryFindFirstMock).toHaveBeenCalledWith({
      where: { id: "entry-1", mealPlan: { householdId: household.id } },
      select: { id: true, preparedBatchId: true, preparedPortionsUsed: true, consumedAt: true },
    });
    expect(mealPlanEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "entry-1", preparedBatchId: "batch-1", preparedPortionsUsed: 3, consumedAt: null },
      data: { preparedBatchId: null, preparedPortionsUsed: 0 },
    });
    expect(preparedBatchFindFirstMock).toHaveBeenCalledWith({
      where: { id: "batch-1", householdId: household.id },
      select: { remainingPortions: true, totalPortions: true },
    });
    expect(preparedBatchUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "batch-1", householdId: household.id },
      data: { remainingPortions: 7 },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("caps the returned portions at the batch total", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({
      id: "entry-1",
      preparedBatchId: "batch-1",
      preparedPortionsUsed: 5,
      consumedAt: null,
    });
    mealPlanEntryUpdateManyMock.mockResolvedValue({ count: 1 });
    preparedBatchFindFirstMock.mockResolvedValue({ remainingPortions: 6, totalPortions: 8 });

    await unassignBatchPortionAction("entry-1");

    expect(preparedBatchUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "batch-1", householdId: household.id },
      data: { remainingPortions: 8 },
    });
  });

  it("only resets the entry when its batch is already gone", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({
      id: "entry-1",
      preparedBatchId: null,
      preparedPortionsUsed: 2,
      consumedAt: null,
    });
    mealPlanEntryUpdateManyMock.mockResolvedValue({ count: 1 });

    expect(await unassignBatchPortionAction("entry-1")).toEqual({});
    expect(mealPlanEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "entry-1", preparedBatchId: null, preparedPortionsUsed: 2, consumedAt: null },
      data: { preparedBatchId: null, preparedPortionsUsed: 0 },
    });
    expect(preparedBatchFindFirstMock).not.toHaveBeenCalled();
    expect(preparedBatchUpdateManyMock).not.toHaveBeenCalled();
  });

  it("doesn't return portions twice when the entry was already unassigned", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({
      id: "entry-1",
      preparedBatchId: "batch-1",
      preparedPortionsUsed: 3,
      consumedAt: null,
    });
    // A concurrent unassign cleared the link between the read and the write.
    mealPlanEntryUpdateManyMock.mockResolvedValue({ count: 0 });

    expect(await unassignBatchPortionAction("entry-1")).toEqual({});
    expect(preparedBatchUpdateManyMock).not.toHaveBeenCalled();
  });

  it("is a no-op on an entry from another household", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(null);

    expect(await unassignBatchPortionAction("entry-other")).toEqual({});
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("is a no-op on an unlinked or cooked entry", async () => {
    for (const entry of [
      { id: "entry-1", preparedBatchId: null, preparedPortionsUsed: 0, consumedAt: null },
      { id: "entry-2", preparedBatchId: "batch-1", preparedPortionsUsed: 2, consumedAt: new Date() },
    ]) {
      mealPlanEntryFindFirstMock.mockResolvedValueOnce(entry);
      expect(await unassignBatchPortionAction(entry.id)).toEqual({});
    }
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("discardBatchAction", () => {
  const stored = {
    id: "batch-1",
    recipeId: "recipe-a",
    cookedByMemberId: "member-1",
    totalPortions: 8,
    remainingPortions: 3,
    cookedAt: new Date("2026-10-11T18:00:00.000Z"),
    expiryDate: new Date("2026-10-14T18:00:00.000Z"),
  };

  beforeEach(() => {
    preparedBatchFindFirstMock.mockResolvedValue(stored);
    mealPlanEntryFindManyMock.mockResolvedValue([
      { id: "entry-1", preparedPortionsUsed: 2 },
      { id: "entry-2", preparedPortionsUsed: 3 },
    ]);
    mealPlanEntryUpdateManyMock.mockResolvedValue({ count: 2 });
    preparedBatchDeleteManyMock.mockResolvedValue({ count: 1 });
  });

  it("unlinks entries and deletes the batch", async () => {
    await discardBatchAction("batch-1");

    expect(preparedBatchFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "batch-1", householdId: household.id } }),
    );
    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith({
      where: { preparedBatchId: "batch-1", mealPlan: { householdId: household.id } },
      select: { id: true, preparedPortionsUsed: true },
    });
    expect(mealPlanEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { preparedBatchId: "batch-1", mealPlan: { householdId: household.id } },
      data: { preparedBatchId: null, preparedPortionsUsed: 0 },
    });
    expect(preparedBatchDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "batch-1", householdId: household.id },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("returns a snapshot", async () => {
    const result = await discardBatchAction("batch-1");

    expect(result).toEqual({
      snapshot: {
        batch: {
          id: "batch-1",
          recipeId: "recipe-a",
          cookedByMemberId: "member-1",
          totalPortions: 8,
          remainingPortions: 3,
          cookedAt: "2026-10-11T18:00:00.000Z",
          expiryDate: "2026-10-14T18:00:00.000Z",
        },
        entries: [
          { id: "entry-1", portions: 2 },
          { id: "entry-2", portions: 3 },
        ],
      },
    });
  });

  it("rejects a batch from another household", async () => {
    preparedBatchFindFirstMock.mockResolvedValue(null);

    expect(await discardBatchAction("batch-other")).toEqual({ error: "Batch not found" });
    expect(preparedBatchDeleteManyMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("undoDiscardBatchAction", () => {
  const snapshot = {
    batch: {
      id: "batch-1",
      recipeId: "recipe-a",
      cookedByMemberId: "member-1",
      totalPortions: 8,
      remainingPortions: 3,
      cookedAt: "2026-10-11T18:00:00.000Z",
      expiryDate: "2026-10-14T18:00:00.000Z",
    },
    entries: [
      { id: "entry-1", portions: 2 },
      { id: "entry-2", portions: 3 },
    ],
  };

  beforeEach(() => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-a" });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    preparedBatchFindUniqueMock.mockResolvedValue(null);
    preparedBatchCreateMock.mockResolvedValue({ id: "batch-1" });
    mealPlanEntryUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("restores the batch and re-links entries", async () => {
    const result = await undoDiscardBatchAction(snapshot);

    expect(result).toEqual({});
    expect(recipeFindFirstMock).toHaveBeenCalledWith({
      where: { id: "recipe-a", householdId: household.id },
      select: { id: true },
    });
    expect(preparedBatchCreateMock).toHaveBeenCalledWith({
      data: {
        id: "batch-1",
        householdId: household.id,
        recipeId: "recipe-a",
        cookedByMemberId: "member-1",
        totalPortions: 8,
        remainingPortions: 3,
        cookedAt: new Date("2026-10-11T18:00:00.000Z"),
        expiryDate: new Date("2026-10-14T18:00:00.000Z"),
      },
    });
    expect(mealPlanEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "entry-1", mealPlan: { householdId: household.id }, preparedBatchId: null },
      data: { preparedBatchId: "batch-1", preparedPortionsUsed: 2 },
    });
    expect(mealPlanEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "entry-2", mealPlan: { householdId: household.id }, preparedBatchId: null },
      data: { preparedBatchId: "batch-1", preparedPortionsUsed: 3 },
    });
    expect(preparedBatchUpdateManyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("gives back the portions of an entry it couldn't re-link", async () => {
    // entry-2 was deleted (or planned from elsewhere) since the discard.
    mealPlanEntryUpdateManyMock.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await undoDiscardBatchAction(snapshot);

    expect(preparedBatchUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "batch-1", householdId: household.id },
      data: { remainingPortions: 6 },
    });
  });

  it("drops a cook who is no longer a household member", async () => {
    householdMemberFindFirstMock.mockResolvedValue(null);

    await undoDiscardBatchAction(snapshot);

    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { id: "member-1", householdId: household.id },
      select: { id: true },
    });
    expect(preparedBatchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ cookedByMemberId: null }),
    });
  });

  it("skips when the recipe is gone", async () => {
    recipeFindFirstMock.mockResolvedValue(null);

    expect(await undoDiscardBatchAction(snapshot)).toEqual({});
    expect(preparedBatchCreateMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateManyMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the batch already exists (a repeated Undo)", async () => {
    preparedBatchFindUniqueMock.mockResolvedValue({ id: "batch-1" });

    expect(await undoDiscardBatchAction(snapshot)).toEqual({});
    expect(preparedBatchCreateMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateManyMock).not.toHaveBeenCalled();
  });

  it("ignores a malformed snapshot", async () => {
    for (const payload of [
      null,
      { ...snapshot, batch: { ...snapshot.batch, remainingPortions: 9 } },
      { ...snapshot, entries: [{ id: "entry-1", portions: 0 }] },
    ]) {
      expect(await undoDiscardBatchAction(payload as unknown as typeof snapshot)).toEqual({});
    }
    expect(recipeFindFirstMock).not.toHaveBeenCalled();
    expect(preparedBatchCreateMock).not.toHaveBeenCalled();
  });
});
