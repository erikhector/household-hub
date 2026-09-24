import { describe, expect, it } from "vitest";
import {
  computeUseItUpSuggestions,
  type FlaggedInventoryItem,
  type RecipeForUseItUp,
} from "@/lib/inventory/use-it-up-calc";

function recipe(overrides: Partial<RecipeForUseItUp>): RecipeForUseItUp {
  return { recipeId: "r1", recipeName: "Recipe", ingredients: [], ...overrides };
}

describe("computeUseItUpSuggestions", () => {
  it("surfaces a recipe whose linked ingredient is expiring soon", () => {
    const flagged: FlaggedInventoryItem[] = [
      { id: "i1", name: "Chicken breast", expiryStatus: "soon", stockStatus: "in" },
    ];
    const recipes = [
      recipe({
        recipeId: "r1",
        recipeName: "Chicken stir-fry",
        ingredients: [{ name: "Chicken breast", inventoryItemId: "i1" }],
      }),
    ];

    expect(computeUseItUpSuggestions(recipes, flagged)).toEqual([
      {
        recipeId: "r1",
        recipeName: "Chicken stir-fry",
        matches: [{ name: "Chicken breast", reason: "expiring" }],
      },
    ]);
  });

  it("surfaces a recipe whose linked ingredient is low or out of stock", () => {
    const flagged: FlaggedInventoryItem[] = [
      { id: "i1", name: "Rice", expiryStatus: null, stockStatus: "low" },
      { id: "i2", name: "Soy sauce", expiryStatus: null, stockStatus: "out" },
    ];
    const recipes = [
      recipe({
        ingredients: [
          { name: "Rice", inventoryItemId: "i1" },
          { name: "Soy sauce", inventoryItemId: "i2" },
        ],
      }),
    ];

    expect(computeUseItUpSuggestions(recipes, flagged)[0].matches).toEqual([
      { name: "Rice", reason: "lowStock" },
      { name: "Soy sauce", reason: "lowStock" },
    ]);
  });

  it("falls back to a case-insensitive name match when an ingredient has no linked item", () => {
    const flagged: FlaggedInventoryItem[] = [
      { id: "i1", name: "Milk", expiryStatus: "expired", stockStatus: "in" },
    ];
    const recipes = [recipe({ ingredients: [{ name: "milk", inventoryItemId: null }] })];

    expect(computeUseItUpSuggestions(recipes, flagged)[0].matches).toEqual([
      { name: "Milk", reason: "expiring" },
    ]);
  });

  it("reports an item that is both expiring and low stock as expiring, the more urgent reason", () => {
    const flagged: FlaggedInventoryItem[] = [
      { id: "i1", name: "Eggs", expiryStatus: "soon", stockStatus: "low" },
    ];
    const recipes = [recipe({ ingredients: [{ name: "Eggs", inventoryItemId: "i1" }] })];

    expect(computeUseItUpSuggestions(recipes, flagged)[0].matches).toEqual([
      { name: "Eggs", reason: "expiring" },
    ]);
  });

  it("ignores an ingredient linked to an item that is neither expiring nor low", () => {
    const flagged: FlaggedInventoryItem[] = [
      { id: "i1", name: "Salt", expiryStatus: null, stockStatus: "in" },
    ];
    const recipes = [recipe({ ingredients: [{ name: "Salt", inventoryItemId: "i1" }] })];

    expect(computeUseItUpSuggestions(recipes, flagged)).toEqual([]);
  });

  it("excludes a recipe with no ingredients at all", () => {
    expect(computeUseItUpSuggestions([recipe({ ingredients: [] })], [])).toEqual([]);
  });

  it("deduplicates a recipe that lists the same matched item across two ingredient rows", () => {
    const flagged: FlaggedInventoryItem[] = [
      { id: "i1", name: "Flour", expiryStatus: "soon", stockStatus: "in" },
    ];
    const recipes = [
      recipe({
        ingredients: [
          { name: "Flour", inventoryItemId: "i1" },
          { name: "flour", inventoryItemId: "i1" },
        ],
      }),
    ];

    expect(computeUseItUpSuggestions(recipes, flagged)[0].matches).toHaveLength(1);
  });

  it("sorts by match count descending, then recipe name, and caps the list at 5", () => {
    const flagged: FlaggedInventoryItem[] = Array.from({ length: 8 }, (_, i) => ({
      id: `i${i}`,
      name: `Item ${i}`,
      expiryStatus: "soon" as const,
      stockStatus: "in" as const,
    }));

    const recipes = [
      recipe({ recipeId: "one", recipeName: "One match", ingredients: [{ name: "Item 0", inventoryItemId: "i0" }] }),
      recipe({
        recipeId: "two-b",
        recipeName: "Two match B",
        ingredients: [
          { name: "Item 1", inventoryItemId: "i1" },
          { name: "Item 2", inventoryItemId: "i2" },
        ],
      }),
      recipe({
        recipeId: "two-a",
        recipeName: "Two match A",
        ingredients: [
          { name: "Item 3", inventoryItemId: "i3" },
          { name: "Item 4", inventoryItemId: "i4" },
        ],
      }),
      recipe({ recipeId: "three", recipeName: "Three match", ingredients: [{ name: "Item 5", inventoryItemId: "i5" }] }),
      recipe({ recipeId: "four", recipeName: "Four match", ingredients: [{ name: "Item 6", inventoryItemId: "i6" }] }),
      recipe({ recipeId: "five", recipeName: "Five match", ingredients: [{ name: "Item 7", inventoryItemId: "i7" }] }),
    ];

    // Two-match recipes rank first (two-a before two-b, alphabetically), then
    // one-match recipes alphabetically by name ("Five match" < "Four match" <
    // "One match" < "Three match") — six candidates total, capped at 5, so
    // "Three match" is the one dropped.
    const result = computeUseItUpSuggestions(recipes, flagged);
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.recipeId)).toEqual(["two-a", "two-b", "five", "four", "one"]);
  });

  it("returns an empty list when nothing is flagged", () => {
    const recipes = [recipe({ ingredients: [{ name: "Anything", inventoryItemId: null }] })];
    expect(computeUseItUpSuggestions(recipes, [])).toEqual([]);
  });
});
