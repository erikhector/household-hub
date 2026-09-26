import { afterEach, describe, expect, it, vi } from "vitest";
import { computeCookableRecipes } from "./cookable-recipes";
import type { IngredientNeed } from "./missing-ingredients";

// getCookableRecipes is the DB-touching half (see cookable-recipes.ts) —
// mocked the same way recipe-expansion.test.ts mocks @/lib/prisma, since it
// goes through the same loadRecipeGraph query plus a loose-match
// inventoryItem.findMany.
const { recipeFindManyMock, inventoryItemFindManyMock } = vi.hoisted(() => ({
  recipeFindManyMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findMany: recipeFindManyMock },
    inventoryItem: { findMany: inventoryItemFindManyMock },
  },
}));
const { getCookableRecipes } = await import("./cookable-recipes");

afterEach(() => {
  vi.clearAllMocks();
});

describe("computeCookableRecipes", () => {
  it("surfaces a recipe with everything on hand as fully ready", () => {
    const needs: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 2, onHandQuantity: 12, onHandUnit: "pcs" },
    ];

    expect(computeCookableRecipes([{ recipeId: "r1", recipeName: "Omelette", isFavorite: false, needs }])).toEqual([
      { recipeId: "r1", recipeName: "Omelette", missingIngredientNames: [], isFavorite: false },
    ]);
  });

  it("excludes a recipe missing more than the surfaced limit of 2 ingredients", () => {
    const needs: IngredientNeed[] = [
      { key: "a", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "b", name: "Sugar", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
      { key: "c", name: "Butter", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    expect(computeCookableRecipes([{ recipeId: "r1", recipeName: "Cake", isFavorite: false, needs }])).toEqual([]);
  });

  it("includes a recipe missing exactly 2 ingredients", () => {
    const needs: IngredientNeed[] = [
      { key: "a", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "b", name: "Sugar", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    const result = computeCookableRecipes([{ recipeId: "r1", recipeName: "Cake", isFavorite: false, needs }]);
    expect(result).toHaveLength(1);
    expect(result[0].missingIngredientNames).toEqual(["Flour", "Sugar"]);
  });

  it("excludes a recipe with no ingredients instead of treating it as trivially ready", () => {
    expect(computeCookableRecipes([{ recipeId: "r1", recipeName: "Mystery", isFavorite: false, needs: [] }])).toEqual([]);
  });

  it("sorts fully-stocked recipes before ones missing ingredients, then by missing count, then name", () => {
    const ready: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 2, onHandQuantity: 12, onHandUnit: "pcs" },
    ];
    const missingOne: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
    ];
    const missingTwo: IngredientNeed[] = [
      { key: "sugar", name: "Sugar", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
      { key: "butter", name: "Butter", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    const result = computeCookableRecipes([
      { recipeId: "r3", recipeName: "Cake", isFavorite: false, needs: missingTwo },
      { recipeId: "r2", recipeName: "Pancakes", isFavorite: false, needs: missingOne },
      { recipeId: "r1", recipeName: "Zzz Omelette", isFavorite: false, needs: ready },
      { recipeId: "r4", recipeName: "Aaa Omelette", isFavorite: false, needs: ready },
    ]);

    expect(result.map((r) => r.recipeName)).toEqual(["Aaa Omelette", "Zzz Omelette", "Pancakes", "Cake"]);
  });

  it("puts favorites first among recipes with the same missing count (GAP-18)", () => {
    const ready: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 2, onHandQuantity: 12, onHandUnit: "pcs" },
    ];

    const result = computeCookableRecipes([
      { recipeId: "r1", recipeName: "Aaa Omelette", isFavorite: false, needs: ready },
      { recipeId: "r2", recipeName: "Zzz Frittata", isFavorite: true, needs: ready },
      { recipeId: "r3", recipeName: "Mmm Scramble", isFavorite: false, needs: ready },
    ]);

    // The star beats alphabetical order; the non-favorites keep theirs.
    expect(result.map((r) => r.recipeName)).toEqual(["Zzz Frittata", "Aaa Omelette", "Mmm Scramble"]);
  });

  it("treats favorites as a tiebreaker, never ahead of a recipe missing fewer ingredients", () => {
    const ready: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 2, onHandQuantity: 12, onHandUnit: "pcs" },
    ];
    const missingOne: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
    ];
    const missingThree: IngredientNeed[] = [
      { key: "a", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "b", name: "Sugar", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
      { key: "c", name: "Butter", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    const result = computeCookableRecipes([
      { recipeId: "r1", recipeName: "Starred pancakes", isFavorite: true, needs: missingOne },
      { recipeId: "r2", recipeName: "Plain omelette", isFavorite: false, needs: ready },
      // Not a filter bypass either: a favorite missing too much still drops out.
      { recipeId: "r3", recipeName: "Starred cake", isFavorite: true, needs: missingThree },
    ]);

    expect(result.map((r) => r.recipeName)).toEqual(["Plain omelette", "Starred pancakes"]);
  });

  it("returns an empty list for no recipes", () => {
    expect(computeCookableRecipes([])).toEqual([]);
  });
});

describe("getCookableRecipes", () => {
  const HOUSEHOLD_ID = "household-1";

  it("fetches the household's recipe graph once for N recipes, not once per recipe (PERF-1)", async () => {
    // Before PERF-1 this called expandRecipeIngredients per recipe, and so
    // re-ran recipe.findMany once per recipe too. Three recipes here — one
    // ready to cook, one using a sub-recipe, one missing everything — must
    // all be resolved off a single fetch of the graph.
    recipeFindManyMock.mockResolvedValue([
      {
        id: "omelette",
        ingredients: [
          { inventoryItemId: "inv-eggs", inventoryItem: { name: "Eggs", quantity: 12, unit: "pcs" }, name: "Eggs", unit: "pcs", quantity: 2 },
        ],
        components: [],
      },
      {
        id: "lasagna",
        ingredients: [
          { inventoryItemId: null, inventoryItem: null, name: "Pasta sheets", unit: "pcs", quantity: 12 },
        ],
        components: [{ componentRecipeId: "bolognese", quantity: 1 }],
      },
      {
        id: "bolognese",
        ingredients: [
          { inventoryItemId: null, inventoryItem: null, name: "Ground beef", unit: "kg", quantity: 0.5 },
        ],
        components: [],
      },
      {
        id: "cake",
        ingredients: [
          { inventoryItemId: null, inventoryItem: null, name: "Flour", unit: "cups", quantity: 2 },
          { inventoryItemId: null, inventoryItem: null, name: "Sugar", unit: "cups", quantity: 1 },
          { inventoryItemId: null, inventoryItem: null, name: "Butter", unit: "cups", quantity: 1 },
        ],
        components: [],
      },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);

    const result = await getCookableRecipes(HOUSEHOLD_ID, [
      { id: "omelette", name: "Omelette", isFavorite: false },
      { id: "lasagna", name: "Lasagna", isFavorite: false },
      { id: "cake", name: "Cake", isFavorite: false },
    ]);

    expect(recipeFindManyMock).toHaveBeenCalledTimes(1);
    expect(recipeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: HOUSEHOLD_ID } }),
    );
    // Omelette has everything on hand; lasagna is missing its (unlinked)
    // pasta sheets and ground beef — exactly at the surfaced limit; cake is
    // missing 3 ingredients, past the limit, so it's excluded entirely.
    expect(result).toEqual([
      { recipeId: "omelette", recipeName: "Omelette", missingIngredientNames: [], isFavorite: false },
      {
        recipeId: "lasagna",
        recipeName: "Lasagna",
        missingIngredientNames: ["Ground beef", "Pasta sheets"],
        isFavorite: false,
      },
    ]);
  });

  it("returns an empty list for no recipes without touching the database", async () => {
    const result = await getCookableRecipes(HOUSEHOLD_ID, []);

    expect(result).toEqual([]);
    // Still fetches the graph once (loadRecipeGraph doesn't special-case an
    // empty recipe list), but never falls into the loose-match lookup.
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
  });
});
