import type { Locale } from "@/lib/i18n/locales";
import type { FileRecipe } from "@/lib/recipe-import/parse-file";
import type { CatalogRecipe } from "./types";

// "pcs" is dropped from the display line ("2 egg") because the catalog
// doesn't pluralise; the parsed row still carries the real unit. Exported so
// AI-suggested recipes (src/lib/recipe-ideas/ai.ts) build the same line.
export function ingredientRawText(quantity: number, unit: string, name: string, note?: string): string {
  const line = [String(quantity), unit === "pcs" ? "" : unit, name].filter(Boolean).join(" ");
  return note ? `${line}, ${note}` : line;
}

// Reuses the import pre-fill shape so "Add to my recipes" goes through the
// same form path as a file import, with no second code path to keep in sync.
export function catalogToParsedRecipe(recipe: CatalogRecipe, locale: Locale): FileRecipe {
  return {
    name: recipe.name[locale],
    instructions: recipe.instructions[locale],
    servings: recipe.servings,
    tags: recipe.tags,
    ingredients: recipe.ingredients.map((ing) => {
      const name = ing.name[locale];
      const note = ing.note?.[locale];
      return {
        name,
        quantity: ing.quantity,
        unit: ing.unit,
        ...(note ? { note } : {}),
        rawText: ingredientRawText(ing.quantity, ing.unit, name, note),
      };
    }),
  };
}
