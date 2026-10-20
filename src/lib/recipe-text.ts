// GAP-43 — pure formatter for the "Copy as text" action on a recipe
// (src/components/meal-planning/recipe-manager.tsx). Plain text so it pastes
// into a message or note anywhere; nothing is shared through the app.

import { formatCookQuantity, splitSteps } from "@/lib/cook-mode-calc";

export type RecipeTextLabels = {
  // Already formatted for the recipe's servings, e.g. "4 portions" / "4 portioner".
  servings: string;
  ingredients: string;
  instructions: string;
};

export type RecipeTextInput = {
  name: string;
  instructions: string | null;
  ingredients: { name: string; quantity: number; unit: string; note: string | null }[];
};

/**
 * Name, servings, ingredients, then numbered steps, in that order. An
 * ingredient with no amount (quantity 0, e.g. "salt") is just its name; a
 * section with nothing in it (no ingredients, no instructions) is left out
 * rather than printed as an empty heading. Amounts use the same locale-aware
 * rounding as the Cook view; `unitLabel` maps a stored unit to its display
 * label.
 */
export function formatRecipeText(
  recipe: RecipeTextInput,
  labels: RecipeTextLabels,
  locale: string,
  unitLabel: (unit: string) => string = (unit) => unit,
): string {
  const sections: string[] = [`${recipe.name}\n${labels.servings}`];

  if (recipe.ingredients.length > 0) {
    const lines = recipe.ingredients.map((ingredient) => {
      const amount =
        ingredient.quantity > 0
          ? `${formatCookQuantity(ingredient.quantity, 1, locale)}${ingredient.unit ? ` ${unitLabel(ingredient.unit)}` : ""} `
          : "";
      const note = ingredient.note ? ` (${ingredient.note})` : "";
      return `- ${amount}${ingredient.name}${note}`;
    });
    sections.push(`${labels.ingredients}\n${lines.join("\n")}`);
  }

  const steps = splitSteps(recipe.instructions);
  if (steps.length > 0) {
    sections.push(`${labels.instructions}\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`);
  }

  return sections.join("\n\n");
}
