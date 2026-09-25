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
  inventoryItemCreateManyAndReturnMock,
  inventoryItemUpdateMock,
  inventoryItemFindFirstMock,
  inventoryItemCreateMock,
  inventoryItemUpdateManyMock,
  inventoryItemDeleteManyMock,
  recipeFindManyMock,
  mealPlanFindFirstMock,
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
  inventoryItemCreateManyAndReturnMock: vi.fn(),
  inventoryItemUpdateMock: vi.fn(),
  inventoryItemFindFirstMock: vi.fn(),
  inventoryItemCreateMock: vi.fn(),
  inventoryItemUpdateManyMock: vi.fn(),
  inventoryItemDeleteManyMock: vi.fn(),
  recipeFindManyMock: vi.fn(),
  mealPlanFindFirstMock: vi.fn(),
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
    recipe: { findMany: recipeFindManyMock },
    mealPlan: { findFirst: mealPlanFindFirstMock },
    mealPlanEntry: { findFirst: mealPlanEntryFindFirstMock },
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
      // Backs createCategoryResolver's dictionary tier (AUTO-2b) —
      // addMissingIngredientsToShoppingListAction resolves a real category
      // for a brand-new ingredient the same way the inventory/shopping-list
      // create paths do.
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
  it("rejects a malformed week key", async () => {
    const result = await previewMissingIngredientsAction("not-a-week");
    expect(result).toEqual({ error: "Invalid week" });
  });

  it("returns an empty list when there's no meal plan for that week (never leaks another household's plan)", async () => {
    mealPlanFindFirstMock.mockResolvedValue(null);

    const result = await previewMissingIngredientsAction("2026-01-05");

    expect(result).toEqual({ items: [] });
    expect(mealPlanFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ householdId: "household-1" }) }),
    );
  });

  it("includes a sub-recipe's ingredients when diffing a planned recipe that uses one", async () => {
    mealPlanFindFirstMock.mockResolvedValue({
      entries: [{ recipeId: "lasagna", portions: 4, recipe: { servings: 4 } }],
    });
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

    const result = await previewMissingIngredientsAction("2026-01-05");

    expect(result).toEqual({
      items: [
        { key: "name:ground beef::kg", name: "Ground beef", unit: "kg", missingQuantity: 0.5, unitMismatch: false },
      ],
    });
  });

  it("scales each entry's ingredients by its portions relative to the recipe's own servings, instead of always counting a full recipe per entry", async () => {
    // A 4-serving soup recipe planned twice in the week (e.g. dinner Thursday
    // and lunch Friday), 2 portions each — together that's exactly one batch
    // of the recipe, not two.
    mealPlanFindFirstMock.mockResolvedValue({
      entries: [
        { recipeId: "soup", portions: 2, recipe: { servings: 4 } },
        { recipeId: "soup", portions: 2, recipe: { servings: 4 } },
      ],
    });
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

    const result = await previewMissingIngredientsAction("2026-01-05");

    expect(result).toEqual({
      items: [{ key: "name:carrot::kg", name: "Carrot", unit: "kg", missingQuantity: 2, unitMismatch: false }],
    });
  });

  it("scales up for a bigger crowd, and leaves a recipe with no usable servings count unscaled", async () => {
    // 6 portions of a 4-serving soup is 1.5 batches. The stew's servings of
    // 0 can't come from the recipe form (it validates ≥ 1), but if a row
    // ever holds one it must not zero out or blow up the shopping list, so
    // the recipe counts as written (portionsMultiplier's fallback).
    mealPlanFindFirstMock.mockResolvedValue({
      entries: [
        { recipeId: "soup", portions: 6, recipe: { servings: 4 } },
        { recipeId: "stew", portions: 2, recipe: { servings: 0 } },
      ],
    });
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

    const result = await previewMissingIngredientsAction("2026-01-05");

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
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-1", name: "Carrot" }]);
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

  it("batches inventory find-or-create across rows into one lookup and one createMany (SCALE-A)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue([]);
    // "Carrot" already exists (case-insensitive match); "Kale" doesn't.
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-carrot", name: "carrot", category: "Produce" }]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-kale", name: "Kale" }]);
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
    // Two calls total, not three: one lookup for every distinct name (the
    // find-or-create itself), one for createCategoryResolver's
    // household-memory load (AUTO-2b) — the resolver memoizes that load, so
    // it never scales with the number of new ingredients (see the next
    // test), and there's still exactly one createMany for the missing row.
    expect(inventoryItemFindManyMock).toHaveBeenCalledTimes(2);
    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ name: "Kale" })] }),
    );
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledTimes(1);
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ inventoryItemId: "inv-carrot", name: "Carrot" }),
        expect.objectContaining({ inventoryItemId: "inv-kale", name: "Kale" }),
      ],
    });
  });

  it("guesses a category for a brand-new ingredient instead of writing 'Uncategorized' (AUTO-2b)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue([]);
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-milk", name: "Milk" }]);
    shoppingListItemCreateManyMock.mockResolvedValue({});
    const fd = formData({ targetListId: "list-1" });
    fd.append("itemName", "Milk");
    fd.append("itemQuantity", "1");
    fd.append("itemUnit", "l");

    await addMissingIngredientsToShoppingListAction({}, fd);

    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ name: "Milk", category: "Dairy & eggs" })],
      }),
    );
  });

  it("still falls back to 'Uncategorized' for a name the resolver doesn't recognize", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue([]);
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-mystery", name: "Xyzzyplorp" }]);
    shoppingListItemCreateManyMock.mockResolvedValue({});
    const fd = formData({ targetListId: "list-1" });
    fd.append("itemName", "Xyzzyplorp");
    fd.append("itemQuantity", "1");
    fd.append("itemUnit", "pcs");

    await addMissingIngredientsToShoppingListAction({}, fd);

    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ name: "Xyzzyplorp", category: "Uncategorized" })],
      }),
    );
  });

  it("resolves categories for every new ingredient in a batch with one lookup, not one per ingredient", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue([]);
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([
      { id: "inv-milk", name: "Milk" },
      { id: "inv-bread", name: "Bread" },
      { id: "inv-chicken", name: "Chicken" },
    ]);
    shoppingListItemCreateManyMock.mockResolvedValue({});
    const fd = formData({ targetListId: "list-1" });
    for (const name of ["Milk", "Bread", "Chicken"]) {
      fd.append("itemName", name);
      fd.append("itemQuantity", "1");
      fd.append("itemUnit", "pcs");
    }

    await addMissingIngredientsToShoppingListAction({}, fd);

    // One call for the find-or-create's own existence check, one for the
    // category resolver's household-memory load — still 2 regardless of the
    // 3 new ingredients resolved against it.
    expect(inventoryItemFindManyMock).toHaveBeenCalledTimes(2);
    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ name: "Milk", category: "Dairy & eggs" }),
          expect.objectContaining({ name: "Bread", category: "Bakery" }),
          expect.objectContaining({ name: "Chicken", category: "Meat & fish" }),
        ],
      }),
    );
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
