// Recipe import from a photo (GAP-54): the pure half. Everything
// importRecipeFromPhotoAction (src/app/dashboard/meal-planning/
// recipe-actions.ts) needs that isn't the network call or the session —
// the prompt, the answer's shape in both providers' dialects (the chain
// itself is src/lib/ai/provider-chain.ts, shared with the receipt and shelf
// scans), the Zod schema that validates it, and the fold of the model's
// answer into the same ParsedRecipe shape a URL import produces.
//
// The model is asked for the ingredient lines *as printed* ("2 dl mjölk",
// "1 1/2 cups flour") and not for pre-split quantity/unit/name. Each line
// then goes through parseIngredientLine, the same parser the URL import
// uses, so units, fractions, ranges and prep notes come out identically
// whatever the source — a vision model's own idea of "unit" would drift from
// the app's unit vocabulary.

import { z } from "zod";
import { parseIngredientLine } from "./parse-ingredient";
import type { ParsedRecipe } from "./types";

const NAME_MAX_LENGTH = 120;
const MAX_INGREDIENT_LINES = 100;
const MAX_STEPS = 100;
const LINE_MAX_LENGTH = 300;
const STEP_MAX_LENGTH = 2000;

export const recipePhotoSchema = z.object({
  // Empty when the photo isn't a recipe at all; mapPhotoRecipe then returns
  // null so the form stays untouched.
  name: z.string().trim().max(NAME_MAX_LENGTH).default(""),
  ingredients: z.array(z.string().trim().max(LINE_MAX_LENGTH)).max(MAX_INGREDIENT_LINES).default([]),
  steps: z.array(z.string().trim().max(STEP_MAX_LENGTH)).max(MAX_STEPS).default([]),
});
export type RecipePhotoAnswer = z.infer<typeof recipePhotoSchema>;

export const RECIPE_PHOTO_SYSTEM_PROMPT =
  "You are reading a photo of a recipe: a cookbook page, a recipe card, a handwritten note or a screenshot. " +
  "Report the recipe's title, its ingredient lines and its method steps. Copy each ingredient line exactly as " +
  "it is printed, quantity and unit included (e.g. '2 dl mjölk', '1 1/2 cups flour', 'salt'), one entry per " +
  "line; don't translate, convert, merge or reword them, and put a sub-heading like 'For the sauce' in no " +
  "entry. Report the method as one entry per step, in order, without the step numbers. Read only what is " +
  "actually on the page: leave out anything you can't read rather than inventing it, and never add " +
  "ingredients or steps from your own knowledge of the dish. If the photo is not a recipe, return an empty " +
  "title and empty lists.";

export const RECIPE_PHOTO_USER_TEXT = "Here's the recipe. What is its title, ingredients and method?";

export const RECIPE_PHOTO_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", description: "The recipe's title, or an empty string if the photo is not a recipe." },
    ingredients: {
      type: "ARRAY",
      items: { type: "STRING", description: "One ingredient line exactly as printed, quantity and unit included." },
    },
    steps: {
      type: "ARRAY",
      items: { type: "STRING", description: "One method step, in order, without its number." },
    },
  },
  required: ["name", "ingredients", "steps"],
};

export const RECIPE_PHOTO_TOOL = {
  name: "report_recipe",
  description: "Report the recipe shown in the photo: its title, ingredient lines and method steps.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "The recipe's title, or an empty string if the photo is not a recipe." },
      ingredients: {
        type: "array",
        items: { type: "string", description: "One ingredient line exactly as printed, quantity and unit included." },
      },
      steps: {
        type: "array",
        items: { type: "string", description: "One method step, in order, without its number." },
      },
    },
    required: ["name", "ingredients", "steps"],
  },
};

/** Folds the model's answer into the URL import's shape. Returns null when
 * there is nothing usable (no ingredients and no steps), so the caller
 * reports "couldn't read a recipe" and leaves the form alone. */
export function mapPhotoRecipe(answer: RecipePhotoAnswer): ParsedRecipe | null {
  const ingredients = answer.ingredients.filter((line) => line.length > 0).flatMap((line) => parseIngredientLine(line));
  const steps = answer.steps.filter((step) => step.length > 0);
  if (ingredients.length === 0 && steps.length === 0) return null;
  return { name: answer.name, instructions: steps.join("\n"), ingredients };
}
