import { describe, expect, it } from "vitest";
import { orderRecipesForPicker } from "./recipe-picker-order";

const r = (id: string, isFavorite = false) => ({ id, isFavorite });

describe("orderRecipesForPicker", () => {
  it("puts favourites first, then the most recently cooked, then the rest in their own order", () => {
    const recipes = [r("a"), r("b"), r("c", true), r("d"), r("e", true), r("f")];
    const cooked = {
      d: { lastCookedAt: "2031-03-01T10:00:00.000Z" },
      b: { lastCookedAt: "2031-03-05T10:00:00.000Z" },
      e: { lastCookedAt: "2031-02-01T10:00:00.000Z" },
    };
    expect(orderRecipesForPicker(recipes, cooked).map((x) => x.id)).toEqual(["e", "c", "b", "d", "a", "f"]);
  });

  it("keeps the input order when nothing was cooked and nothing is a favourite", () => {
    expect(orderRecipesForPicker([r("x"), r("y"), r("z")], {}).map((x) => x.id)).toEqual(["x", "y", "z"]);
  });

  it("does not mutate its input", () => {
    const recipes = [r("a"), r("b", true)];
    orderRecipesForPicker(recipes, {});
    expect(recipes.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
