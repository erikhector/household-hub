// Tests the module-private zod schemas/parsers plus every IDOR guard in
// src/app/dashboard/meal-planning/recipe-actions.ts, indirectly through the
// exported Server Actions. All I/O (Prisma, requireHousehold, next/cache,
// i18n, recipe-import) is mocked — no database or network call is made.
// See REQUIREMENTS.md's "Testing" section and the identical convention in
// src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  inventoryItemFindManyMock,
  inventoryItemCreateManyAndReturnMock,
  recipeCreateMock,
  recipeFindFirstMock,
  recipeFindManyMock,
  recipeDeleteMock,
  recipeIngredientDeleteManyMock,
  recipeUpdateMock,
  recipeComponentFindManyMock,
  recipeComponentFindFirstMock,
  recipeComponentDeleteManyMock,
  itemAliasFindManyMock,
  itemAliasUpsertMock,
  itemUnitConversionUpsertMock,
  transactionMock,
  fetchRecipeHtmlMock,
  parseRecipeFromHtmlMock,
  revalidatePathMock,
  checkRateLimitMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  inventoryItemCreateManyAndReturnMock: vi.fn(),
  recipeCreateMock: vi.fn(),
  recipeFindFirstMock: vi.fn(),
  recipeFindManyMock: vi.fn(),
  recipeDeleteMock: vi.fn(),
  recipeIngredientDeleteManyMock: vi.fn(),
  recipeUpdateMock: vi.fn(),
  recipeComponentFindManyMock: vi.fn<
    (args: { where: { parentRecipeId: { in: string[] } } }) => Promise<{ componentRecipeId: string }[]>
  >(),
  recipeComponentFindFirstMock: vi.fn(),
  recipeComponentDeleteManyMock: vi.fn(),
  itemAliasFindManyMock: vi.fn(async () => [] as { normalizedName: string; inventoryItemId: string | null }[]),
  itemAliasUpsertMock: vi.fn(),
  itemUnitConversionUpsertMock: vi.fn(),
  // Interactive transactions run their callback against the same mocked
  // client (set up in the prisma mock below).
  transactionMock: vi.fn(),
  fetchRecipeHtmlMock: vi.fn(),
  parseRecipeFromHtmlMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  // Defaults to "allowed" so every existing test (which doesn't care about
  // the SEC-2 rate limit) keeps working unmodified; the rate-limit tests
  // below override this per-case.
  checkRateLimitMock: vi.fn(async () => true),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    inventoryItem: {
      findMany: inventoryItemFindManyMock,
      createManyAndReturn: inventoryItemCreateManyAndReturnMock,
    },
    recipe: {
      create: recipeCreateMock,
      findFirst: recipeFindFirstMock,
      findMany: recipeFindManyMock,
      update: recipeUpdateMock,
      delete: recipeDeleteMock,
    },
    recipeIngredient: { deleteMany: recipeIngredientDeleteManyMock },
    itemAlias: {
      findMany: itemAliasFindManyMock,
      upsert: itemAliasUpsertMock,
    },
    itemUnitConversion: { upsert: itemUnitConversionUpsertMock },
    recipeComponent: {
      findMany: recipeComponentFindManyMock,
      findFirst: recipeComponentFindFirstMock,
      deleteMany: recipeComponentDeleteManyMock,
    },
    $transaction: transactionMock,
  };
  transactionMock.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  return { prisma };
});
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return {
    getDictionary: vi.fn(async () => ({
      mealPlanning: {
        importErrorInvalidUrl: "Enter a valid URL",
        importErrorBlockedHost: "That host can't be fetched",
        importErrorFetchFailed: "Couldn't fetch that page",
        importErrorNoRecipeFound: "No recipe found on that page",
        importErrorRateLimited: "Too many recipe imports, slow down",
        componentQuantityError: "Sub-recipe amounts must be greater than 0",
        componentNotFoundError: "One of the selected sub-recipes could not be found.",
        componentCycleError: "That would create a circular reference between recipes.",
        deleteRecipeInUseError: 'Can\'t delete — used as a sub-recipe in "{recipeName}".',
        ingredientRowLimitError: en.mealPlanning.ingredientRowLimitError,
        ingredientItemNotFoundError: en.mealPlanning.ingredientItemNotFoundError,
        ingredientReview: en.mealPlanning.ingredientReview,
      },
      // Backs createCategoryResolver's dictionary tier (AUTO-2b) —
      // resolveIngredientDecisions resolves a real category for a new item
      // the same way the inventory/shopping-list create paths do.
      inventory: { uncategorized: "Uncategorized", autoCategories: en.inventory.autoCategories },
    })),
  };
});
vi.mock("@/lib/recipe-import", () => ({
  fetchRecipeHtml: fetchRecipeHtmlMock,
  parseRecipeFromHtml: parseRecipeFromHtmlMock,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  createRecipeAction,
  previewIngredientMatchesAction,
  updateRecipeAction,
  deleteRecipeAction,
  toggleRecipeFavoriteAction,
  importRecipeFromUrlAction,
} = await import("@/app/dashboard/meal-planning/recipe-actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

// One ingredient row, with the MATCH-1 decision fields posted in parallel
// (every field for every row, like the dialog does, so the arrays align).
function appendIngredient(
  fd: FormData,
  row: {
    name: string;
    quantity?: string;
    unit?: string;
    decision?: "existing" | "new" | "untracked" | "";
    itemId?: string;
    newName?: string;
    newCategory?: string;
    newUnit?: string;
    rawText?: string;
    note?: string;
    unitAction?: "none" | "remember" | "override" | "defer" | "";
    unitFactor?: string;
    overrideQuantity?: string;
  },
) {
  fd.append("ingredientName", row.name);
  fd.append("ingredientQuantity", row.quantity ?? "1");
  fd.append("ingredientUnit", row.unit ?? "pcs");
  fd.append("ingredientDecision", row.decision ?? "");
  fd.append("ingredientItemId", row.itemId ?? "");
  fd.append("ingredientNewName", row.newName ?? "");
  fd.append("ingredientNewCategory", row.newCategory ?? "");
  fd.append("ingredientNewUnit", row.newUnit ?? "");
  fd.append("ingredientRawText", row.rawText ?? "");
  fd.append("ingredientNote", row.note ?? "");
  fd.append("ingredientUnitAction", row.unitAction ?? "");
  fd.append("ingredientUnitFactor", row.unitFactor ?? "");
  fd.append("ingredientOverrideQuantity", row.overrideQuantity ?? "");
}

// What a saved row looks like when the test doesn't care about the MATCH-2
// columns.
const savedRow = (row: { name: string; quantity: number; unit: string; inventoryItemId: string | null }) => ({
  rawText: null,
  note: null,
  untracked: false,
  ...row,
});

const household = { id: "household-1" };

// The one upsert per learned alias (MATCH-2), latest answer wins.
const aliasUpsert = (normalizedName: string, inventoryItemId: string | null) => ({
  where: { householdId_normalizedName: { householdId: "household-1", normalizedName } },
  create: { householdId: "household-1", normalizedName, inventoryItemId },
  update: { inventoryItemId },
});

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

  it("never creates an item for a row with no decision, and links only an exact name (MATCH-1)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-carrot", name: "carrot", category: "Produce", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Soup" });
    // An older client posts no decision fields at all.
    for (const name of ["Carrot", "Carrots", "Kale"]) {
      fd.append("ingredientName", name);
      fd.append("ingredientQuantity", "2");
      fd.append("ingredientUnit", "pcs");
    }

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
    expect(inventoryItemCreateManyAndReturnMock).not.toHaveBeenCalled();
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        ingredients: {
          create: [
            savedRow({ name: "Carrot", quantity: 2, unit: "pcs", inventoryItemId: "inv-carrot" }),
            // A plural is only a suggestion: without a decision it stays unlinked.
            savedRow({ name: "Carrots", quantity: 2, unit: "pcs", inventoryItemId: null }),
            savedRow({ name: "Kale", quantity: 2, unit: "pcs", inventoryItemId: null }),
          ],
        },
      }),
    });
  });

  it("links an `existing` decision after checking the item belongs to the household", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-egg", name: "Egg", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, { name: "eggs", quantity: "3", decision: "existing", itemId: "inv-egg" });

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    expect(inventoryItemFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["inv-egg"] }, householdId: "household-1" },
      select: { id: true, name: true, unit: true },
    });
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: { create: [savedRow({ name: "eggs", quantity: 3, unit: "pcs", inventoryItemId: "inv-egg" })] },
      }),
    });
  });

  it("saves a Don't-track row with no link, never creates, and remembers the name as untracked (MATCH-2)", async () => {
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, { name: "Vatten", quantity: "3", unit: "dl", decision: "untracked" });

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    // Nothing to look up: no item is chosen and nothing is matched by name.
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
    expect(inventoryItemCreateManyAndReturnMock).not.toHaveBeenCalled();
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: {
          create: [{ name: "Vatten", quantity: 3, unit: "dl", rawText: null, note: null, untracked: true, inventoryItemId: null }],
        },
      }),
    });
    expect(itemAliasUpsertMock).toHaveBeenCalledWith(aliasUpsert("vatten", null));
  });

  it("writes an alias only when the linked item's normalized name differs (MATCH-2)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-egg", name: "Egg", unit: "pcs" },
      { id: "inv-milk", name: "Mjölk", unit: "pcs" },
    ]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Pancakes" });
    appendIngredient(fd, { name: "eggs (large)", decision: "existing", itemId: "inv-egg" });
    appendIngredient(fd, { name: "mjölk.", decision: "existing", itemId: "inv-milk" });

    await createRecipeAction({}, fd);

    // Keyed without the prep note, the way the matcher looks it up; "mjölk."
    // already normalizes to the item's own name, so it gets none.
    expect(itemAliasUpsertMock).toHaveBeenCalledTimes(1);
    expect(itemAliasUpsertMock).toHaveBeenCalledWith(aliasUpsert("eggs", "inv-egg"));
  });

  it("writes no alias when every link already matches by name (MATCH-2)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-egg", name: "Egg", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, { name: "egg", decision: "existing", itemId: "inv-egg" });

    await createRecipeAction({}, fd);

    expect(itemAliasUpsertMock).not.toHaveBeenCalled();
  });

  it("aliases a name to a new item created under a different name (MATCH-2)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-egg", name: "Egg", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, { name: "ägg", decision: "new", newName: "Egg", newCategory: "Dairy" });

    await createRecipeAction({}, fd);

    expect(itemAliasUpsertMock).toHaveBeenCalledWith(aliasUpsert("ägg", "inv-egg"));
  });

  it("never turns a missing new-item link into a Don't-track alias (MATCH-2 follow-up)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    // The insert came back without the row this alias points at.
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, {
      name: "ägg",
      unit: "g",
      decision: "new",
      newName: "Egg",
      newCategory: "Dairy",
      newUnit: "pcs",
      unitAction: "remember",
      unitFactor: "0.02",
    });

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    // Skipped, not written with a null item (which would mean Don't track).
    expect(itemAliasUpsertMock).not.toHaveBeenCalled();
    expect(itemUnitConversionUpsertMock).not.toHaveBeenCalled();
  });

  it("upserts each alias so concurrent saves can't collide, and the last row about a name wins (MATCH-2 follow-up)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-egg", name: "Egg", unit: "pcs" },
      { id: "inv-duck-egg", name: "Duck egg", unit: "pcs" },
    ]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, { name: "eggs", decision: "existing", itemId: "inv-egg" });
    appendIngredient(fd, { name: "Eggs", decision: "existing", itemId: "inv-duck-egg" });

    await createRecipeAction({}, fd);

    // One INSERT … ON CONFLICT per name instead of delete + insert, which
    // two simultaneous saves could both reach and fail on the unique index.
    expect(itemAliasUpsertMock).toHaveBeenCalledTimes(1);
    expect(itemAliasUpsertMock).toHaveBeenCalledWith(aliasUpsert("eggs", "inv-duck-egg"));
  });

  it("remembers a unit conversion for a household item, keyed by the canonical unit (MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-flour", name: "Vetemjöl", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      quantity: "300",
      unit: "Gram",
      decision: "existing",
      itemId: "inv-flour",
      unitAction: "remember",
      unitFactor: "0.0005",
    });

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    // Only after the item was checked against the household.
    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["inv-flour"] }, householdId: "household-1" } }),
    );
    expect(itemUnitConversionUpsertMock).toHaveBeenCalledWith({
      where: { inventoryItemId_fromUnit: { inventoryItemId: "inv-flour", fromUnit: "g" } },
      create: { inventoryItemId: "inv-flour", fromUnit: "g", factor: 0.0005 },
      update: { factor: 0.0005 },
    });
    // The row itself is saved as the recipe wrote it.
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: {
          create: [savedRow({ name: "vetemjöl", quantity: 300, unit: "Gram", inventoryItemId: "inv-flour" })],
        },
      }),
    });
  });

  it("remembers a conversion for a new item against the id it was created with (MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-new-flour", name: "Vetemjöl" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      quantity: "300",
      unit: "g",
      decision: "new",
      newName: "Vetemjöl",
      newCategory: "Baking",
      newUnit: "pcs",
      unitAction: "remember",
      unitFactor: "0.0005",
    });

    await createRecipeAction({}, fd);

    expect(itemUnitConversionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ create: { inventoryItemId: "inv-new-flour", fromUnit: "g", factor: 0.0005 } }),
    );
  });

  it.each(["0", "-2", "abc", "", "Infinity"])("rejects a conversion factor of %j and writes nothing (MATCH-3)", async (factor) => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-flour", name: "Vetemjöl", unit: "pcs" }]);
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      unit: "g",
      decision: "existing",
      itemId: "inv-flour",
      unitAction: "remember",
      unitFactor: factor,
    });

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({ error: "Enter a number greater than 0 for the conversion." });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(itemUnitConversionUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown unit action", async () => {
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, { name: "vetemjöl", decision: "existing", itemId: "inv-flour", unitAction: "guess" as "none" });

    expect(await createRecipeAction({}, fd)).toEqual({ error: "Invalid input" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("never remembers a conversion for another household's item (IDOR guard, MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      unit: "g",
      decision: "existing",
      itemId: "someone-elses-flour",
      unitAction: "remember",
      unitFactor: "0.0005",
    });

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({ error: "One of the chosen pantry items no longer exists. Go back and pick again." });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(itemUnitConversionUpsertMock).not.toHaveBeenCalled();
  });

  it("stores no conversion when the units already reconcile (MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-milk", name: "Mjölk", unit: "l" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Pancakes" });
    appendIngredient(fd, {
      name: "mjölk",
      quantity: "6",
      unit: "dl",
      decision: "existing",
      itemId: "inv-milk",
      unitAction: "remember",
      unitFactor: "5",
    });

    await createRecipeAction({}, fd);

    expect(itemUnitConversionUpsertMock).not.toHaveBeenCalled();
  });

  it("overrides a row into the item's unit for this recipe only, keeping the original line (MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-flour", name: "Vetemjöl", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      quantity: "300",
      unit: "g",
      decision: "existing",
      itemId: "inv-flour",
      unitAction: "override",
      overrideQuantity: "0.15",
    });

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    expect(itemUnitConversionUpsertMock).not.toHaveBeenCalled();
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: {
          create: [
            {
              ...savedRow({ name: "vetemjöl", quantity: 0.15, unit: "pcs", inventoryItemId: "inv-flour" }),
              rawText: "300 g vetemjöl",
            },
          ],
        },
      }),
    });
  });

  it("keeps an imported line as the override's original text (MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-flour", name: "Vetemjöl", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      quantity: "300",
      unit: "g",
      rawText: "3 dl vetemjöl (ca 300 g)",
      decision: "existing",
      itemId: "inv-flour",
      unitAction: "override",
      overrideQuantity: "0.15",
    });

    await createRecipeAction({}, fd);

    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: { create: [expect.objectContaining({ rawText: "3 dl vetemjöl (ca 300 g)", unit: "pcs" })] },
      }),
    });
  });

  it("rejects a non-positive override amount (MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-flour", name: "Vetemjöl", unit: "pcs" }]);
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      unit: "g",
      decision: "existing",
      itemId: "inv-flour",
      unitAction: "override",
      overrideQuantity: "0",
    });

    expect(await createRecipeAction({}, fd)).toEqual({ error: "Enter an amount greater than 0." });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("leaves a deferred row as the recipe wrote it (MATCH-3)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-flour", name: "Vetemjöl", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, {
      name: "vetemjöl",
      quantity: "300",
      unit: "g",
      decision: "existing",
      itemId: "inv-flour",
      unitAction: "defer",
    });

    await createRecipeAction({}, fd);

    expect(itemUnitConversionUpsertMock).not.toHaveBeenCalled();
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: {
          create: [savedRow({ name: "vetemjöl", quantity: 300, unit: "g", inventoryItemId: "inv-flour" })],
        },
      }),
    });
  });

  it("stores the imported line and prep note (MATCH-2)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-onion", name: "Gul lök", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Soup" });
    appendIngredient(fd, {
      name: "gul lök",
      decision: "existing",
      itemId: "inv-onion",
      rawText: "1 gul lök, finhackad",
      note: "finhackad",
    });

    await createRecipeAction({}, fd);

    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: {
          create: [
            {
              name: "gul lök",
              quantity: 1,
              unit: "pcs",
              rawText: "1 gul lök, finhackad",
              note: "finhackad",
              untracked: false,
              inventoryItemId: "inv-onion",
            },
          ],
        },
      }),
    });
  });

  it("rejects an over-long prep note", async () => {
    const fd = formData({ name: "Soup" });
    appendIngredient(fd, { name: "onion", note: "x".repeat(201) });

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("Invalid input");
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("still rejects a foreign item id alongside a Don't-track row, writing no alias (IDOR guard)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    const fd = formData({ name: "Bread" });
    appendIngredient(fd, { name: "vatten", decision: "untracked" });
    appendIngredient(fd, { name: "flour", decision: "existing", itemId: "someone-elses-item" });

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("One of the chosen pantry items no longer exists. Go back and pick again.");
    expect(transactionMock).not.toHaveBeenCalled();
    expect(itemAliasUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects an item id from another household instead of creating or dropping it (IDOR guard)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, { name: "eggs", decision: "existing", itemId: "someone-elses-item" });

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("One of the chosen pantry items no longer exists. Go back and pick again.");
    expect(transactionMock).not.toHaveBeenCalled();
    expect(inventoryItemCreateManyAndReturnMock).not.toHaveBeenCalled();
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an `existing` decision with no item id", async () => {
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, { name: "eggs", decision: "existing" });

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("One of the chosen pantry items no longer exists. Go back and pick again.");
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown decision", async () => {
    const fd = formData({ name: "Omelette" });
    appendIngredient(fd, { name: "eggs", decision: "bogus" as "new" });

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("Invalid input");
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("creates a `new` item with a guessed category and a pantry unit, in one transaction with the recipe", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-milk", name: "Milk", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Pancakes" });
    appendIngredient(fd, { name: "Milk", quantity: "3", unit: "dl", decision: "new" });

    await createRecipeAction({}, fd);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            householdId: "household-1",
            name: "Milk",
            category: "Dairy & eggs",
            unit: "l",
            quantity: 0,
            lowStockThreshold: 0,
          },
        ],
      }),
    );
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: { create: [savedRow({ name: "Milk", quantity: 3, unit: "dl", inventoryItemId: "inv-milk" })] },
      }),
    });
  });

  it("uses the name, category and unit chosen in the review, never second-guessing the category", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-onion", name: "Lök", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Soup" });
    appendIngredient(fd, {
      name: "gul lök",
      decision: "new",
      newName: "Lök",
      newCategory: "Grönsaker",
      newUnit: "kg",
    });

    await createRecipeAction({}, fd);

    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ name: "Lök", category: "Grönsaker", unit: "kg" })],
      }),
    );
  });

  it("names a new item without the trailing prep note", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-onion", name: "gul lök", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Soup" });
    appendIngredient(fd, { name: "gul lök (finhackad)", decision: "new" });

    await createRecipeAction({}, fd);

    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ name: "gul lök" })] }),
    );
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: {
          create: [savedRow({ name: "gul lök (finhackad)", quantity: 1, unit: "pcs", inventoryItemId: "inv-onion" })],
        },
      }),
    });
  });

  it("creates one item for two `new` rows with the same name, and links a `new` name that already exists", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-salt", name: "Salt", category: "Pantry", unit: "pcs" }]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "inv-kale", name: "Kale", unit: "pcs" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Salad" });
    appendIngredient(fd, { name: "Kale", decision: "new" });
    appendIngredient(fd, { name: "kale", decision: "new" });
    appendIngredient(fd, { name: "salt", decision: "new" });

    await createRecipeAction({}, fd);

    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ name: "Kale" })] }),
    );
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ingredients: {
          create: [
            savedRow({ name: "Kale", quantity: 1, unit: "pcs", inventoryItemId: "inv-kale" }),
            savedRow({ name: "kale", quantity: 1, unit: "pcs", inventoryItemId: "inv-kale" }),
            savedRow({ name: "salt", quantity: 1, unit: "pcs", inventoryItemId: "inv-salt" }),
          ],
        },
      }),
    });
  });

  it("still falls back to 'Uncategorized' for a name the resolver doesn't recognize", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([{ id: "new-inv-item", name: "Xyzzyplorp" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Mystery dish" });
    appendIngredient(fd, { name: "Xyzzyplorp", decision: "new" });

    await createRecipeAction({}, fd);

    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ name: "Xyzzyplorp", category: "Uncategorized" })],
      }),
    );
  });

  it("resolves categories for a batch of new items with the one inventory lookup (SCALE-B)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateManyAndReturnMock.mockResolvedValue([
      { id: "inv-milk", name: "Milk", unit: "pcs" },
      { id: "inv-bread", name: "Bread", unit: "pcs" },
      { id: "inv-chicken", name: "Chicken", unit: "pcs" },
    ]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Dinner" });
    for (const name of ["Milk", "Bread", "Chicken"]) appendIngredient(fd, { name, decision: "new" });

    await createRecipeAction({}, fd);

    // The inventory loaded for the exact-name check also seeds the
    // category resolver, so three new items still cost one query.
    expect(inventoryItemFindManyMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemCreateManyAndReturnMock).toHaveBeenCalledTimes(1);
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

  it("caps the number of ingredient rows (SEC-7)", async () => {
    const fd = formData({ name: "Everything stew" });
    for (let i = 0; i < 101; i++) appendIngredient(fd, { name: `Thing ${i}` });

    const result = await createRecipeAction({}, fd);

    expect(result.error).toBe("A recipe can have at most 100 ingredients.");
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("batches sub-recipe existence checks across component rows into one findMany (SCALE-B)", async () => {
    recipeFindManyMock.mockResolvedValue([{ id: "bolognese" }, { id: "garlic-bread" }]);
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Lasagna" });
    fd.append("componentRecipeId", "bolognese");
    fd.append("componentQuantity", "1");
    fd.append("componentRecipeId", "garlic-bread");
    fd.append("componentQuantity", "2");

    await createRecipeAction({}, fd);

    expect(recipeFindManyMock).toHaveBeenCalledTimes(1);
    expect(recipeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["bolognese", "garlic-bread"] }, householdId: "household-1" }),
      }),
    );
    expect(recipeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          components: {
            create: [
              { componentRecipeId: "bolognese", quantity: 1 },
              { componentRecipeId: "garlic-bread", quantity: 2 },
            ],
          },
        }),
      }),
    );
  });

  it("rejects a sub-recipe id that isn't a household recipe (IDOR guard)", async () => {
    recipeFindManyMock.mockResolvedValue([]);
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
    recipeFindManyMock.mockResolvedValue([{ id: "bolognese" }]);
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
    recipeFindManyMock.mockResolvedValue([{ id: "bolognese" }]);
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

  it("sets all four optional nutrition fields when provided, rounding calories", async () => {
    recipeCreateMock.mockResolvedValue({});

    await createRecipeAction(
      {},
      formData({
        name: "Soup",
        caloriesPerServing: "310.6",
        proteinGramsPerServing: "12.5",
        carbsGramsPerServing: "40",
        fatGramsPerServing: "8.25",
      }),
    );

    expect(recipeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caloriesPerServing: 311,
          proteinGramsPerServing: 12.5,
          carbsGramsPerServing: 40,
          fatGramsPerServing: 8.25,
        }),
      }),
    );
  });

  it("defaults every nutrition field to null when left blank", async () => {
    recipeCreateMock.mockResolvedValue({});

    await createRecipeAction({}, formData({ name: "Soup" }));

    expect(recipeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caloriesPerServing: null,
          proteinGramsPerServing: null,
          carbsGramsPerServing: null,
          fatGramsPerServing: null,
        }),
      }),
    );
  });

  it("rejects a negative nutrition value", async () => {
    const result = await createRecipeAction(
      {},
      formData({ name: "Soup", caloriesPerServing: "-5" }),
    );

    expect(result.error).toBe("Nutrition values can't be negative");
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });
});

describe("createRecipeAction tags (GAP-29)", () => {
  it("persists only known tags, deduped and in canonical order", async () => {
    recipeCreateMock.mockResolvedValue({});
    const fd = formData({ name: "Salad" });
    for (const tag of ["quick", "vegan", "keto", "quick", "<script>", "glutenFree"]) fd.append("tags", tag);

    const result = await createRecipeAction({}, fd);

    expect(result).toEqual({});
    expect(recipeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ householdId: "household-1", tags: ["vegan", "glutenFree", "quick"] }),
    });
  });

  it("saves an empty tag list when none are posted", async () => {
    recipeCreateMock.mockResolvedValue({});

    await createRecipeAction({}, formData({ name: "Salad" }));

    expect(recipeCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ tags: [] }) });
  });
});

describe("updateRecipeAction", () => {
  it("replaces tags with the validated posted set (GAP-29)", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "lasagna" });
    recipeUpdateMock.mockResolvedValue({});
    const fd = formData({ recipeId: "lasagna", name: "Lasagna" });
    fd.append("tags", "vegetarian");
    fd.append("tags", "notATag");

    await updateRecipeAction({}, fd);

    expect(recipeUpdateMock).toHaveBeenCalledWith({
      where: { id: "lasagna" },
      data: expect.objectContaining({ tags: ["vegetarian"] }),
    });
  });

  it("clears every tag when an edit posts none (GAP-29)", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "lasagna" });
    recipeUpdateMock.mockResolvedValue({});

    await updateRecipeAction({}, formData({ recipeId: "lasagna", name: "Lasagna" }));

    expect(recipeUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tags: [] }) }),
    );
  });

  it("doesn't write tags for a recipe outside the caller's household (GAP-29, IDOR guard)", async () => {
    recipeFindFirstMock.mockResolvedValue(null);
    const fd = formData({ recipeId: "foreign", name: "Lasagna" });
    fd.append("tags", "vegan");

    const result = await updateRecipeAction({}, fd);

    expect(result.error).toBe("Recipe not found");
    expect(recipeFindFirstMock).toHaveBeenCalledWith({ where: { id: "foreign", householdId: "household-1" } });
    expect(recipeUpdateMock).not.toHaveBeenCalled();
  });

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
    recipeFindManyMock.mockResolvedValue([{ id: "bolognese" }]);
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
    recipeFindManyMock.mockResolvedValue([{ id: "bolognese" }]);
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

  it("keeps an existing link on edit instead of re-matching the name (MATCH-1)", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "omelette" });
    // The household's egg item: the row's name doesn't match it exactly,
    // but the dialog carried the saved link through as `existing`.
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-egg", name: "Egg", unit: "pcs" }]);
    recipeUpdateMock.mockResolvedValue({});
    const fd = formData({ recipeId: "omelette", name: "Omelette" });
    appendIngredient(fd, { name: "ägg", quantity: "3", unit: "st", decision: "existing", itemId: "inv-egg" });

    const result = await updateRecipeAction({}, fd);

    expect(result).toEqual({});
    expect(inventoryItemCreateManyAndReturnMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(recipeIngredientDeleteManyMock).toHaveBeenCalledWith({ where: { recipeId: "omelette" } });
    expect(recipeUpdateMock).toHaveBeenCalledWith({
      where: { id: "omelette" },
      data: expect.objectContaining({
        ingredients: { create: [savedRow({ name: "ägg", quantity: 3, unit: "st", inventoryItemId: "inv-egg" })] },
      }),
    });
  });

  it("clears a previously-set nutrition field back to null when the input is emptied", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "lasagna" });
    recipeUpdateMock.mockResolvedValue({});
    const fd = formData({ recipeId: "lasagna", name: "Lasagna", proteinGramsPerServing: "20" });
    fd.delete("proteinGramsPerServing");

    await updateRecipeAction({}, fd);

    expect(recipeUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caloriesPerServing: null,
          proteinGramsPerServing: null,
          carbsGramsPerServing: null,
          fatGramsPerServing: null,
        }),
      }),
    );
  });
});

describe("previewIngredientMatchesAction (MATCH-1)", () => {
  const pantry = [
    { id: "inv-egg", name: "Egg", category: "Dairy & eggs", unit: "pcs" },
    { id: "inv-tomatoes", name: "Tomatoes", category: "Produce", unit: "pcs" },
  ];

  it("matches against the caller's household only, and writes nothing", async () => {
    inventoryItemFindManyMock.mockResolvedValue(pantry);

    const result = await previewIngredientMatchesAction([
      { name: "egg", unit: "st" },
      { name: "Tomater", unit: "pcs" },
      { name: "Milk", unit: "dl" },
    ]);

    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
    expect(inventoryItemCreateManyAndReturnMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    if ("error" in result) throw new Error(result.error);
    expect(result.matches.map((match) => [match.status, match.itemId])).toEqual([
      ["confident", "inv-egg"],
      ["suggested", "inv-tomatoes"],
      ["none", null],
    ]);
    expect(result.items).toEqual(pantry);
    expect(result.categories).toEqual(["Dairy & eggs", "Produce"]);
    // A category is only guessed for rows that may become a new item.
    expect(result.guessedCategories[0]).toBeNull();
    expect(result.guessedCategories[2]).toBe("Dairy & eggs");
  });

  it("uses the household's learned aliases (MATCH-2)", async () => {
    inventoryItemFindManyMock.mockResolvedValue(pantry);
    itemAliasFindManyMock.mockResolvedValueOnce([
      { normalizedName: "eggs", inventoryItemId: "inv-egg" },
      { normalizedName: "salt", inventoryItemId: null },
    ]);

    const result = await previewIngredientMatchesAction([
      { name: "Eggs", unit: "pcs" },
      { name: "salt", unit: "tsp" },
      { name: "vatten", unit: "dl" },
    ]);

    expect(itemAliasFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.matches.map((match) => [match.status, match.itemId, match.untracked])).toEqual([
      ["confident", "inv-egg", false],
      ["confident", null, true],
      ["suggested", null, true],
    ]);
    // Nothing to guess for a row that defaults to Don't track.
    expect(result.guessedCategories).toEqual([null, null, null]);
  });

  it("is confident about a unit the item's saved conversion covers, and sends the conversions along (MATCH-3)", async () => {
    const conversions = [{ fromUnit: "g", factor: 0.0005 }];
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-flour", name: "Vetemjöl", category: "Baking", unit: "pcs", unitConversions: conversions },
    ]);

    const result = await previewIngredientMatchesAction([{ name: "vetemjöl", unit: "g" }]);

    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: "household-1" },
        select: expect.objectContaining({ unitConversions: { select: { fromUnit: true, factor: true } } }),
      }),
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.matches[0]).toMatchObject({ status: "confident", itemId: "inv-flour", unitClass: "known" });
    expect(result.items).toEqual([
      { id: "inv-flour", name: "Vetemjöl", category: "Baking", unit: "pcs", conversions },
    ]);
  });

  it("requires a household session", async () => {
    requireHouseholdMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(previewIngredientMatchesAction([{ name: "Egg", unit: "pcs" }])).rejects.toThrow();
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
  });

  it("caps the number of rows (SEC-7)", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ name: `Thing ${i}`, unit: "pcs" }));

    const result = await previewIngredientMatchesAction(rows);

    expect(result).toEqual({ error: "A recipe can have at most 100 ingredients." });
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects an over-long name", async () => {
    const result = await previewIngredientMatchesAction([{ name: "x".repeat(121), unit: "pcs" }]);
    expect(result).toHaveProperty("error");
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
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

describe("toggleRecipeFavoriteAction", () => {
  it("no-ops for a recipe outside the caller's household (IDOR guard)", async () => {
    recipeFindFirstMock.mockResolvedValue(null);

    const result = await toggleRecipeFavoriteAction("someone-elses-recipe");

    expect(result).toEqual({});
    expect(recipeFindFirstMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-recipe", householdId: "household-1" },
      select: { id: true, isFavorite: true },
    });
    expect(recipeUpdateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("stars an un-starred recipe", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-1", isFavorite: false });
    recipeUpdateMock.mockResolvedValue({});

    const result = await toggleRecipeFavoriteAction("recipe-1");

    expect(result).toEqual({});
    expect(recipeUpdateMock).toHaveBeenCalledWith({
      where: { id: "recipe-1" },
      data: { isFavorite: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("un-stars a starred recipe, flipping the stored value rather than trusting the client", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-1", isFavorite: true });
    recipeUpdateMock.mockResolvedValue({});

    await toggleRecipeFavoriteAction("recipe-1");

    expect(recipeUpdateMock).toHaveBeenCalledWith({
      where: { id: "recipe-1" },
      data: { isFavorite: false },
    });
  });

  it("requires a household session", async () => {
    requireHouseholdMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(toggleRecipeFavoriteAction("recipe-1")).rejects.toThrow("NEXT_REDIRECT");
    expect(recipeFindFirstMock).not.toHaveBeenCalled();
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
    parseRecipeFromHtmlMock.mockReturnValue({
      name: "Soup",
      instructions: "",
      ingredients: [],
      source: "jsonld",
      tags: ["vegan"],
    });

    const result = await importRecipeFromUrlAction({}, formData({ url: "https://example.com/recipe" }));

    expect(result.recipe).toEqual({
      name: "Soup",
      instructions: "",
      ingredients: [],
      source: "jsonld",
      tags: ["vegan"],
    });
  });

  // SEC-2: this action makes the server fetch an arbitrary URL, so it needs
  // its own rate limit independent of the SSRF guard — without one, a
  // household could still hammer a third party (or repeatedly probe
  // internal addresses past that guard) through us at will.
  it("refuses to fetch once the per-household rate limit is hit, without calling fetchRecipeHtml", async () => {
    checkRateLimitMock.mockResolvedValueOnce(false);

    const result = await importRecipeFromUrlAction({}, formData({ url: "https://example.com/recipe" }));

    expect(result.error).toBe("Too many recipe imports, slow down");
    expect(fetchRecipeHtmlMock).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the caller's own household, not on client input", async () => {
    fetchRecipeHtmlMock.mockResolvedValue({ ok: false, error: "fetchFailed" });

    await importRecipeFromUrlAction({}, formData({ url: "https://example.com/recipe" }));

    expect(checkRateLimitMock).toHaveBeenCalledWith(`recipe-import:${household.id}`, 20, 60 * 60 * 1000);
  });
});
