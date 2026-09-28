// Tests the module-private helpers plus every IDOR guard in
// src/app/dashboard/meal-planning/cooking-actions.ts, indirectly through the
// exported Server Actions. All I/O (Prisma, requireHousehold, next/cache,
// i18n) is mocked — no database call is made. See REQUIREMENTS.md's
// "Testing" section and the identical convention in
// src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  inventoryItemFindManyMock,
  itemAliasFindManyMock,
  inventoryItemCreateManyAndReturnMock,
  inventoryItemUpdateMock,
  inventoryItemFindFirstMock,
  inventoryItemCreateMock,
  inventoryItemUpdateManyMock,
  inventoryItemDeleteManyMock,
  recipeFindManyMock,
  mealPlanEntryFindManyMock,
  mealPlanEntryFindFirstMock,
  mealPlanEntryUpdateMock,
  shoppingListCreateMock,
  shoppingListFindFirstMock,
  shoppingListItemFindManyMock,
  shoppingListItemCreateManyMock,
  transactionMock,
  revalidatePathMock,
  addToDefaultListOnLowStockMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  itemAliasFindManyMock: vi.fn(async () => [] as { normalizedName: string; inventoryItemId: string | null }[]),
  inventoryItemCreateManyAndReturnMock: vi.fn(),
  inventoryItemUpdateMock: vi.fn(),
  inventoryItemFindFirstMock: vi.fn(),
  inventoryItemCreateMock: vi.fn(),
  inventoryItemUpdateManyMock: vi.fn(),
  inventoryItemDeleteManyMock: vi.fn(),
  recipeFindManyMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(),
  mealPlanEntryFindFirstMock: vi.fn(),
  mealPlanEntryUpdateMock: vi.fn(),
  shoppingListCreateMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  shoppingListItemFindManyMock: vi.fn(),
  shoppingListItemCreateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  addToDefaultListOnLowStockMock: vi.fn(),
}));

const txClient = {
  inventoryItem: {
    findMany: inventoryItemFindManyMock,
    update: inventoryItemUpdateMock,
    findFirst: inventoryItemFindFirstMock,
    create: inventoryItemCreateMock,
    updateMany: inventoryItemUpdateManyMock,
    deleteMany: inventoryItemDeleteManyMock,
  },
  mealPlanEntry: { update: mealPlanEntryUpdateMock },
};
transactionMock.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: {
      findMany: inventoryItemFindManyMock,
      createManyAndReturn: inventoryItemCreateManyAndReturnMock,
    },
    itemAlias: { findMany: itemAliasFindManyMock },
    recipe: { findMany: recipeFindManyMock },
    mealPlanEntry: { findFirst: mealPlanEntryFindFirstMock, findMany: mealPlanEntryFindManyMock },
    shoppingList: { create: shoppingListCreateMock, findFirst: shoppingListFindFirstMock },
    shoppingListItem: { findMany: shoppingListItemFindManyMock, createMany: shoppingListItemCreateManyMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return {
    getDictionary: vi.fn(async () => ({
      shoppingList: { defaultNamePrefix: "Shopping list" },
      // Leftovers name prefix/category/unit and the invalid-servings error
      // (GAP-8) come from the real English strings.
      mealPlanning: en.mealPlanning,
      // Backs createCategoryResolver's dictionary tier (AUTO-2b).
      inventory: { uncategorized: "Uncategorized", autoCategories: en.inventory.autoCategories },
    })),
  };
});
vi.mock("@/lib/notifications", () => ({
  recordOutOfStockTransition: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/shopping/default-list", () => ({
  addToDefaultListOnLowStock: addToDefaultListOnLowStockMock,
  revalidateAutoAdded: vi.fn(),
}));

const {
  previewMissingIngredientsAction,
  addMissingIngredientsToShoppingListAction,
  undoMarkMealEntryCookedAction,
  markMealEntryCookedAction,
} = await import("@/app/dashboard/meal-planning/cooking-actions");
const { NEW_SHOPPING_LIST_SENTINEL } = await import("@/app/dashboard/meal-planning/meal-types");
const { weekRange } = await import("@/app/dashboard/meal-planning/missing-ingredients");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household });
});
requireHouseholdMock.mockResolvedValue({ household });

describe("previewMissingIngredientsAction", () => {
  it("rejects a malformed or over-long range without querying anything (GAP-32)", async () => {
    for (const range of [
      { from: "not-a-day", to: "2026-01-12" },
      { from: "2026-01-12", to: "2026-01-05" },
      { from: "2026-01-05", to: "2026-01-05" },
      // 32 days — one past MAX_MISSING_INGREDIENTS_RANGE_DAYS.
      { from: "2026-01-01", to: "2026-02-02" },
    ]) {
      expect(await previewMissingIngredientsAction(range)).toEqual({ error: "Invalid date range" });
    }
    // A bare week key (the pre-GAP-32 signature) from a stale client too.
    expect(
      await previewMissingIngredientsAction("2026-01-05" as unknown as { from: string; to: string }),
    ).toEqual({ error: "Invalid date range" });
    expect(mealPlanEntryFindManyMock).not.toHaveBeenCalled();
  });

  it("returns an empty list when nothing is planned in the range (never leaks another household's plan)", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction(weekRange("2026-01-05"));

    expect(result).toEqual({ items: [] });
    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mealPlan: { householdId: "household-1" } }),
      }),
    );
  });

  it("scopes the default week to exactly that week's seven days, recipe entries only", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([]);

    await previewMissingIngredientsAction(weekRange("2026-01-05"));

    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          mealPlan: { householdId: "household-1" },
          date: {
            gte: new Date("2026-01-05T00:00:00.000Z"),
            lt: new Date("2026-01-12T00:00:00.000Z"),
          },
          recipeId: { not: null },
        },
      }),
    );
  });

  it("converts through saved item conversions, linked or matched by name, with no extra query per recipe (MATCH-3)", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([{ recipeId: "bread", portions: 4, recipe: { servings: 4 } }]);
    recipeFindManyMock.mockResolvedValue([
      {
        id: "bread",
        ingredients: [
          {
            inventoryItemId: "inv-flour",
            inventoryItem: {
              name: "Flour",
              quantity: 1,
              unit: "pcs",
              unitConversions: [{ fromUnit: "g", factor: 0.0005 }],
            },
            name: "Flour",
            unit: "g",
            quantity: 3000,
          },
          // Its item was deleted; the name fallback finds "Yeast".
          { inventoryItemId: null, inventoryItem: null, name: "Yeast", unit: "g", quantity: 50 },
        ],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-yeast", name: "Yeast", quantity: 1, unit: "pcs", unitConversions: [{ fromUnit: "g", factor: 0.04 }] },
    ]);

    const result = await previewMissingIngredientsAction(weekRange("2026-01-05"));

    // 3000 g = 1.5 bags against 1 on hand; 50 g = 2 packs against 1.
    expect(result).toEqual({
      items: [
        { key: "inv-flour::pcs", name: "Flour", unit: "pcs", missingQuantity: 0.5, unitMismatch: false },
        { key: "inv-yeast::pcs", name: "Yeast", unit: "pcs", missingQuantity: 1, unitMismatch: false },
      ],
    });
    expect(recipeFindManyMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemFindManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1" },
      include: { unitConversions: { select: { fromUnit: true, factor: true } } },
    });
  });

  it("spans several weeks' meal plans for a multi-week range and totals across them (GAP-32)", async () => {
    // Two weeks, one soup entry in each — the MealPlan rows differ, but the
    // date filter picks both up and the shortfall is summed once.
    mealPlanEntryFindManyMock.mockResolvedValue([
      { recipeId: "soup", portions: 4, recipe: { servings: 4 } },
      { recipeId: "soup", portions: 4, recipe: { servings: 4 } },
    ]);
    recipeFindManyMock.mockResolvedValue([
      {
        id: "soup",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Carrot", unit: "kg", quantity: 1 }],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction({ from: "2026-01-05", to: "2026-01-19" });

    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mealPlan: { householdId: "household-1" },
          date: {
            gte: new Date("2026-01-05T00:00:00.000Z"),
            lt: new Date("2026-01-19T00:00:00.000Z"),
          },
        }),
      }),
    );
    expect(result).toEqual({
      items: [{ key: "name:carrot::kg", name: "Carrot", unit: "kg", missingQuantity: 2, unitMismatch: false }],
    });
  });

  it("accepts a range of exactly the 31-day cap", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction({ from: "2026-01-01", to: "2026-02-01" });

    expect(result).toEqual({ items: [] });
    expect(mealPlanEntryFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("includes a sub-recipe's ingredients when diffing a planned recipe that uses one", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([{ recipeId: "lasagna", portions: 4, recipe: { servings: 4 } }]);
    recipeFindManyMock.mockResolvedValue([
      {
        id: "lasagna",
        ingredients: [],
        components: [{ componentRecipeId: "bolognese", quantity: 1 }],
      },
      {
        id: "bolognese",
        ingredients: [
          {
            inventoryItemId: null,
            inventoryItem: null,
            name: "Ground beef",
            unit: "kg",
            quantity: 0.5,
          },
        ],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction(weekRange("2026-01-05"));

    expect(result).toEqual({
      items: [
        { key: "name:ground beef::kg", name: "Ground beef", unit: "kg", missingQuantity: 0.5, unitMismatch: false },
      ],
    });
  });

  it("never lists a Don't-track row as missing, but keeps a row whose item was deleted (MATCH-2)", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([{ recipeId: "bread", portions: 4, recipe: { servings: 4 } }]);
    recipeFindManyMock.mockResolvedValue([
      {
        id: "bread",
        ingredients: [
          { inventoryItemId: null, inventoryItem: null, untracked: true, name: "Vatten", unit: "dl", quantity: 3 },
          { inventoryItemId: null, inventoryItem: null, untracked: false, name: "Flour", unit: "g", quantity: 500 },
        ],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction(weekRange("2026-01-05"));

    expect(result).toEqual({
      items: [{ key: "name:flour::g", name: "Flour", unit: "g", missingQuantity: 500, unitMismatch: false }],
    });
  });

  it("scales each entry's ingredients by its portions relative to the recipe's own servings, instead of always counting a full recipe per entry", async () => {
    // A 4-serving soup recipe planned twice in the week (e.g. dinner Thursday
    // and lunch Friday), 2 portions each — together that's exactly one batch
    // of the recipe, not two.
    mealPlanEntryFindManyMock.mockResolvedValue([
      { recipeId: "soup", portions: 2, recipe: { servings: 4 } },
      { recipeId: "soup", portions: 2, recipe: { servings: 4 } },
    ]);
    recipeFindManyMock.mockResolvedValue([
      {
        id: "soup",
        ingredients: [
          { inventoryItemId: null, inventoryItem: null, name: "Carrot", unit: "kg", quantity: 2 },
        ],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction(weekRange("2026-01-05"));

    expect(result).toEqual({
      items: [{ key: "name:carrot::kg", name: "Carrot", unit: "kg", missingQuantity: 2, unitMismatch: false }],
    });
  });

  it("fetches the household's recipe graph once for the whole range, not once per entry (PERF-1)", async () => {
    // Three entries across three different recipes — before PERF-1 each one
    // called expandRecipeIngredients, and so re-ran recipe.findMany, on its
    // own. Loading the graph once and walking it per entry with
    // expandFromGraph must produce the identical totals at one query.
    mealPlanEntryFindManyMock.mockResolvedValue([
      { recipeId: "soup", portions: 4, recipe: { servings: 4 } },
      { recipeId: "lasagna", portions: 4, recipe: { servings: 4 } },
      { recipeId: "soup", portions: 4, recipe: { servings: 4 } },
    ]);
    recipeFindManyMock.mockResolvedValue([
      {
        id: "soup",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Carrot", unit: "kg", quantity: 1 }],
        components: [],
      },
      {
        id: "lasagna",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Pasta sheets", unit: "pcs", quantity: 12 }],
        components: [{ componentRecipeId: "bolognese", quantity: 1 }],
      },
      {
        id: "bolognese",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Ground beef", unit: "kg", quantity: 0.5 }],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction(weekRange("2026-01-05"));

    expect(recipeFindManyMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      items: [
        { key: "name:carrot::kg", name: "Carrot", unit: "kg", missingQuantity: 2, unitMismatch: false },
        { key: "name:ground beef::kg", name: "Ground beef", unit: "kg", missingQuantity: 0.5, unitMismatch: false },
        { key: "name:pasta sheets::pcs", name: "Pasta sheets", unit: "pcs", missingQuantity: 12, unitMismatch: false },
      ],
    });
  });

  it("scales up for a bigger crowd, and leaves a recipe with no usable servings count unscaled", async () => {
    // 6 portions of a 4-serving soup is 1.5 batches. The stew's servings of
    // 0 can't come from the recipe form (it validates ≥ 1), but if a row
    // ever holds one it must not zero out or blow up the shopping list, so
    // the recipe counts as written (portionsMultiplier's fallback).
    mealPlanEntryFindManyMock.mockResolvedValue([
      { recipeId: "soup", portions: 6, recipe: { servings: 4 } },
      { recipeId: "stew", portions: 2, recipe: { servings: 0 } },
    ]);
    recipeFindManyMock.mockResolvedValue([
      {
        id: "soup",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Carrot", unit: "kg", quantity: 2 }],
        components: [],
      },
      {
        id: "stew",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Potato", unit: "kg", quantity: 1 }],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction(weekRange("2026-01-05"));

    expect(result).toEqual({
      items: [
        { key: "name:carrot::kg", name: "Carrot", unit: "kg", missingQuantity: 3, unitMismatch: false },
        { key: "name:potato::kg", name: "Potato", unit: "kg", missingQuantity: 1, unitMismatch: false },
      ],
    });
  });
});

describe("addMissingIngredientsToShoppingListAction", () => {
  it("requires at least one valid ingredient row", async () => {
    const result = await addMissingIngredientsToShoppingListAction(
      {},
      formData({ targetListId: "list-1" }),
    );
    expect(result.error).toBe("Select at least one ingredient to add");
  });

  it("returns 'Shopping list not found' for a list outside the caller's household (IDOR guard)", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);
    const fd = formData({ targetListId: "someone-elses-list" });
    fd.append("itemName", "Carrot");
    fd.append("itemQuantity", "2");
    fd.append("itemUnit", "pcs");

    const result = await addMissingIngredientsToShoppingListAction({}, fd);

    expect(result.error).toBe("Shopping list not found");
  });

  it("creates a new list scoped to the caller's household when targetListId is the 'new list' sentinel", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "new-list" });
    shoppingListItemFindManyMock.mockResolvedValue([]);
    inventoryItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateManyMock.mockResolvedValue({});
    const fd = formData({ targetListId: NEW_SHOPPING_LIST_SENTINEL });
    fd.append("itemName", "Carrot");
    fd.append("itemQuantity", "2");
    fd.append("itemUnit", "pcs");

    const result = await addMissingIngredientsToShoppingListAction({}, fd);

    expect(result).toEqual({});
    expect(shoppingListCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ householdId: "household-1" }) }),
    );
  });

  it("links a known ingredient and leaves an unmatched one unlinked, never creating an inventory item (MATCH-1)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue([]);
    // "Carrot" exists (case-insensitive match); "Kale" doesn't.
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-carrot", name: "carrot", lastKnownPrice: 4 }]);
    shoppingListItemCreateManyMock.mockResolvedValue({});
    const fd = formData({ targetListId: "list-1" });
    fd.append("itemName", "Carrot");
    fd.append("itemQuantity", "2");
    fd.append("itemUnit", "pcs");
    fd.append("itemName", "Kale");
    fd.append("itemQuantity", "1");
    fd.append("itemUnit", "pcs");

    const result = await addMissingIngredientsToShoppingListAction({}, fd);

    expect(result).toEqual({});
    // One household-scoped inventory fetch for every row, and no create.
    expect(inventoryItemFindManyMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
    expect(inventoryItemCreateManyAndReturnMock).not.toHaveBeenCalled();
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ inventoryItemId: "inv-carrot", name: "Carrot", estimatedPrice: 4 }),
        expect.objectContaining({ inventoryItemId: null, name: "Kale" }),
      ],
    });
  });

  it("links a row through the household's learned alias (MATCH-5)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue([]);
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-egg", name: "Egg", lastKnownPrice: null }]);
    itemAliasFindManyMock.mockResolvedValueOnce([{ normalizedName: "ägg", inventoryItemId: "inv-egg" }]);
    shoppingListItemCreateManyMock.mockResolvedValue({});
    const fd = formData({ targetListId: "list-1" });
    fd.append("itemName", "Ägg");
    fd.append("itemQuantity", "6");
    fd.append("itemUnit", "pcs");

    await addMissingIngredientsToShoppingListAction({}, fd);

    expect(itemAliasFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [expect.objectContaining({ inventoryItemId: "inv-egg", name: "Ägg" })],
    });
  });

  it("doesn't add a second pending row for an item or unlinked name already on the list", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue([
      { inventoryItemId: "inv-carrot", name: "Carrot" },
      { inventoryItemId: null, name: "kale" },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-carrot", name: "Carrot", lastKnownPrice: null }]);
    shoppingListItemCreateManyMock.mockResolvedValue({});
    const fd = formData({ targetListId: "list-1" });
    for (const name of ["Carrot", "Kale", "Leek", "leek"]) {
      fd.append("itemName", name);
      fd.append("itemQuantity", "1");
      fd.append("itemUnit", "pcs");
    }

    await addMissingIngredientsToShoppingListAction({}, fd);

    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [expect.objectContaining({ inventoryItemId: null, name: "Leek" })],
    });
  });
});

describe("undoMarkMealEntryCookedAction", () => {
  it("returns 'Meal not found' for an entry outside the caller's household (IDOR guard)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(null);

    const result = await undoMarkMealEntryCookedAction("someone-elses-entry", [
      { itemId: "inv-1", quantity: 2 },
    ]);

    expect(result).toEqual({ error: "Meal not found" });
    expect(mealPlanEntryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "someone-elses-entry", mealPlan: { householdId: "household-1" } }),
      }),
    );
  });

  it("is a no-op when the entry was already undone (stale/double-clicked toast action)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: null });

    const result = await undoMarkMealEntryCookedAction("entry-1", [{ itemId: "inv-1", quantity: 2 }]);

    expect(result).toEqual({});
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("credits inventory back by the submitted quantities and clears consumedAt", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: new Date() });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", quantity: 3, lowStockThreshold: 1 },
    ]);
    inventoryItemUpdateMock.mockResolvedValue({});
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const result = await undoMarkMealEntryCookedAction("entry-1", [{ itemId: "inv-1", quantity: 2 }]);

    expect(result).toEqual({});
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ quantity: 5 }) }),
    );
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: { consumedAt: null },
    });
  });

  it("silently skips a row whose inventory item isn't in this household (IDOR guard)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: new Date() });
    inventoryItemFindManyMock.mockResolvedValue([]); // findMany is itself householdId-scoped
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const result = await undoMarkMealEntryCookedAction("entry-1", [
      { itemId: "someone-elses-item", quantity: 2 },
    ]);

    expect(result).toEqual({});
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateMock).toHaveBeenCalled();
  });
});

describe("markMealEntryCookedAction → low-stock auto-add (AUTO-8)", () => {
  it("runs the auto-add for each decremented item inside the transaction and returns what it added", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({
      id: "entry-1",
      recipeId: "recipe-1",
      portions: 2,
      consumedAt: null,
      recipe: { servings: 2 },
    });
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-1", quantity: 5, lowStockThreshold: 3 }]);
    const autoAdded = { shoppingListItemId: "row-1", listId: "default", listName: "Next shop", itemName: "Eggs" };
    addToDefaultListOnLowStockMock.mockResolvedValueOnce(autoAdded);

    const fd = new FormData();
    fd.set("entryId", "entry-1");
    fd.append("itemId", "inv-1");
    fd.append("itemQuantity", "3");
    const result = await markMealEntryCookedAction({}, fd);

    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(txClient, "household-1", "inv-1", 5, 2);
    expect(result).toEqual({ autoAdded: [autoAdded] });
  });
});

describe("markMealEntryCookedAction → leftovers (GAP-8)", () => {
  const cookableEntry = {
    id: "entry-1",
    recipeId: "recipe-1",
    portions: 2,
    consumedAt: null,
    recipe: { servings: 4, name: "Lasagna" },
  };

  function cookForm(leftoverServings?: string) {
    const fd = new FormData();
    fd.set("entryId", "entry-1");
    if (leftoverServings !== undefined) fd.set("leftoverServings", leftoverServings);
    return fd;
  }

  it("writes nothing to inventory for leftovers when the field is left blank or 0 (never auto-created)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(cookableEntry);
    mealPlanEntryUpdateMock.mockResolvedValue({});

    for (const value of [undefined, "", "0"]) {
      const result = await markMealEntryCookedAction({}, cookForm(value));
      expect(result).toEqual({});
    }

    expect(inventoryItemFindFirstMock).not.toHaveBeenCalled();
    expect(inventoryItemCreateMock).not.toHaveBeenCalled();
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid servings count before writing anything", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(cookableEntry);

    for (const value of ["-1", "2.5", "abc", "101"]) {
      const result = await markMealEntryCookedAction({}, cookForm(value));
      expect(result).toEqual({ error: expect.any(String) });
    }

    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates a household-scoped leftovers item with a ~3-day estimated expiry, inside the cook's transaction", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(cookableEntry);
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemCreateMock.mockResolvedValue({ id: "leftovers-1" });
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const before = Date.now();
    const result = await markMealEntryCookedAction({}, cookForm("2"));

    expect(inventoryItemFindFirstMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", name: { equals: "Leftovers: Lasagna", mode: "insensitive" } },
    });
    const data = inventoryItemCreateMock.mock.calls[0][0].data;
    expect(data).toMatchObject({
      householdId: "household-1",
      name: "Leftovers: Lasagna",
      category: "Leftovers",
      quantity: 2,
      unit: "servings",
      lowStockThreshold: 0,
      shelfLifeDays: 3,
      expiresAtEstimated: true,
    });
    const days = (data.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThanOrEqual(3);
    expect(days).toBeLessThan(3.01);
    expect(result).toEqual({ leftovers: { itemId: "leftovers-1", created: true } });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(mealPlanEntryUpdateMock).toHaveBeenCalled();
  });

  it("merges into an existing leftovers item of the same name instead of duplicating it", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(cookableEntry);
    const oldExpiry = new Date("2026-09-20T12:00:00.000Z");
    inventoryItemFindFirstMock.mockResolvedValue({
      id: "leftovers-1",
      quantity: 1,
      expiresAt: oldExpiry,
      expiresAtEstimated: true,
      shelfLifeDays: 3,
    });
    inventoryItemUpdateMock.mockResolvedValue({});
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const result = await markMealEntryCookedAction({}, cookForm("3"));

    expect(inventoryItemCreateMock).not.toHaveBeenCalled();
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "leftovers-1" },
      data: expect.objectContaining({ quantity: 4, expiresAtEstimated: true, expiresAt: expect.any(Date) }),
    });
    const newExpiry = inventoryItemUpdateMock.mock.calls[0][0].data.expiresAt as Date;
    expect(newExpiry.getTime()).toBeGreaterThan(oldExpiry.getTime());
    expect(result).toEqual({
      leftovers: {
        itemId: "leftovers-1",
        created: false,
        previousQuantity: 1,
        previousExpiresAt: oldExpiry.toISOString(),
        previousExpiresAtEstimated: true,
      },
    });
  });

  it("keeps a real (user-typed) expiry date when merging", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(cookableEntry);
    inventoryItemFindFirstMock.mockResolvedValue({
      id: "leftovers-1",
      quantity: 1,
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      expiresAtEstimated: false,
      shelfLifeDays: null,
    });
    inventoryItemUpdateMock.mockResolvedValue({});
    mealPlanEntryUpdateMock.mockResolvedValue({});

    await markMealEntryCookedAction({}, cookForm("1"));

    const data = inventoryItemUpdateMock.mock.calls[0][0].data;
    expect(data.quantity).toBe(2);
    expect(data).not.toHaveProperty("expiresAt");
  });
});

describe("undoMarkMealEntryCookedAction → leftovers (GAP-8)", () => {
  it("deletes a leftovers item the cook created, scoped to the household", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: new Date() });
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const result = await undoMarkMealEntryCookedAction("entry-1", [], { itemId: "leftovers-1", created: true });

    expect(result).toEqual({});
    expect(inventoryItemDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "leftovers-1", householdId: "household-1" },
    });
    expect(inventoryItemUpdateManyMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith({ where: { id: "entry-1" }, data: { consumedAt: null } });
  });

  it("restores a merged item's previous quantity and expiry, scoped to the household", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: new Date() });
    mealPlanEntryUpdateMock.mockResolvedValue({});

    await undoMarkMealEntryCookedAction("entry-1", [], {
      itemId: "leftovers-1",
      created: false,
      previousQuantity: 1,
      previousExpiresAt: "2026-09-20T12:00:00.000Z",
      previousExpiresAtEstimated: true,
    });

    expect(inventoryItemDeleteManyMock).not.toHaveBeenCalled();
    expect(inventoryItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "leftovers-1", householdId: "household-1" },
      data: expect.objectContaining({
        quantity: 1,
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
        expiresAtEstimated: true,
      }),
    });
  });

  it("doesn't touch leftovers when the undo is a stale no-op", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: null });

    await undoMarkMealEntryCookedAction("entry-1", [], { itemId: "leftovers-1", created: true });

    expect(inventoryItemDeleteManyMock).not.toHaveBeenCalled();
  });

  it("ignores a malformed leftovers payload but still undoes the cook", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: new Date() });
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const result = await undoMarkMealEntryCookedAction("entry-1", [], { itemId: "", created: true });

    expect(result).toEqual({});
    expect(inventoryItemDeleteManyMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateMock).toHaveBeenCalled();
  });
});
