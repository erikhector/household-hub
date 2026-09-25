import { describe, expect, it } from "vitest";
import {
  computeUseItUpSuggestions,
  type FlaggedInventoryItem,
  type RecipeForUseItUp,
} from "@/lib/inventory/use-it-up-calc";

function recipe(overrides: Partial<RecipeForUseItUp>): RecipeForUseItUp {
  return { recipeId: "r1", recipeName: "Recipe", isFavorite: false, ingredients: [], ...overrides };
}

// Defaults to quantity 1 (comfortably "on hand") so each test only has to
// spell out the fields it's actually exercising — the quantity-gating tests
// below override it explicitly.
function item(
  overrides: Partial<FlaggedInventoryItem> & Pick<FlaggedInventoryItem, "id" | "name">,
): FlaggedInventoryItem {
  return { quantity: 1, expiryStatus: null, stockStatus: "in", ...overrides };
}

describe("computeUseItUpSuggestions", () => {
  it("surfaces a recipe whose linked ingredient is expiring soon", () => {
    const flagged = [item({ id: "i1", name: "Chicken breast", expiryStatus: "soon" })];
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

  it("surfaces a recipe whose linked ingredient is low on stock", () => {
    const flagged = [
      item({ id: "i1", name: "Rice", stockStatus: "low" }),
      item({ id: "i2", name: "Soy sauce", stockStatus: "low" }),
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
    const flagged = [item({ id: "i1", name: "Milk", expiryStatus: "expired" })];
    const recipes = [recipe({ ingredients: [{ name: "milk", inventoryItemId: null }] })];

    expect(computeUseItUpSuggestions(recipes, flagged)[0].matches).toEqual([
      { name: "Milk", reason: "expiring" },
    ]);
  });

  it("reports an item that is both expiring and low stock as expiring, the more urgent reason", () => {
    const flagged = [item({ id: "i1", name: "Eggs", expiryStatus: "soon", stockStatus: "low" })];
    const recipes = [recipe({ ingredients: [{ name: "Eggs", inventoryItemId: "i1" }] })];

    expect(computeUseItUpSuggestions(recipes, flagged)[0].matches).toEqual([
      { name: "Eggs", reason: "expiring" },
    ]);
  });

  it("ignores an ingredient linked to an item that is neither expiring nor low", () => {
    const flagged = [item({ id: "i1", name: "Salt" })];
    const recipes = [recipe({ ingredients: [{ name: "Salt", inventoryItemId: "i1" }] })];

    expect(computeUseItUpSuggestions(recipes, flagged)).toEqual([]);
  });

  // Regression test for a review finding on PR #24: every ingredient
  // auto-created via parseIngredientRows/addMissingIngredientsToShoppingListAction
  // starts at quantity 0 (lowStockThreshold 0), which makes it "out" from the
  // moment it's created — but you can't "use up" something you already have
  // none of. Without this gate, almost any recipe with a freshly-added
  // ingredient would misleadingly surface here.
  it("excludes an expiring item that is at zero quantity", () => {
    const flagged = [item({ id: "i1", name: "Cream", quantity: 0, expiryStatus: "expired" })];
    const recipes = [recipe({ ingredients: [{ name: "Cream", inventoryItemId: "i1" }] })];

    expect(computeUseItUpSuggestions(recipes, flagged)).toEqual([]);
  });

  it("excludes a low/out-of-stock item that is at zero quantity", () => {
    const flagged = [
      item({ id: "i1", name: "Flour", quantity: 0, stockStatus: "out" }),
      item({ id: "i2", name: "Sugar", quantity: 0, stockStatus: "low" }),
    ];
    const recipes = [
      recipe({
        ingredients: [
          { name: "Flour", inventoryItemId: "i1" },
          { name: "Sugar", inventoryItemId: "i2" },
        ],
      }),
    ];

    expect(computeUseItUpSuggestions(recipes, flagged)).toEqual([]);
  });

  it("excludes a recipe with no ingredients at all", () => {
    expect(computeUseItUpSuggestions([recipe({ ingredients: [] })], [])).toEqual([]);
  });

  it("deduplicates a recipe that lists the same matched item across two ingredient rows", () => {
    const flagged = [item({ id: "i1", name: "Flour", expiryStatus: "soon" })];
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

  it("ranks an expiring-reason suggestion ahead of an equally-sized low-stock-only one", () => {
    const flagged = [
      item({ id: "i1", name: "Butter", stockStatus: "low" }),
      item({ id: "i2", name: "Cream", expiryStatus: "soon" }),
    ];
    const recipes = [
      recipe({ recipeId: "low-stock", recipeName: "Aaa low stock", ingredients: [{ name: "Butter", inventoryItemId: "i1" }] }),
      recipe({ recipeId: "expiring", recipeName: "Zzz expiring", ingredients: [{ name: "Cream", inventoryItemId: "i2" }] }),
    ];

    // Both recipes have exactly one match, and "Aaa low stock" would sort
    // first alphabetically — but the expiring reason takes priority on a
    // tie (see computeUseItUpSuggestions' sort comment), so it comes first
    // despite the name order.
    const result = computeUseItUpSuggestions(recipes, flagged);
    expect(result.map((r) => r.recipeId)).toEqual(["expiring", "low-stock"]);
  });

  it("ranks a favorite ahead of an otherwise-tied non-favorite (GAP-18)", () => {
    const flagged = [
      item({ id: "i1", name: "Cream", expiryStatus: "soon" }),
      item({ id: "i2", name: "Milk", expiryStatus: "soon" }),
    ];
    const recipes = [
      recipe({ recipeId: "plain", recipeName: "Aaa plain", ingredients: [{ name: "Cream", inventoryItemId: "i1" }] }),
      recipe({
        recipeId: "starred",
        recipeName: "Zzz starred",
        isFavorite: true,
        ingredients: [{ name: "Milk", inventoryItemId: "i2" }],
      }),
    ];

    // Same match count, both expiring — only the star separates them, and
    // it beats the alphabetical order.
    const result = computeUseItUpSuggestions(recipes, flagged);
    expect(result.map((r) => r.recipeId)).toEqual(["starred", "plain"]);
  });

  it("never lets a favorite outrank a suggestion with more matches or a more urgent reason", () => {
    const flagged = [
      item({ id: "i1", name: "Butter", stockStatus: "low" }),
      item({ id: "i2", name: "Cream", expiryStatus: "soon" }),
      item({ id: "i3", name: "Eggs", expiryStatus: "soon" }),
    ];
    const recipes = [
      recipe({
        recipeId: "starred-low-stock",
        recipeName: "Aaa starred",
        isFavorite: true,
        ingredients: [{ name: "Butter", inventoryItemId: "i1" }],
      }),
      recipe({ recipeId: "expiring", recipeName: "Mmm expiring", ingredients: [{ name: "Cream", inventoryItemId: "i2" }] }),
      recipe({
        recipeId: "two-matches",
        recipeName: "Zzz two",
        ingredients: [
          { name: "Cream", inventoryItemId: "i2" },
          { name: "Eggs", inventoryItemId: "i3" },
        ],
      }),
    ];

    // A tiebreaker, not a filter or a boost: the favorite is still listed,
    // just after both recipes that would prevent more waste.
    const result = computeUseItUpSuggestions(recipes, flagged);
    expect(result.map((r) => r.recipeId)).toEqual(["two-matches", "expiring", "starred-low-stock"]);
  });

  it("sorts by match count descending, then recipe name, and caps the list at 5", () => {
    const flagged: FlaggedInventoryItem[] = Array.from({ length: 8 }, (_, i) =>
      item({ id: `i${i}`, name: `Item ${i}`, expiryStatus: "soon" }),
    );

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
