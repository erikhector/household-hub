import type { RecipeTag } from "@/lib/recipe-tags";

// `note` is the preparation text split off the name ("finhackad", "gärna
// lätt", a "2–3" range); `rawText` is the line exactly as the site wrote it
// (whitespace collapsed). Both are optional so hand-built rows stay valid.
export type ParsedIngredient = { name: string; quantity: number; unit: string; note?: string; rawText?: string };
export type ParsedRecipe = {
  name: string;
  instructions: string;
  ingredients: ParsedIngredient[];
};

/**
 * Which extraction tier produced an import. Anything other than "jsonld" is
 * best-effort and shown with a "review before saving" notice.
 */
export type RecipeImportSource = "jsonld" | "microdata" | "heuristic";
// `tags` (GAP-29) only ever comes from the JSON-LD tier's
// `suitableForDiet` — it's the site's own structured claim, mapped through
// the closed set in recipe-tags.ts. The Microdata and heading-heuristic
// tiers are already guesses, so they never guess a diet on top and always
// return [].
export type ImportedRecipe = ParsedRecipe & { source: RecipeImportSource; tags: RecipeTag[] };
