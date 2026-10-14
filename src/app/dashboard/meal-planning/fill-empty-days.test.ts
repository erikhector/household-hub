import { describe, expect, it } from "vitest";
import { nextSwap, proposeDinners } from "@/app/dashboard/meal-planning/fill-empty-days";

const fav = (id: string, name = id) => ({ id, name });
const days = ["2026-01-05", "2026-01-06", "2026-01-07"];

describe("proposeDinners", () => {
  it("gives each empty day a different favorite, in name order", () => {
    const result = proposeDinners({
      emptyDays: days,
      favorites: [fav("c", "Curry"), fav("a", "Aioli"), fav("b", "Bolognese")],
      plannedRecipeIds: new Set(),
    });
    expect(result).toEqual([
      { dateKey: "2026-01-05", recipeId: "a" },
      { dateKey: "2026-01-06", recipeId: "b" },
      { dateKey: "2026-01-07", recipeId: "c" },
    ]);
  });

  it("skips favorites already planned this week", () => {
    const result = proposeDinners({
      emptyDays: days,
      favorites: [fav("a"), fav("b"), fav("c"), fav("d")],
      plannedRecipeIds: new Set(["a", "b"]),
    });
    expect(result.map((p) => p.recipeId)).toEqual(["c", "d"]);
  });

  it("proposes fewer days rather than repeating a recipe", () => {
    const result = proposeDinners({ emptyDays: days, favorites: [fav("a")], plannedRecipeIds: new Set() });
    expect(result).toEqual([{ dateKey: "2026-01-05", recipeId: "a" }]);
  });

  it("proposes nothing without favorites or without empty days", () => {
    expect(proposeDinners({ emptyDays: days, favorites: [], plannedRecipeIds: new Set() })).toEqual([]);
    expect(proposeDinners({ emptyDays: [], favorites: [fav("a")], plannedRecipeIds: new Set() })).toEqual([]);
  });
});

describe("nextSwap", () => {
  const favorites = [fav("a"), fav("b"), fav("c")];

  it("moves to the next unused favorite, wrapping around", () => {
    expect(nextSwap({ currentId: "a", favorites, usedRecipeIds: new Set(["a"]) })).toBe("b");
    expect(nextSwap({ currentId: "c", favorites, usedRecipeIds: new Set(["c"]) })).toBe("a");
  });

  it("skips favorites used elsewhere in the week", () => {
    expect(nextSwap({ currentId: "a", favorites, usedRecipeIds: new Set(["a", "b"]) })).toBe("c");
  });

  it("returns null when every other favorite is taken", () => {
    expect(nextSwap({ currentId: "a", favorites, usedRecipeIds: new Set(["a", "b", "c"]) })).toBeNull();
    expect(nextSwap({ currentId: "a", favorites: [fav("a")], usedRecipeIds: new Set(["a"]) })).toBeNull();
  });
});
