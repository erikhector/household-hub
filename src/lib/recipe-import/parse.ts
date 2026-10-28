import { stripNonContent } from "./html";
import { parseHeuristicRecipe } from "./parse-heuristic";
import { parseJsonLdRecipe } from "./parse-jsonld";
import { parseMicrodataRecipe } from "./parse-microdata";
import type { ImportedRecipe, ParsedIngredient } from "./types";

/**
 * End-to-end pure parse: raw page HTML -> an ImportedRecipe, or null if
 * nothing recipe-shaped could be found. Tries JSON-LD, then Microdata, then
 * the heading heuristic (see the header comment), stopping at the first
 * tier that yields something usable.
 */
export function parseRecipeFromHtml(html: string): ImportedRecipe | null {
  const recipe = extractRecipe(html);
  return recipe ? { ...recipe, ingredients: recipe.ingredients.map(toFormRow) } : null;
}

function extractRecipe(html: string): ImportedRecipe | null {
  const jsonLd = parseJsonLdRecipe(html);
  if (jsonLd) return { ...jsonLd, source: "jsonld" };

  // Everything below reads visible markup, so drop scripts/styles/comments
  // first — otherwise a `<ul>` inside an inline template string or a
  // commented-out block could be mistaken for the ingredient list.
  const content = stripNonContent(html);

  const microdata = parseMicrodataRecipe(content);
  if (microdata) return { ...microdata, source: "microdata", tags: [] };

  const heuristic = parseHeuristicRecipe(content);
  if (heuristic) return { ...heuristic, source: "heuristic", tags: [] };

  return null;
}

// The form row keeps the prep note in its own field (RecipeIngredient.note,
// MATCH-2), so it's passed straight through. Quantities are rounded to two
// decimals here: "⅓ dl" parses to 0.3333333333333333, which the form's
// number field shows cut off. The parsed rows keep the exact value.
function toFormRow(row: ParsedIngredient): ParsedIngredient {
  return { ...row, quantity: Math.round(row.quantity * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Fallback tiers: shared HTML-string helpers
