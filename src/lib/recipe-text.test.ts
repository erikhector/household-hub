import { describe, expect, it } from "vitest";
import { formatRecipeText } from "@/lib/recipe-text";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { format, plural } from "@/lib/i18n/format";

const enLabels = (servings: number) => ({
  servings: format(plural(servings, en.mealPlanning.servingsCount), { count: servings }),
  ingredients: en.mealPlanning.ingredientsLabel,
  instructions: en.mealPlanning.instructionsLabel,
});
const svLabels = (servings: number) => ({
  servings: format(plural(servings, sv.mealPlanning.servingsCount), { count: servings }),
  ingredients: sv.mealPlanning.ingredientsLabel,
  instructions: sv.mealPlanning.instructionsLabel,
});

describe("formatRecipeText", () => {
  it("lists name, servings, ingredients and numbered steps", () => {
    const text = formatRecipeText(
      {
        name: "Pancakes",
        instructions: "Whisk the batter\n\nFry the pancakes\n",
        ingredients: [
          { name: "Wheat flour", quantity: 3, unit: "dl", note: null },
          { name: "Milk", quantity: 0.5, unit: "l", note: "cold" },
        ],
      },
      enLabels(4),
      "en",
    );
    expect(text).toBe(
      [
        "Pancakes",
        "4 servings",
        "",
        en.mealPlanning.ingredientsLabel,
        "- 3 dl Wheat flour",
        "- 0.5 l Milk (cold)",
        "",
        en.mealPlanning.instructionsLabel,
        "1. Whisk the batter",
        "2. Fry the pancakes",
      ].join("\n"),
    );
  });

  it("prints an ingredient without a quantity as just its name", () => {
    const text = formatRecipeText(
      {
        name: "Soup",
        instructions: null,
        ingredients: [
          { name: "Salt", quantity: 0, unit: "", note: null },
          { name: "Pepper", quantity: 0, unit: "g", note: "ground" },
        ],
      },
      enLabels(1),
      "en",
    );
    expect(text).toContain("- Salt\n- Pepper (ground)");
  });

  it("leaves out the instructions section when there are none", () => {
    const text = formatRecipeText(
      { name: "Toast", instructions: "  \n ", ingredients: [{ name: "Bread", quantity: 2, unit: "", note: null }] },
      enLabels(1),
      "en",
    );
    expect(text).not.toContain(en.mealPlanning.instructionsLabel);
    expect(text).toBe(`Toast\n1 serving\n\n${en.mealPlanning.ingredientsLabel}\n- 2 Bread`);
  });

  it("leaves out the ingredients section when there are none", () => {
    const text = formatRecipeText({ name: "Tea", instructions: "Steep", ingredients: [] }, enLabels(2), "en");
    expect(text).not.toContain(en.mealPlanning.ingredientsLabel);
    expect(text).toBe(`Tea\n2 servings\n\n${en.mealPlanning.instructionsLabel}\n1. Steep`);
  });

  it("uses the Swedish labels, decimal comma and unit labels", () => {
    const text = formatRecipeText(
      {
        name: "Pannkakor",
        instructions: "Vispa smeten",
        ingredients: [{ name: "Mjölk", quantity: 0.5, unit: "l", note: null }],
      },
      svLabels(4),
      "sv",
      (unit) => (unit === "l" ? "liter" : unit),
    );
    expect(text).toBe(
      [
        "Pannkakor",
        svLabels(4).servings,
        "",
        sv.mealPlanning.ingredientsLabel,
        "- 0,5 liter Mjölk",
        "",
        sv.mealPlanning.instructionsLabel,
        "1. Vispa smeten",
      ].join("\n"),
    );
    expect(svLabels(4).servings).not.toBe(enLabels(4).servings);
  });
});
