import { describe, expect, it } from "vitest";
import { mapPhotoRecipe, recipePhotoSchema } from "./photo";
import { parseIngredientLine } from "./parse-ingredient";

describe("recipePhotoSchema", () => {
  it("trims, and defaults missing fields to empty", () => {
    expect(recipePhotoSchema.parse({ name: "  Pannkakor " })).toEqual({ name: "Pannkakor", ingredients: [], steps: [] });
  });

  it("rejects a non-array ingredient list", () => {
    expect(recipePhotoSchema.safeParse({ name: "x", ingredients: "2 dl mjölk", steps: [] }).success).toBe(false);
  });
});

describe("mapPhotoRecipe", () => {
  it("runs each printed line through the URL import's ingredient parser", () => {
    const recipe = mapPhotoRecipe({
      name: "Pannkakor",
      ingredients: ["2 dl vetemjöl", "1 1/2 cups milk", "salt och peppar"],
      steps: ["Vispa ihop smeten.", "Stek i smör."],
    });
    expect(recipe).not.toBeNull();
    expect(recipe!.name).toBe("Pannkakor");
    expect(recipe!.instructions).toBe("Vispa ihop smeten.\nStek i smör.");
    expect(recipe!.ingredients).toEqual(
      ["2 dl vetemjöl", "1 1/2 cups milk", "salt och peppar"].flatMap((line) => parseIngredientLine(line)),
    );
    // salt och peppar splits in two, as on a URL import.
    expect(recipe!.ingredients).toHaveLength(4);
    expect(recipe!.ingredients[0]).toMatchObject({ quantity: 2, unit: "dl", name: "vetemjöl" });
  });

  it("skips blank lines and steps", () => {
    const recipe = mapPhotoRecipe({ name: "", ingredients: ["", "2 ägg"], steps: ["", "Koka."] });
    expect(recipe!.ingredients).toHaveLength(1);
    expect(recipe!.instructions).toBe("Koka.");
  });

  it("returns null when the photo yielded no ingredients and no steps", () => {
    expect(mapPhotoRecipe({ name: "Just a title", ingredients: [], steps: [] })).toBeNull();
    expect(mapPhotoRecipe({ name: "", ingredients: [" "].map((s) => s.trim()), steps: [] })).toBeNull();
  });
});
