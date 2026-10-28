// Recipe import from URL — the public entry point. The implementation lives in
// src/lib/recipe-import/ (MAINT-65), split into two unrelated jobs:
//   - parse-*.ts / html.ts / parse.ts: pure parsing (JSON-LD extraction,
//     ingredient splitting, instruction flattening, Microdata and heading
//     fallbacks). No network dependency; unit-tested with inline HTML/JSON
//     fixtures in recipe-import/parse.test.ts.
//   - fetch.ts: the SSRF-guarding URL validation and fetch used by
//     importRecipeFromUrlAction
//     (src/app/dashboard/meal-planning/recipe-actions.ts). It is the only
//     part that touches the network; recipe-import/fetch.test.ts mocks
//     node:dns/node:http/node:https to exercise its SSRF/DNS-rebinding guard
//     and its size/timeout handling without a real connection.
// This file only re-exports, so callers keep importing "@/lib/recipe-import".
//
// Extraction runs in three tiers, most trustworthy first (GAP-31):
//   1. schema.org `Recipe` JSON-LD — the site's own machine-readable data,
//      and what the large majority of recipe blogs emit (Yoast, WP Recipe
//      Maker, Tasty Recipes, ICA, …). When one is found it always wins and
//      the other tiers never run, so JSON-LD results are byte-for-byte what
//      they were before the fallbacks existed.
//   2. schema.org `Recipe` Microdata (`itemscope itemtype=".../Recipe"` with
//      `itemprop="name"/"recipeIngredient"/"recipeInstructions"`) — older
//      templates that predate JSON-LD. Still structured, but read out of
//      arbitrary markup, so less exact.
//   3. An HTML heuristic — the page's `<h1>`/`<title>` plus the list(s)
//      following a heading like "Ingredients"/"Ingredienser". Pure guesswork
//      for pages with no structured data at all.
// Tiers 2 and 3 are flagged via `source` so the form can tell the user to
// review before saving (the import already never auto-saves; the flag just
// makes that review explicit when we were guessing). All three stay
// regex/string-based — no DOM parser dependency, matching how the JSON-LD
// tier has always worked.
export type { ImportedRecipe, ParsedIngredient, ParsedRecipe, RecipeImportSource } from "./recipe-import/types";
export { parseIngredientLine, parseIngredientString } from "./recipe-import/parse-ingredient";
export { extractJsonLdBlocks, findRecipeNode, flattenInstructions, mapJsonLdToRecipe } from "./recipe-import/parse-jsonld";
export { parseMicrodataRecipe } from "./recipe-import/parse-microdata";
export { parseHeuristicRecipe } from "./recipe-import/parse-heuristic";
export { parseRecipeFromHtml } from "./recipe-import/parse";
export {
  _setPrivateAddressCheckForTests,
  fetchRecipeHtml,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  validateRecipeUrl,
  type FetchRecipeError,
  type FetchRecipeResult,
  type UrlValidationError,
  type UrlValidationResult,
} from "./recipe-import/fetch";
