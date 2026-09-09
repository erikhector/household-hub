// Tests the module-private zod schemas/parsers plus every IDOR guard in
// src/app/dashboard/meal-planning/actions.ts, indirectly through the
// exported Server Actions. All I/O (Prisma, requireHousehold, next/cache,
// i18n, recipe-import) is mocked — no database or network call is made.
// See REQUIREMENTS.md's "Testing" section and the identical convention in
// src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  inventoryItemFindFirstMock,
  inventoryItemCreateMock,
  inventoryItemFindManyMock,
  recipeCreateMock,
  recipeFindFirstMock,
  recipeFindUniqueMock,
  recipeDeleteMock,
  recipeIngredientDeleteManyMock,
  recipeUpdateMock,
  recipeComponentFindManyMock,
  recipeComponentFindFirstMock,
  recipeComponentDeleteManyMock,
  transactionMock,
  mealPlanEntryFindFirstMock,
  mealPlanEntryCreateMock,
  mealPlanEntryDeleteMock,
  mealPlanUpsertMock,
  mealPlanFindFirstMock,
  shoppingListCreateMock,
  shoppingListFindFirstMock,
  shoppingListItemFindManyMock,
  shoppingListItemCreateMock,
  fetchRecipeHtmlMock,
  parseRecipeFromHtmlMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  inventoryItemFindFirstMock: vi.fn(),
  inventoryItemCreateMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  recipeCreateMock: vi.fn(),
  recipeFindFirstMock: vi.fn(),
  recipeFindUniqueMock: vi.fn(),
  recipeDeleteMock: vi.fn(),
  recipeIngredientDeleteManyMock: vi.fn(),
  recipeUpdateMock: vi.fn(),
  recipeComponentFindManyMock: vi.fn<
    (args: { where: { parentRecipeId: { in: string[] } } }) => Promise<{ componentRecipeId: string }[]>
  >(),
  recipeComponentFindFirstMock: vi.fn(),
  recipeComponentDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  mealPlanEntryFindFirstMock: vi.fn(),
  mealPlanEntryCreateMock: vi.fn(),
  mealPlanEntryDeleteMock: vi.fn(),
  mealPlanUpsertMock: vi.fn(),
  mealPlanFindFirstMock: vi.fn(),
  shoppingListCreateMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  shoppingListItemFindManyMock: vi.fn(),
  shoppingListItemCreateMock: vi.fn(),
  fetchRecipeHtmlMock: vi.fn(),
  parseRecipeFromHtmlMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: {
      findFirst: inventoryItemFindFirstMock,
      create: inventoryItemCreateMock,
      findMany: inventoryItemFindManyMock,
    },
    recipe: {
      create: recipeCreateMock,
      findFirst: recipeFindFirstMock,
      findUnique: recipeFindUniqueMock,
      update: recipeUpdateMock,
      delete: recipeDeleteMock,
    },
    recipeIngredient: { deleteMany: recipeIngredientDeleteManyMock },
    recipeComponent: {
      findMany: recipeComponentFindManyMock,
      findFirst: recipeComponentFindFirstMock,
      deleteMany: recipeComponentDeleteManyMock,
    },
    mealPlanEntry: {
      findFirst: mealPlanEntryFindFirstMock,
      create: mealPlanEntryCreateMock,
      delete: mealPlanEntryDeleteMock,
    },
    mealPlan: { upsert: mealPlanUpsertMock, findFirst: mealPlanFindFirstMock },
    shoppingList: { create: shoppingListCreateMock, findFirst: shoppingListFindFirstMock },
    shoppingListItem: { findMany: shoppingListItemFindManyMock, create: shoppingListItemCreateMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    shoppingList: { defaultNamePrefix: "Shopping list" },
    mealPlanning: {
      importErrorInvalidUrl: "Enter a valid URL",
      importErrorBlockedHost: "That host can't be fetched",
      importErrorFetchFailed: "Couldn't fetch that page",
      importErrorNoRecipeFound: "No recipe found on that page",
      componentQuantityError: "Sub-recipe amounts must be greater than 0",
      componentNotFoundError: "One of the selected sub-recipes could not be found.",
      componentCycleError: "That would create a circular reference between recipes.",
      deleteRecipeInUseError: 'Can\'t delete — used as a sub-recipe in "{recipeName}".',
    },
  })),
}));
vi.mock("@/lib/recipe-import", () => ({
  fetchRecipeHtml: fetchRecipeHtmlMock,
  parseRecipeFromHtml: parseRecipeFromHtmlMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  createRecipeAction,
  updateRecipeAction,
  deleteRecipeAction,
  addMealEntryAction,
  deleteMealEntryAction,
  importRecipeFromUrlAction,
  previewMissingIngredientsAction,
  addMissingIngredientsToShoppingListAction,
} = await import("@/app/dashboard/meal-planning/actions");
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
  recipeComponentFindManyMock.mockResolvedValue([]);
});
requireHouseholdMock.mockResolvedValue({ household });
// Default: no existing components anywhere, so wouldCreateCycle's BFS finds
// nothing and cleanly returns false unless a test overrides this to set up
// a specific "contains" graph.
recipeComponentFindManyMock.mockResolvedValue([]);

describe("createRecipeAction", () => {
  it("rejects a missing name", async () => {
    const result = await createRecipeAction({}, formData({ name: " " }));
    expect(result.error).toBe("Name is required");
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an ingredient name over 120 characters", async () => {
    const fd = formData({ name: "Soup" });
    fd.append("ingredientName", "x".repeat(121));
    fd.append("ingredientQuantity", "1");
    fd.append("ingredientUnit", "pcs");

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("Ingredient names must be 120 characters or fewer");
  });

  it("rejects a non-positive ingredient quantity", async () => {
    const fd = formData({ name: "Soup" });
    fd.append("ingredientName", "Carrot");
    fd.append("ingredientQuantity", "0");
    fd.append("ingredientUnit", "pcs");

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("Ingredient quantities must be greater than 0");
  });

  it("skips blank ingredient rows", async () => {
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1" });
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Soup" });
    fd.append("ingredientName", "");
    fd.append("ingredientQuantity", "1");
    fd.append("ingredientUnit", "pcs");

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    expect(recipeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ingredients: { create: [] } }) }),
    );
  });

  it("find-or-creates an inventory item per ingredient, scoped to the caller's household", async () => {
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemCreateMock.mockResolvedValue({ id: "new-inv-item" });
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Soup" });
    fd.append("ingredientName", "Carrot");
    fd.append("ingredientQuantity", "2");
    fd.append("ingredientUnit", "pcs");

    await createRecipeAction({}, fd);

    expect(inventoryItemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ householdId: "household-1", name: "Carrot" }) }),
    );
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        ingredients: {
          create: [{ name: "Carrot", quantity: 2, unit: "pcs", inventoryItemId: "new-inv-item" }],
        },
      }),
    });
  });

  it("rejects a sub-recipe id that isn't a household recipe (IDOR guard)", async () => {
    recipeFindFirstMock.mockResolvedValue(null);
    const fd = formData({ name: "Lasagna" });
    fd.append("componentRecipeId", "someone-elses-recipe");
    fd.append("componentQuantity", "1");

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("One of the selected sub-recipes could not be found.");
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive sub-recipe quantity", async () => {
    const fd = formData({ name: "Lasagna" });
    fd.append("componentRecipeId", "bolognese");
    fd.append("componentQuantity", "0");

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("Sub-recipe amounts must be greater than 0");
  });

  it("skips a duplicate sub-recipe row rather than erroring", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "bolognese" });
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Lasagna" });
    fd.append("componentRecipeId", "bolognese");
    fd.append("componentQuantity", "1");
    fd.append("componentRecipeId", "bolognese");
    fd.append("componentQuantity", "1");

    await createRecipeAction({}, fd);

    expect(recipeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          components: { create: [{ componentRecipeId: "bolognese", quantity: 1 }] },
        }),
      }),
    );
  });

  it("nests valid sub-recipe rows into the create call (a brand-new recipe can never form a cycle)", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "bolognese" });
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Lasagna" });
    fd.append("componentRecipeId", "bolognese");
    fd.append("componentQuantity", "2");

    await createRecipeAction({}, fd);

    expect(recipeComponentFindManyMock).not.toHaveBeenCalled();
    expect(recipeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          components: { create: [{ componentRecipeId: "bolognese", quantity: 2 }] },
        }),
      }),
    );
  });
});

describe("updateRecipeAction", () => {
  it("returns 'Recipe not found' for a recipe outside the caller's household (IDOR guard)", async () => {
    recipeFindFirstMock.mockResolvedValue(null);

    const result = await updateRecipeAction(
      {},
      formData({ recipeId: "someone-elses-recipe", name: "Soup" }),
    );

    expect(result.error).toBe("Recipe not found");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a sub-recipe edit that would create a cycle", async () => {
    recipeFindFirstMock.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
    }));
    // bolognese already (transitively) contains lasagna, so adding bolognese
    // as one of lasagna's own components would close the loop.
    recipeComponentFindManyMock.mockImplementation(
      async ({ where }: { where: { parentRecipeId: { in: string[] } } }) =>
        where.parentRecipeId.in.includes("bolognese") ? [{ componentRecipeId: "lasagna" }] : [],
    );
    const fd = formData({ recipeId: "lasagna", name: "Lasagna" });
    fd.append("componentRecipeId", "bolognese");
    fd.append("componentQuantity", "1");

    const result = await updateRecipeAction({}, fd);

    expect(result.error).toBe("That would create a circular reference between recipes.");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("replaces existing sub-recipes in the same transaction as ingredients", async () => {
    recipeFindFirstMock.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
    }));
    recipeComponentFindManyMock.mockResolvedValue([]);
    recipeUpdateMock.mockResolvedValue({});
    const fd = formData({ recipeId: "lasagna", name: "Lasagna" });
    fd.append("componentRecipeId", "bolognese");
    fd.append("componentQuantity", "2");

    const result = await updateRecipeAction({}, fd);

    expect(result).toEqual({});
    expect(recipeComponentDeleteManyMock).toHaveBeenCalledWith({
      where: { parentRecipeId: "lasagna" },
    });
    expect(recipeUpdateMock).toHaveBeenCalledWith({
      where: { id: "lasagna" },
      data: expect.objectContaining({
        components: { create: [{ componentRecipeId: "bolognese", quantity: 2 }] },
      }),
    });
  });
});

describe("deleteRecipeAction", () => {
  it("no-ops for a recipe outside the caller's household (IDOR guard)", async () => {
    recipeFindFirstMock.mockResolvedValue(null);

    const result = await deleteRecipeAction("someone-elses-recipe");

    expect(result).toEqual({});
    expect(recipeComponentFindFirstMock).not.toHaveBeenCalled();
    expect(recipeDeleteMock).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller's household, then deletes", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-1" });
    recipeComponentFindFirstMock.mockResolvedValue(null);
    recipeDeleteMock.mockResolvedValue({});

    const result = await deleteRecipeAction("recipe-1");

    expect(result).toEqual({});
    expect(recipeFindFirstMock).toHaveBeenCalledWith({
      where: { id: "recipe-1", householdId: "household-1" },
    });
    expect(recipeDeleteMock).toHaveBeenCalledWith({ where: { id: "recipe-1" } });
  });

  it("blocks deleting a recipe that's still used as a sub-recipe elsewhere", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "bolognese" });
    recipeComponentFindFirstMock.mockResolvedValue({ parentRecipe: { name: "Lasagna" } });

    const result = await deleteRecipeAction("bolognese");

    expect(result.error).toBe('Can\'t delete — used as a sub-recipe in "Lasagna".');
    expect(recipeDeleteMock).not.toHaveBeenCalled();
  });
});

describe("addMealEntryAction", () => {
  const base = { weekStartDate: "2026-01-05", date: "2026-01-06", mealType: "DINNER" };

  it("rejects a malformed week/date", async () => {
    const result = await addMealEntryAction({}, formData({ ...base, weekStartDate: "not-a-date" }));
    expect(result.error).toBe("Invalid week");
  });

  it("returns 'Recipe not found' for a recipe outside the caller's household (IDOR guard)", async () => {
    recipeFindFirstMock.mockResolvedValue(null);

    const result = await addMealEntryAction({}, formData({ ...base, recipeId: "someone-elses-recipe" }));

    expect(result.error).toBe("Recipe not found");
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
  });

  it("requires a freeform name when no recipe is chosen", async () => {
    const result = await addMealEntryAction({}, formData(base));
    expect(result.error).toBe("Choose a recipe or enter a meal name");
  });

  it("creates the meal plan (upsert) and entry for a valid recipe-linked meal, defaulting portions to the recipe's own servings", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-1", servings: 6 });
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });
    mealPlanEntryCreateMock.mockResolvedValue({});

    const result = await addMealEntryAction({}, formData({ ...base, recipeId: "recipe-1" }));

    expect(result).toEqual({});
    expect(mealPlanUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId_weekStartDate: {
            householdId: "household-1",
            weekStartDate: new Date("2026-01-05T00:00:00.000Z"),
          },
        },
      }),
    );
    expect(mealPlanEntryCreateMock).toHaveBeenCalledWith({
      data: {
        mealPlanId: "plan-1",
        date: new Date("2026-01-06T00:00:00.000Z"),
        mealType: "DINNER",
        recipeId: "recipe-1",
        freeformName: null,
        portions: 6,
      },
    });
  });

  it("uses an explicit portions count instead of the recipe's own servings when the form sends one", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-1", servings: 6 });
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });
    mealPlanEntryCreateMock.mockResolvedValue({});

    await addMealEntryAction(
      {},
      formData({ ...base, recipeId: "recipe-1", portions: "2" }),
    );

    expect(mealPlanEntryCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ portions: 2 }) }),
    );
  });
});

describe("deleteMealEntryAction", () => {
  it("no-ops for an entry outside the caller's household (IDOR guard)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(null);

    await deleteMealEntryAction("someone-elses-entry");

    expect(mealPlanEntryDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes an entry that belongs to the caller's household", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    mealPlanEntryDeleteMock.mockResolvedValue({});

    await deleteMealEntryAction("entry-1");

    expect(mealPlanEntryDeleteMock).toHaveBeenCalledWith({ where: { id: "entry-1" } });
  });
});

describe("importRecipeFromUrlAction", () => {
  it("requires a household session even though nothing household-scoped is read/written", async () => {
    fetchRecipeHtmlMock.mockResolvedValue({ ok: false, error: "fetchFailed" });
    await importRecipeFromUrlAction({}, formData({ url: "https://example.com/recipe" }));
    expect(requireHouseholdMock).toHaveBeenCalled();
  });

  it("rejects a blank URL", async () => {
    const result = await importRecipeFromUrlAction({}, formData({ url: " " }));
    expect(result.error).toBe("Enter a valid URL");
  });

  it("surfaces the SSRF guard's blockedHost error via the dictionary", async () => {
    fetchRecipeHtmlMock.mockResolvedValue({ ok: false, error: "blockedHost" });

    const result = await importRecipeFromUrlAction({}, formData({ url: "http://169.254.169.254/" }));

    expect(result.error).toBe("That host can't be fetched");
  });

  it("returns the parsed recipe on success", async () => {
    fetchRecipeHtmlMock.mockResolvedValue({ ok: true, html: "<html/>" });
    parseRecipeFromHtmlMock.mockReturnValue({ name: "Soup", instructions: "", ingredients: [] });

    const result = await importRecipeFromUrlAction({}, formData({ url: "https://example.com/recipe" }));

    expect(result.recipe).toEqual({ name: "Soup", instructions: "", ingredients: [] });
  });
});

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
