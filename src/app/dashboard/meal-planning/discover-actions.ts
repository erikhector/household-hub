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

import { DEFAULT_ANTHROPIC_MODEL, resolveAttempts, runProviderChain } from "@/lib/ai/provider-chain";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  mapRecipeIdeas,
  recipeIdeasSchema,
  RECIPE_IDEAS_GEMINI_SCHEMA,
  RECIPE_IDEAS_SYSTEM_PROMPT,
  RECIPE_IDEAS_TOOL,
  recipeIdeasUserText,
} from "@/lib/recipe-ideas/ai";
import { RECIPE_CATALOG } from "@/lib/recipe-catalog/data";
import { loadDiscoverContext } from "@/lib/recipe-catalog/pantry";
import { ingredientHaves, rankCatalogRecipes, type CatalogResult } from "@/lib/recipe-catalog/rank";
import { catalogToParsedRecipe } from "@/lib/recipe-catalog/to-parsed";
import type { FileRecipe } from "@/lib/recipe-import/parse-file";
import { parseRecipeTags } from "@/lib/recipe-tags";
import { requireHousehold } from "@/lib/session";

const MAX_QUERY_LENGTH = 100;
const MAX_ID_LENGTH = 100;

// Same shared-deadline reasoning as REQUEST_TIMEOUT_MS in receipt-scan.ts.
const IDEAS_TIMEOUT_MS = 50_000;
// Its own rate-limit key, separate from the photo import's, same numbers: a
// household that scanned a lot of recipes shouldn't lose its ideas button.
const IDEAS_RATE_LIMIT = 20;
const IDEAS_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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

const ideasInputSchema = z.object({ tags: z.array(z.unknown()).catch([]) }).catch({ tags: [] });

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

export type RecipeIdeasResult = { ideas?: FileRecipe[]; error?: string };

// Optional "ideas from your pantry" action; only offered when an AI key is
// configured (the meal-planning page checks the same two keys), and a direct
// call without one answers "not configured". Like the photo import it never
// saves anything: the user previews an idea and saves it through the normal
// form. The privacy tradeoff mirrors the receipt and photo scans: pantry item
// names and saved recipe names (no quantities) go to the configured
// third-party model and are not stored.
export async function suggestRecipeIdeasAction(input: { tags: string[] }): Promise<RecipeIdeasResult> {
  // Outside any try/catch, as in the actions above.
  const { household } = await requireHousehold();
  const [locale, dict] = await Promise.all([getLocale(), getDictionary()]);
  const discover = dict.mealPlanning.discover;

  const attempts = resolveAttempts({
    anthropicModel: process.env.RECEIPT_SCAN_MODEL || DEFAULT_ANTHROPIC_MODEL,
    geminiFallbackModel: true,
  });
  if (attempts.length === 0) return { error: discover.ideasNotConfigured };

  if (!(await checkRateLimit(`recipe-ideas:${household.id}`, IDEAS_RATE_LIMIT, IDEAS_RATE_LIMIT_WINDOW_MS))) {
    return { error: discover.ideasRateLimited };
  }

  const tags = parseRecipeTags(ideasInputSchema.parse(input).tags);

  let context;
  try {
    context = await loadDiscoverContext(household.id, Date.now());
  } catch {
    return { error: discover.ideasFailed };
  }

  const result = await runProviderChain(attempts, {
    feature: "AI recipe ideas",
    systemPrompt: RECIPE_IDEAS_SYSTEM_PROMPT,
    userText: recipeIdeasUserText({
      pantry: context.pantry,
      tags,
      locale,
      savedNames: context.savedNames,
    }),
    geminiSchema: RECIPE_IDEAS_GEMINI_SCHEMA,
    anthropicTool: RECIPE_IDEAS_TOOL,
    anthropicMaxTokens: 4096,
    schema: recipeIdeasSchema,
    timeoutMs: IDEAS_TIMEOUT_MS,
    fallbackOn: "busy",
    failureLevel: "error",
  });
  if (!result.ok) {
    return { error: result.error === "provider_busy" ? discover.ideasBusy : discover.ideasFailed };
  }

  const ideas = mapRecipeIdeas(result.data, context.savedNames);
  if (ideas.length === 0) return { error: discover.ideasNone };
  return { ideas };
}
