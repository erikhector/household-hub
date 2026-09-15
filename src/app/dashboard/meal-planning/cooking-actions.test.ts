// Tests the module-private helpers plus every IDOR guard in
// src/app/dashboard/meal-planning/cooking-actions.ts, indirectly through the
// exported Server Actions. All I/O (Prisma, requireHousehold, next/cache,
// i18n) is mocked — no database call is made. See REQUIREMENTS.md's
// "Testing" section and the identical convention in
// src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  inventoryItemFindFirstMock,
  inventoryItemCreateMock,
  inventoryItemFindManyMock,
  inventoryItemUpdateMock,
  recipeFindUniqueMock,
  mealPlanFindFirstMock,
  mealPlanEntryFindFirstMock,
  mealPlanEntryUpdateMock,
  shoppingListCreateMock,
  shoppingListFindFirstMock,
  shoppingListItemFindManyMock,
  shoppingListItemCreateMock,
  transactionMock,
  revalidatePathMock,
  recordRestockTransitionMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  inventoryItemFindFirstMock: vi.fn(),
  inventoryItemCreateMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  inventoryItemUpdateMock: vi.fn(),
  recipeFindUniqueMock: vi.fn(),
  mealPlanFindFirstMock: vi.fn(),
  mealPlanEntryFindFirstMock: vi.fn(),
  mealPlanEntryUpdateMock: vi.fn(),
  shoppingListCreateMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  shoppingListItemFindManyMock: vi.fn(),
  shoppingListItemCreateMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  recordRestockTransitionMock: vi.fn(),
}));

const txClient = {
  inventoryItem: { findMany: inventoryItemFindManyMock, update: inventoryItemUpdateMock },
  mealPlanEntry: { update: mealPlanEntryUpdateMock },
};
transactionMock.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: {
      findFirst: inventoryItemFindFirstMock,
      create: inventoryItemCreateMock,
      findMany: inventoryItemFindManyMock,
    },
    recipe: { findUnique: recipeFindUniqueMock },
    mealPlan: { findFirst: mealPlanFindFirstMock },
    mealPlanEntry: { findFirst: mealPlanEntryFindFirstMock },
    shoppingList: { create: shoppingListCreateMock, findFirst: shoppingListFindFirstMock },
    shoppingListItem: { findMany: shoppingListItemFindManyMock, create: shoppingListItemCreateMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    shoppingList: { defaultNamePrefix: "Shopping list" },
  })),
}));
vi.mock("@/lib/notifications", () => ({
  recordOutOfStockTransition: vi.fn(),
  recordRestockTransition: recordRestockTransitionMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  previewMissingIngredientsAction,
  addMissingIngredientsToShoppingListAction,
  undoMarkMealEntryCookedAction,
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
    const recipesById: Record<string, unknown> = {
      lasagna: {
        id: "lasagna",
        ingredients: [],
        components: [{ componentRecipeId: "bolognese", quantity: 1 }],
      },
      bolognese: {
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
    };
    recipeFindUniqueMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
      recipesById[where.id] ?? null,
    );
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction("2026-01-05");

    expect(result).toEqual({
      items: [{ key: "name:ground beef::kg", name: "Ground beef", unit: "kg", missingQuantity: 0.5 }],
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
    recipeFindUniqueMock.mockResolvedValue({
      id: "soup",
      ingredients: [
        { inventoryItemId: null, inventoryItem: null, name: "Carrot", unit: "kg", quantity: 2 },
      ],
      components: [],
    });
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await previewMissingIngredientsAction("2026-01-05");

    expect(result).toEqual({
      items: [{ key: "name:carrot::kg", name: "Carrot", unit: "kg", missingQuantity: 2 }],
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
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-1" });
    shoppingListItemCreateMock.mockResolvedValue({});
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
    expect(recordRestockTransitionMock).toHaveBeenCalledWith(txClient, "household-1", "inv-1", 3, 1, 5, 1);
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
