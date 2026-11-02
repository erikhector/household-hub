"use server";

// Server Actions behind recipe discovery: search the built-in catalog ranked
// by the household's pantry, and fetch one catalog recipe for preview.
//
// Input is validated with zod but cleaned rather than rejected: a bad query
// becomes "", unknown tags are dropped, an over-long query is cut. A search
// box has no error to show, so a stale or hand-crafted request just gets a
// sensible list. zod is fine here: a "use server" module is replaced by
// reference stubs in the client bundle, so it never ships to the browser
// (client-bundle-guard.test.ts stops walking at the directive).

import { z } from "zod";

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

// Server Actions are callable with any JSON, so the declared parameter types
// are not trusted. Every field (and the object itself) falls back with
// `.catch` instead of failing; tags are narrowed by parseRecipeTags, which
// drops anything outside the closed set.
const searchInputSchema = z
  .object({
    query: z
      .string()
      .catch("")
      .transform((query) => query.slice(0, MAX_QUERY_LENGTH)),
    tags: z.array(z.unknown()).catch([]),
  })
  .catch({ query: "", tags: [] });

const catalogIdSchema = z.string().max(MAX_ID_LENGTH);

export type DiscoverSearchResult = { results?: CatalogResult[]; error?: string };
// `notFound` is set alongside `error` when the id names no catalog recipe, so
// the preview can tell "gone" (go back to the list) from "failed to load"
// (try again) without comparing message strings.
export type DiscoverRecipeResult = {
  recipe?: FileRecipe;
  haves?: boolean[];
  error?: string;
  notFound?: true;
};

export async function searchRecipeCatalogAction(input: {
  query: string;
  tags: string[];
}): Promise<DiscoverSearchResult> {
  // Outside the try/catch on purpose: requireHousehold signals "not signed in"
  // by redirecting, and swallowing that would leak a half-rendered page.
  // The household always comes from the session, never from the client.
  const { household } = await requireHousehold();
  const [locale, dict] = await Promise.all([getLocale(), getDictionary()]);

  const parsed = searchInputSchema.parse(input);
  const query = parsed.query;
  const tags = parseRecipeTags(parsed.tags);

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

  const parsedId = catalogIdSchema.safeParse(id);
  const recipe = parsedId.success
    ? RECIPE_CATALOG.find((candidate) => candidate.id === parsedId.data)
    : undefined;
  if (!recipe) return { error: dict.mealPlanning.discover.errorNotFound, notFound: true };

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
