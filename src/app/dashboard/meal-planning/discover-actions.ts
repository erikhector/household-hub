"use server";

// Server Actions behind recipe discovery: search the built-in catalog ranked
// by the household's pantry, and fetch one catalog recipe for preview.
//
// Input validation is hand-written rather than zod: this module's exported
// types are imported by client components, and PERF-7 keeps zod out of client
// bundles.

import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { RECIPE_CATALOG } from "@/lib/recipe-catalog/data";
import { loadDiscoverContext } from "@/lib/recipe-catalog/pantry";
import { ingredientHaves, rankCatalogRecipes, type CatalogResult } from "@/lib/recipe-catalog/rank";
import { catalogToParsedRecipe } from "@/lib/recipe-catalog/to-parsed";
import type { FileRecipe } from "@/lib/recipe-import/parse-file";
import { parseRecipeTags } from "@/lib/recipe-tags";
import { requireHousehold } from "@/lib/session";

const MAX_QUERY_LENGTH = 100;
const MAX_ID_LENGTH = 100;

export type DiscoverSearchResult = { results?: CatalogResult[]; error?: string };
export type DiscoverRecipeResult = { recipe?: FileRecipe; haves?: boolean[]; error?: string };

export async function searchRecipeCatalogAction(input: {
  query: string;
  tags: string[];
}): Promise<DiscoverSearchResult> {
  // Outside the try/catch on purpose: requireHousehold signals "not signed in"
  // by redirecting, and swallowing that would leak a half-rendered page.
  // The household always comes from the session, never from the client.
  const { household } = await requireHousehold();
  const [locale, dict] = await Promise.all([getLocale(), getDictionary()]);

  // Server Actions are callable with any JSON, so don't trust the types.
  const query = typeof input?.query === "string" ? input.query.slice(0, MAX_QUERY_LENGTH) : "";
  const tags = parseRecipeTags(Array.isArray(input?.tags) ? input.tags : []);

  let context;
  try {
    const now = Date.now();
    context = await loadDiscoverContext(household.id, now);
  } catch {
    return { error: dict.mealPlanning.discover.errorLoad };
  }

  return {
    results: rankCatalogRecipes(RECIPE_CATALOG, context.pantry, {
      query,
      tags,
      locale,
      savedNames: context.savedNames,
    }),
  };
}

export async function getCatalogRecipeAction(id: string): Promise<DiscoverRecipeResult> {
  const { household } = await requireHousehold();
  const [locale, dict] = await Promise.all([getLocale(), getDictionary()]);

  const recipe =
    typeof id === "string" && id.length <= MAX_ID_LENGTH
      ? RECIPE_CATALOG.find((candidate) => candidate.id === id)
      : undefined;
  if (!recipe) return { error: dict.mealPlanning.discover.errorNotFound };

  // The pantry is read only to tick off ingredients the household has.
  let context;
  try {
    context = await loadDiscoverContext(household.id, Date.now());
  } catch {
    return { error: dict.mealPlanning.discover.errorLoad };
  }

  return {
    recipe: catalogToParsedRecipe(recipe, locale),
    haves: ingredientHaves(recipe, context.pantry),
  };
}
