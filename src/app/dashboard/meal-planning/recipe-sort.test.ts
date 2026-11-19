import { describe, expect, it } from "vitest";
import { isRecipeSort, sortRecipes } from "./recipe-sort";

const r = (id: string, name: string, createdAt = "2026-01-01T00:00:00.000Z") => ({ id, name, createdAt });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe("sortRecipes", () => {
  const recipes = [
    r("a", "Apple pie", "2026-03-01T00:00:00.000Z"),
    r("b", "Burrito", "2026-05-01T00:00:00.000Z"),
    r("c", "Curry", "2026-04-01T00:00:00.000Z"),
    r("d", "Dal", "2026-02-01T00:00:00.000Z"),
  ];
  const cooked = {
    b: { count: 2, lastCookedAt: "2026-10-01T18:00:00.000Z" },
    c: { count: 5, lastCookedAt: "2026-09-01T18:00:00.000Z" },
  };

  it("keeps the incoming A–Z order for name", () => {
    expect(sortRecipes(recipes, "name", cooked)).toBe(recipes);
  });

  it("puts never-cooked recipes first, then the longest since cooked", () => {
    expect(ids(sortRecipes(recipes, "lastCooked", cooked))).toEqual(["a", "d", "c", "b"]);
  });

  it("orders by cooked count, never cooked counting as zero", () => {
    expect(ids(sortRecipes(recipes, "mostCooked", cooked))).toEqual(["c", "b", "a", "d"]);
  });

  it("orders newest created first", () => {
    expect(ids(sortRecipes(recipes, "newest", cooked))).toEqual(["b", "c", "a", "d"]);
  });

  it("breaks ties by name whatever the input order", () => {
    const tied = [r("z", "Zucchini"), r("m", "Moussaka"), r("a", "Aubergine")];
    const same = { z: { count: 1, lastCookedAt: "2026-10-01T18:00:00.000Z" }, a: { count: 1, lastCookedAt: "2026-10-01T18:00:00.000Z" } };
    expect(ids(sortRecipes(tied, "mostCooked", same))).toEqual(["a", "z", "m"]);
    expect(ids(sortRecipes(tied, "lastCooked", same))).toEqual(["m", "a", "z"]);
    expect(ids(sortRecipes(tied, "newest", {}))).toEqual(["a", "m", "z"]);
  });

  it("doesn't mutate the input", () => {
    const input = [...recipes];
    sortRecipes(input, "mostCooked", cooked);
    expect(ids(input)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("isRecipeSort", () => {
  it("accepts only known sorts", () => {
    expect(isRecipeSort("mostCooked")).toBe(true);
    expect(isRecipeSort("__all__")).toBe(false);
  });
});
