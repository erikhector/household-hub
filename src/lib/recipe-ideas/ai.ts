// AI recipe ideas: the pure half. Everything suggestRecipeIdeasAction
// (src/app/dashboard/meal-planning/discover-actions.ts) needs that isn't the
// network call or the session: the prompt, the answer's shape in both
// providers' dialects (the chain is src/lib/ai/provider-chain.ts, shared with
// the photo and receipt scans), a loose Zod schema, and the mapper that folds
// the answer into the FileRecipe shape the catalog preview and file import
// already use, so "Add to my recipes" goes through the same form path.
//
// Privacy: like the receipt and photo scans, this sends data to the configured
// third-party model, so the prompt carries as little as will do: pantry item
// NAMES and saved recipe NAMES only. Never quantities, prices, dates or
// anything about the people in the household.
//
// The schema is deliberately loose (an array of raw objects) and each idea is
// validated on its own in mapRecipeIdeas. A strict schema would fail the
// whole answer when one of the three ideas is malformed; this way two good
// ideas still come through.

import { z } from "zod";

import type { Locale } from "@/lib/i18n/locales";
import { ingredientRawText } from "@/lib/recipe-catalog/to-parsed";
import { normalizeForSearch } from "@/lib/recipe-catalog/rank";
import type { FileRecipe } from "@/lib/recipe-import/parse-file";
import type { ParsedIngredient } from "@/lib/recipe-import/types";
import { parseRecipeTags, type RecipeTag } from "@/lib/recipe-tags";
import { normalizeUnit, unitKind } from "@/lib/units";

const MAX_PANTRY_NAMES = 60;
const MAX_SAVED_NAMES = 50;
const NAME_MAX_LENGTH = 120;
const MAX_INGREDIENTS = 30;
const INSTRUCTIONS_MAX_LENGTH = 4000;
const DEFAULT_SERVINGS = 4;
const MAX_SERVINGS = 12;
const IDEA_COUNT = 3;

export type IdeaAnswer = Record<string, unknown>;

export const recipeIdeasSchema = z.object({
  recipes: z.array(z.record(z.string(), z.unknown())).max(10).default([]),
});

export const RECIPE_IDEAS_SYSTEM_PROMPT =
  "You are a home cook suggesting dinner ideas for a household. You get a list of what is in their pantry " +
  "(items that expire soon are marked) and optional diet preferences. Suggest exactly 3 different, realistic " +
  "recipes that use mostly what is listed, favouring the items marked as expiring soon. You may assume basic " +
  "staples (salt, pepper, oil, water) without listing them. Use metric units (g, kg, ml, dl, l, tsp, tbsp, pcs) " +
  "and plain ingredient words (e.g. 'onion', not 'finely diced yellow onion'; put preparation in the ingredient's " +
  "note). Write every field in the language the user asks for. Give each recipe a servings count, its " +
  "ingredients with a numeric quantity and a unit, and the method as one entry per step, in order, without step " +
  "numbers. Do not repeat any recipe from the user's list of recipes they already have.";

const INGREDIENT_PROPS_DESCRIPTION = {
  name: "The ingredient, in plain words.",
  quantity: "A number greater than zero.",
  unit: "A metric unit such as g, kg, ml, dl, l, tsp, tbsp, or pcs for countable things.",
  note: "Optional preparation note, e.g. 'finely chopped'.",
};

export const RECIPE_IDEAS_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    recipes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "The recipe's title." },
          servings: { type: "NUMBER", description: "How many portions it makes." },
          ingredients: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: INGREDIENT_PROPS_DESCRIPTION.name },
                quantity: { type: "NUMBER", description: INGREDIENT_PROPS_DESCRIPTION.quantity },
                unit: { type: "STRING", description: INGREDIENT_PROPS_DESCRIPTION.unit },
                note: { type: "STRING", description: INGREDIENT_PROPS_DESCRIPTION.note },
              },
              required: ["name", "quantity", "unit"],
            },
          },
          instructions: {
            type: "ARRAY",
            items: { type: "STRING", description: "One method step, in order, without its number." },
          },
          tags: {
            type: "ARRAY",
            items: { type: "STRING", description: "A diet tag such as vegan or vegetarian, if it applies." },
          },
        },
        required: ["name", "servings", "ingredients", "instructions"],
      },
    },
  },
  required: ["recipes"],
};

export const RECIPE_IDEAS_TOOL = {
  name: "suggest_recipes",
  description: "Report exactly 3 recipe ideas that use what is in the household's pantry.",
  input_schema: {
    type: "object" as const,
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The recipe's title." },
            servings: { type: "number", description: "How many portions it makes." },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: INGREDIENT_PROPS_DESCRIPTION.name },
                  quantity: { type: "number", description: INGREDIENT_PROPS_DESCRIPTION.quantity },
                  unit: { type: "string", description: INGREDIENT_PROPS_DESCRIPTION.unit },
                  note: { type: "string", description: INGREDIENT_PROPS_DESCRIPTION.note },
                },
                required: ["name", "quantity", "unit"],
              },
            },
            instructions: {
              type: "array",
              items: { type: "string", description: "One method step, in order, without its number." },
            },
            tags: {
              type: "array",
              items: { type: "string", description: "A diet tag such as vegan or vegetarian, if it applies." },
            },
          },
          required: ["name", "servings", "ingredients", "instructions"],
        },
      },
    },
    required: ["recipes"],
  },
};

const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", sv: "Swedish" };

/** Names only (see the file header). Expiring items come first so the cap
 * never cuts the ones the household most wants to use up. */
export function recipeIdeasUserText(input: {
  pantry: { name: string; expiring: boolean }[];
  tags: RecipeTag[];
  locale: Locale;
  savedNames: string[];
}): string {
  const ordered = [...input.pantry.filter((p) => p.expiring), ...input.pantry.filter((p) => !p.expiring)]
    .slice(0, MAX_PANTRY_NAMES);
  const expiring = ordered.filter((p) => p.expiring).map((p) => p.name);
  const rest = ordered.filter((p) => !p.expiring).map((p) => p.name);
  const lines = [
    `Suggest exactly ${IDEA_COUNT} recipes. Write them in ${LANGUAGE_NAMES[input.locale]}, using metric units.`,
  ];
  if (expiring.length > 0) lines.push(`Expiring soon (use these first): ${expiring.join(", ")}`);
  lines.push(`In the pantry: ${rest.length > 0 ? rest.join(", ") : "(nothing listed)"}`);
  if (input.tags.length > 0) lines.push(`Diet: every recipe must be ${input.tags.join(" and ")}.`);
  const saved = input.savedNames.slice(0, MAX_SAVED_NAMES);
  if (saved.length > 0) lines.push(`Recipes they already have (don't repeat these): ${saved.join(", ")}`);
  return lines.join("\n");
}

const ideaSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  servings: z.number().optional().catch(undefined),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
        quantity: z.number().positive().finite(),
        unit: z.string().trim().catch(""),
        note: z.string().trim().max(200).optional().catch(undefined),
      }),
    )
    .min(1)
    .max(MAX_INGREDIENTS),
  // A single string is accepted too; the schemas ask for an array.
  instructions: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v.map((s) => s.trim()).filter(Boolean).join("\n") : v.trim()))
    .pipe(z.string().max(INSTRUCTIONS_MAX_LENGTH)),
  tags: z.array(z.unknown()).catch([]),
});

function clampServings(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return DEFAULT_SERVINGS;
  return Math.min(MAX_SERVINGS, Math.round(value));
}

export function mapRecipeIdeas(answer: { recipes: IdeaAnswer[] }, savedNames: string[]): FileRecipe[] {
  const saved = new Set(savedNames.map(normalizeForSearch));
  const out: FileRecipe[] = [];
  for (const raw of answer.recipes) {
    const parsed = ideaSchema.safeParse(raw);
    if (!parsed.success) continue;
    const idea = parsed.data;
    // Models happily re-suggest what the household already saved, despite the
    // prompt; discovery hides saved recipes everywhere else too.
    if (saved.has(normalizeForSearch(idea.name))) continue;
    const ingredients: ParsedIngredient[] = idea.ingredients.map((ing) => {
      const normalized = normalizeUnit(ing.unit);
      const unit = unitKind(normalized) === null ? "pcs" : normalized;
      return {
        name: ing.name,
        quantity: ing.quantity,
        unit,
        ...(ing.note ? { note: ing.note } : {}),
        rawText: ingredientRawText(ing.quantity, unit, ing.name, ing.note),
      };
    });
    out.push({
      name: idea.name,
      instructions: idea.instructions,
      servings: clampServings(idea.servings),
      tags: parseRecipeTags(idea.tags),
      ingredients,
    });
  }
  return out;
}
