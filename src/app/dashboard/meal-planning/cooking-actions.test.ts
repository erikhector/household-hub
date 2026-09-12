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
  recipeFindUniqueMock,
  mealPlanFindFirstMock,
  shoppingListCreateMock,
  shoppingListFindFirstMock,
  shoppingListItemFindManyMock,
  shoppingListItemCreateMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  inventoryItemFindFirstMock: vi.fn(),
  inventoryItemCreateMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  recipeFindUniqueMock: vi.fn(),
  mealPlanFindFirstMock: vi.fn(),
  shoppingListCreateMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  shoppingListItemFindManyMock: vi.fn(),
  shoppingListItemCreateMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: {
      findFirst: inventoryItemFindFirstMock,
      create: inventoryItemCreateMock,
      findMany: inventoryItemFindManyMock,
    },
    recipe: { findUnique: recipeFindUniqueMock },
    mealPlan: { findFirst: mealPlanFindFirstMock },
    shoppingList: { create: shoppingListCreateMock, findFirst: shoppingListFindFirstMock },
    shoppingListItem: { findMany: shoppingListItemFindManyMock, create: shoppingListItemCreateMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    shoppingList: { defaultNamePrefix: "Shopping list" },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { previewMissingIngredientsAction, addMissingIngredientsToShoppingListAction } = await import(
  "@/app/dashboard/meal-planning/cooking-actions"
);
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
