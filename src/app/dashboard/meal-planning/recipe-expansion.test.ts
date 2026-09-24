// See src/app/dashboard/meal-planning/cooking-actions.test.ts for the mocking
// convention this mirrors: prisma is mocked, no database is touched.
import { describe, expect, it, vi } from "vitest";

const { recipeFindManyMock } = vi.hoisted(() => ({
  recipeFindManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { recipe: { findMany: recipeFindManyMock } },
}));

const { expandRecipeIngredients } = await import("@/app/dashboard/meal-planning/recipe-expansion");

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
