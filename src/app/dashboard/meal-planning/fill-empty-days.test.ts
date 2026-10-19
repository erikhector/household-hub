import { describe, expect, it } from "vitest";
import { nextSwap, proposeDinners } from "@/app/dashboard/meal-planning/fill-empty-days";

const fav = (id: string, name = id) => ({ id, name, isFavorite: true });
const other = (id: string, name = id) => ({ id, name, isFavorite: false });
const days = ["2026-01-05", "2026-01-06", "2026-01-07"];

describe("proposeDinners", () => {
  it("gives each empty day a different favorite, in name order", () => {
    const result = proposeDinners({
      emptyDays: days,
      recipes: [fav("c", "Curry"), fav("a", "Aioli"), fav("b", "Bolognese")],
      plannedRecipeIds: new Set(),
    });
    expect(result).toEqual([
      { dateKey: "2026-01-05", recipeId: "a" },
      { dateKey: "2026-01-06", recipeId: "b" },
      { dateKey: "2026-01-07", recipeId: "c" },
    ]);
  });

  it("skips recipes already planned this week", () => {
    const result = proposeDinners({
      emptyDays: days,
      recipes: [fav("a"), fav("b"), fav("c"), fav("d")],
      plannedRecipeIds: new Set(["a", "b"]),
    });
    expect(result.map((p) => p.recipeId)).toEqual(["c", "d"]);
  });

  it("uses favorites first and then other recipes once favorites run out", () => {
    const result = proposeDinners({
      emptyDays: days,
      recipes: [other("a", "Aioli"), fav("z", "Zucchini bake"), other("b", "Bolognese"), other("c", "Curry")],
      plannedRecipeIds: new Set(),
    });
    expect(result.map((p) => p.recipeId)).toEqual(["z", "a", "b"]);
  });

  it("works for a household with no favorites at all", () => {
    const result = proposeDinners({ emptyDays: days, recipes: [other("b"), other("a")], plannedRecipeIds: new Set() });
    expect(result.map((p) => p.recipeId)).toEqual(["a", "b"]);
  });

  it("proposes fewer days rather than repeating a recipe", () => {
    const result = proposeDinners({ emptyDays: days, recipes: [fav("a")], plannedRecipeIds: new Set() });
    expect(result).toEqual([{ dateKey: "2026-01-05", recipeId: "a" }]);
  });

  it("proposes nothing without recipes or without empty days", () => {
    expect(proposeDinners({ emptyDays: days, recipes: [], plannedRecipeIds: new Set() })).toEqual([]);
    expect(proposeDinners({ emptyDays: [], recipes: [fav("a")], plannedRecipeIds: new Set() })).toEqual([]);
  });
});

describe("nextSwap", () => {
  const recipes = [fav("a"), fav("b"), fav("c")];

  it("moves to the next unused recipe, wrapping around", () => {
    expect(nextSwap({ currentId: "a", recipes, usedRecipeIds: new Set(["a"]) })).toBe("b");
    expect(nextSwap({ currentId: "c", recipes, usedRecipeIds: new Set(["c"]) })).toBe("a");
  });

  it("skips recipes used elsewhere in the week", () => {
    expect(nextSwap({ currentId: "a", recipes, usedRecipeIds: new Set(["a", "b"]) })).toBe("c");
  });

  it("walks from favorites into other recipes", () => {
    const mixed = [fav("a"), other("b"), other("c")];
    expect(nextSwap({ currentId: "a", recipes: mixed, usedRecipeIds: new Set(["a"]) })).toBe("b");
  });

  it("returns null when every other recipe is taken", () => {
    expect(nextSwap({ currentId: "a", recipes, usedRecipeIds: new Set(["a", "b", "c"]) })).toBeNull();
    expect(nextSwap({ currentId: "a", recipes: [fav("a")], usedRecipeIds: new Set(["a"]) })).toBeNull();
  });
});
