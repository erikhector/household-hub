import type { Locale } from "@/lib/i18n/locales";
import type { FileRecipe } from "@/lib/recipe-import/parse-file";
import type { CatalogRecipe } from "./types";

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
      // "pcs" is dropped from the display line ("2 egg") because the catalog
      // doesn't pluralise; the parsed row still carries the real unit.
      const line = [String(ing.quantity), ing.unit === "pcs" ? "" : ing.unit, name].filter(Boolean).join(" ");
      return {
        name,
        quantity: ing.quantity,
        unit: ing.unit,
        ...(note ? { note } : {}),
        rawText: note ? `${line}, ${note}` : line,
      };
    }),
  };
}
