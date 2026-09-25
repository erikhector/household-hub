// See src/app/dashboard/meal-planning/cooking-actions.test.ts for the mocking
// convention this mirrors: prisma is mocked, no database is touched.
import { describe, expect, it, vi } from "vitest";

const { recipeFindManyMock } = vi.hoisted(() => ({
  recipeFindManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { recipe: { findMany: recipeFindManyMock } },
}));

const { expandRecipeIngredients, portionsMultiplier } = await import("@/app/dashboard/meal-planning/recipe-expansion");

const HOUSEHOLD_ID = "house-1";

type FakeRecipe = {
  id: string;
  ingredients: { inventoryItemId: string | null; inventoryItem: { name: string; quantity: number; unit: string } | null; name: string; unit: string; quantity: number }[];
  components: { componentRecipeId: string; quantity: number }[];
};

// Fetches the whole household's recipe graph in one call now, rather than
// per-node — assert every call is scoped to the given household, and hand
// back the fake graph regardless of how many times a test's expansion
// recurses (loadRecipeGraph runs once per expandRecipeIngredients call, not
// once per recursive step — see recipe-expansion.ts).
function mockRecipes(recipes: FakeRecipe[]) {
  recipeFindManyMock.mockImplementation(async ({ where }: { where: { householdId: string } }) => {
    expect(where.householdId).toBe(HOUSEHOLD_ID);
    return recipes;
  });
}

describe("expandRecipeIngredients", () => {
  it("returns a leaf recipe's own ingredients unscaled at multiplier 1", async () => {
    mockRecipes([
      {
        id: "bolognese",
        ingredients: [
          { inventoryItemId: "inv-beef", inventoryItem: { name: "Ground beef", quantity: 2, unit: "kg" }, name: "Ground beef", unit: "kg", quantity: 0.5 },
        ],
        components: [],
      },
    ]);

    const result = await expandRecipeIngredients(HOUSEHOLD_ID, "bolognese", 1, new Set());

    expect(result).toEqual([
      {
        inventoryItemId: "inv-beef",
        inventoryItemName: "Ground beef",
        onHandQuantity: 2,
        onHandUnit: "kg",
        name: "Ground beef",
        unit: "kg",
        quantity: 0.5,
      },
    ]);
    expect(recipeFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("includes a sub-recipe's ingredients scaled by the component's quantity", async () => {
    mockRecipes([
      {
        id: "lasagna",
        ingredients: [
          { inventoryItemId: "inv-pasta", inventoryItem: { name: "Pasta sheets", quantity: 1, unit: "pcs" }, name: "Pasta sheets", unit: "pcs", quantity: 12 },
        ],
        components: [{ componentRecipeId: "bolognese", quantity: 2 }],
      },
      {
        id: "bolognese",
        ingredients: [
          { inventoryItemId: "inv-beef", inventoryItem: { name: "Ground beef", quantity: 2, unit: "kg" }, name: "Ground beef", unit: "kg", quantity: 0.5 },
        ],
        components: [],
      },
    ]);

    const result = await expandRecipeIngredients(HOUSEHOLD_ID, "lasagna", 1, new Set());

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Pasta sheets", quantity: 12 }),
        // 2 batches of bolognese -> 0.5kg * 2 = 1kg of beef.
        expect.objectContaining({ name: "Ground beef", quantity: 1 }),
      ]),
    );
    // One findMany fetches the whole graph — the sub-recipe lookup is an
    // in-memory Map read, not a second query.
    expect(recipeFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("multiplies through nested sub-recipes (a component of a component)", async () => {
    mockRecipes([
      {
        id: "lasagna",
        ingredients: [],
        components: [{ componentRecipeId: "bolognese", quantity: 2 }],
      },
      {
        id: "bolognese",
        ingredients: [],
        components: [{ componentRecipeId: "tomato-sauce", quantity: 3 }],
      },
      {
        id: "tomato-sauce",
        ingredients: [
          { inventoryItemId: null, inventoryItem: null, name: "Tomato passata", unit: "L", quantity: 1 },
        ],
        components: [],
      },
    ]);

    const result = await expandRecipeIngredients(HOUSEHOLD_ID, "lasagna", 1, new Set());

    // 1L per batch of tomato-sauce, 3 batches per bolognese, 2 batches of
    // bolognese -> 1 * 3 * 2 = 6L.
    expect(result).toEqual([
      {
        inventoryItemId: null,
        inventoryItemName: null,
        onHandQuantity: null,
        onHandUnit: null,
        name: "Tomato passata",
        unit: "L",
        quantity: 6,
      },
    ]);
  });

  it("stops recursing if a recipe id is already on the current path (cycle safety net)", async () => {
    mockRecipes([
      {
        id: "a",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "A ingredient", unit: "pcs", quantity: 1 }],
        components: [{ componentRecipeId: "b", quantity: 1 }],
      },
      {
        id: "b",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "B ingredient", unit: "pcs", quantity: 1 }],
        components: [{ componentRecipeId: "a", quantity: 1 }],
      },
    ]);

    const result = await expandRecipeIngredients(HOUSEHOLD_ID, "a", 1, new Set());

    // "a"'s own ingredient, then "b"'s own ingredient, then the cycle back
    // to "a" is cut short instead of recursing forever.
    expect(result.map((r) => r.name)).toEqual(["A ingredient", "B ingredient"]);
  });

  it("returns an empty list for a recipe that no longer exists", async () => {
    mockRecipes([]);
    expect(await expandRecipeIngredients(HOUSEHOLD_ID, "gone", 1, new Set())).toEqual([]);
  });

  it("returns an empty list for a component id missing from the household's graph (stale or cross-household id)", async () => {
    // Same not-found behavior a `findUnique` miss used to produce — a
    // dangling componentRecipeId (e.g. left behind by a since-deleted
    // recipe, or belonging to a different household) simply contributes
    // nothing rather than throwing.
    mockRecipes([
      {
        id: "lasagna",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Pasta sheets", unit: "pcs", quantity: 12 }],
        components: [{ componentRecipeId: "missing-recipe", quantity: 1 }],
      },
    ]);

    const result = await expandRecipeIngredients(HOUSEHOLD_ID, "lasagna", 1, new Set());

    expect(result.map((r) => r.name)).toEqual(["Pasta sheets"]);
  });
});

describe("portionsMultiplier", () => {
  it("is 1 when the entry feeds exactly as many as the recipe makes", () => {
    expect(portionsMultiplier(4, 4)).toBe(1);
    expect(portionsMultiplier(1, 1)).toBe(1);
  });

  it("scales down when cooking for fewer than the recipe is written for", () => {
    expect(portionsMultiplier(2, 4)).toBe(0.5);
    expect(portionsMultiplier(1, 4)).toBe(0.25);
  });

  it("scales up when cooking for more than the recipe is written for", () => {
    expect(portionsMultiplier(6, 4)).toBe(1.5);
    expect(portionsMultiplier(8, 2)).toBe(4);
  });

  it("passes the raw ratio on unrounded — rounding happens downstream", () => {
    // computeMissingIngredients / computeCookedIngredients round to 2
    // decimals on the *summed* total. Rounding the ratio here first would
    // compound (1/3 → 0.33 → 300 g becomes 99 g instead of 100 g).
    expect(portionsMultiplier(1, 3)).toBeCloseTo(1 / 3, 12);
    expect(portionsMultiplier(1, 3) * 300).toBeCloseTo(100, 9);
  });

  it("falls back to no scaling when the recipe has no usable servings count", () => {
    expect(portionsMultiplier(2, 0)).toBe(1);
    expect(portionsMultiplier(2, -4)).toBe(1);
    expect(portionsMultiplier(2, null)).toBe(1);
    expect(portionsMultiplier(2, undefined)).toBe(1);
    expect(portionsMultiplier(2, Number.NaN)).toBe(1);
    expect(portionsMultiplier(2, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("falls back to no scaling for a non-positive or non-finite portions count, never 0 or Infinity", () => {
    expect(portionsMultiplier(0, 4)).toBe(1);
    expect(portionsMultiplier(-2, 4)).toBe(1);
    expect(portionsMultiplier(Number.NaN, 4)).toBe(1);
    expect(portionsMultiplier(Number.POSITIVE_INFINITY, 4)).toBe(1);
  });

  it("scales a recipe and its sub-recipes together when fed into expandRecipeIngredients", async () => {
    // Lasagna written for 4, cooked for 2: its own pasta and the bolognese
    // it pulls in (1 batch per lasagna) both halve.
    mockRecipes([
      {
        id: "lasagna",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Pasta sheets", unit: "pcs", quantity: 12 }],
        components: [{ componentRecipeId: "bolognese", quantity: 1 }],
      },
      {
        id: "bolognese",
        ingredients: [{ inventoryItemId: null, inventoryItem: null, name: "Ground beef", unit: "g", quantity: 500 }],
        components: [],
      },
    ]);

    const result = await expandRecipeIngredients(HOUSEHOLD_ID, "lasagna", portionsMultiplier(2, 4), new Set());

    expect(result.map((r) => [r.name, r.quantity])).toEqual([
      ["Pasta sheets", 6],
      ["Ground beef", 250],
    ]);
  });
});
