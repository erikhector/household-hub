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
}));

const txClient = {
  inventoryItem: { findMany: inventoryItemFindManyMock, update: inventoryItemUpdateMock },
  householdMember: { findUnique: householdMemberFindUniqueMock },
  preparedBatch: { create: preparedBatchCreateMock, deleteMany: preparedBatchDeleteManyMock },
  mealPlanEntry: { count: mealPlanEntryCountMock },
};
transactionMock.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findMany: recipeFindManyMock },
    inventoryItem: { findMany: inventoryItemFindManyMock },
    householdMember: { findUnique: householdMemberFindUniqueMock },
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

const { recordPrepAction, undoRecordPrepAction, previewPrepIngredientsAction } = await import(
  "@/app/dashboard/meal-planning/prep-actions"
);

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
