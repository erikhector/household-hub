// Ranking for the built-in recipe catalog ("recipe discovery"): orders the
// catalog by how much of each recipe the household already has in its
// pantry, with a bonus for using things that are about to expire, and narrows
// it by search text and diet tags.
//
// Deliberately pure and import-light. It never imports `./data` (the catalog
// stays server-only; callers pass it in) and has no zod or other server-only
// import, so its types and `normalizeForSearch` stay safe to import from a
// client component. None does yet; `normalizeForSearch` is exported for the
// planned AI-ideas filter and for reuse.

import type { Locale } from "@/lib/i18n/locales";
import type { RecipeTag } from "@/lib/recipe-tags";
import { FEATURED_COUNT, type CatalogIngredient, type CatalogRecipe } from "./types";

// `low` from the spec is not carried: the score doesn't use it.
export type PantryEntry = { name: string; quantity: number; expiring: boolean };

export type CatalogResult = {
  id: string;
  name: string;
  tags: RecipeTag[];
  servings: number;
  haveCount: number;
  totalCount: number;
  // Localized names of the recipe's ingredients that an expiring pantry item
  // covers, deduplicated.
  expiringMatches: string[];
};

export type RankOptions = {
  query: string;
  tags: RecipeTag[];
  locale: Locale;
  // Names of recipes the household already saved, hidden from discovery.
  savedNames: string[];
  limit?: number;
};

const DEFAULT_LIMIT = 30;

// Each distinct expiring ingredient adds this much to a score that otherwise
// runs 0..1, and only the first EXPIRING_BOOST_CAP count. Without the cap a
// recipe that uses five expiring things but covers a third of its
// ingredients would outrank one the household can nearly cook tonight.
const EXPIRING_BOOST = 0.15;
const EXPIRING_BOOST_CAP = 3;

// Lowercase, accent-folded, whitespace-collapsed text for substring
// matching. Accents fold (crème -> creme) so a query typed without them still
// finds the recipe, but å, ä and ö do NOT: in Swedish they are separate
// letters, and folding them would make "lok" (no such word) match "lök"
// (onion) and "far" match "får". They are swapped for placeholders around the
// NFD step, which is what would otherwise split them into base letter plus
// combining mark.
const SWEDISH_LETTERS: Array<[string, string]> = [
  // Private-use code points: never in real text, and untouched by NFD.
  ["å", "\uE000"],
  ["ä", "\uE001"],
  ["ö", "\uE002"],
  ["Å", "\uE003"],
  ["Ä", "\uE004"],
  ["Ö", "\uE005"],
];

export function normalizeForSearch(text: string): string {
  let out = text.normalize("NFC");
  for (const [letter, placeholder] of SWEDISH_LETTERS) out = out.split(letter).join(placeholder);
  out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [letter, placeholder] of SWEDISH_LETTERS) out = out.split(placeholder).join(letter);
  return out.toLowerCase().trim().replace(/\s+/g, " ");
}

// Pantry entries reduced to what matching needs: a map from normalized name
// to whether any row with that name is expiring. Zero (or negative) on hand
// is dropped entirely: an item at quantity 0 is on the list of things to buy,
// not something to cook with (same reasoning as use-it-up-calc.ts' reasonFor,
// and freshly created inventory items start at 0). Duplicate rows (two
// cartons of milk, one expiring) merge into one entry that is expiring if
// any of them is, which is what matching against the rows one by one did.
//
// Built once per call so matching is a map lookup per ingredient. Comparing
// every ingredient with every pantry row, normalizing both each time, took
// ~840 ms per ranking with a 200-item pantry.
type StockedPantry = Map<string, { expiring: boolean }>;

function normalizePantry(pantry: PantryEntry[]): StockedPantry {
  const stocked: StockedPantry = new Map();
  for (const entry of pantry) {
    if (!(entry.quantity > 0)) continue;
    const name = normalizeForSearch(entry.name);
    if (name === "") continue;
    const existing = stocked.get(name);
    if (existing) existing.expiring ||= entry.expiring;
    else stocked.set(name, { expiring: entry.expiring });
  }
  return stocked;
}

// Normalized [en, sv] names, memoized per catalog object. The catalog is a
// module-level constant, so each name is normalized once per server process
// rather than on every search keystroke. A WeakMap keeps test fixtures (and
// anything else short-lived) collectable.
type NormalizedNames = readonly [en: string, sv: string];
const ingredientNameCache = new WeakMap<CatalogIngredient, NormalizedNames>();
const recipeNameCache = new WeakMap<CatalogRecipe, NormalizedNames>();

function memoNames<T extends object>(
  cache: WeakMap<T, NormalizedNames>,
  key: T,
  name: { en: string; sv: string },
): NormalizedNames {
  let names = cache.get(key);
  if (!names) {
    names = [normalizeForSearch(name.en), normalizeForSearch(name.sv)];
    cache.set(key, names);
  }
  return names;
}

const ingredientNames = (ingredient: CatalogIngredient) =>
  memoNames(ingredientNameCache, ingredient, ingredient.name);
const recipeNames = (recipe: CatalogRecipe) => memoNames(recipeNameCache, recipe, recipe.name);
const localeIndex = (locale: Locale) => (locale === "sv" ? 1 : 0);

// A pantry name matches an ingredient when it equals the ingredient's name in
// EITHER language. The pantry is free text in whatever language the household
// types, which need not be the language the UI is currently showing, so
// matching only the current locale would make a Swedish pantry look empty to
// an English-speaking member. Returns undefined when nothing in stock matches,
// otherwise whether any matching row is expiring.
function matchIngredient(ingredient: CatalogIngredient, stocked: StockedPantry): { expiring: boolean } | undefined {
  const [en, sv] = ingredientNames(ingredient);
  const byEn = stocked.get(en);
  const bySv = stocked.get(sv);
  if (!byEn && !bySv) return undefined;
  return { expiring: Boolean(byEn?.expiring || bySv?.expiring) };
}

// Per ingredient: is it covered by something in stock? Used by the recipe
// detail to tick ingredients off.
export function ingredientHaves(recipe: CatalogRecipe, pantry: PantryEntry[]): boolean[] {
  const stocked = normalizePantry(pantry);
  return recipe.ingredients.map((ingredient) => matchIngredient(ingredient, stocked) !== undefined);
}

type Scored = { recipe: CatalogRecipe; result: CatalogResult; score: number };

function score(recipe: CatalogRecipe, stocked: StockedPantry, locale: Locale): Scored {
  let haveCount = 0;
  const expiringNames = new Set<string>();
  for (const ingredient of recipe.ingredients) {
    const match = matchIngredient(ingredient, stocked);
    if (!match) continue;
    haveCount += 1;
    // Keyed by the ingredient, so two ingredient rows with the same name (egg
    // yolk and egg white) or two pantry rows for the same thing boost once.
    if (match.expiring) expiringNames.add(ingredient.name[locale]);
  }
  const totalCount = recipe.ingredients.length;
  const expiringMatches = [...expiringNames];
  const coverage = totalCount === 0 ? 0 : haveCount / totalCount;
  return {
    recipe,
    score: coverage + EXPIRING_BOOST * Math.min(expiringMatches.length, EXPIRING_BOOST_CAP),
    result: {
      id: recipe.id,
      name: recipe.name[locale],
      tags: recipe.tags,
      servings: recipe.servings,
      haveCount,
      totalCount,
      expiringMatches,
    },
  };
}

export function rankCatalogRecipes(
  catalog: readonly CatalogRecipe[],
  pantry: PantryEntry[],
  options: RankOptions,
): CatalogResult[] {
  const { locale, tags } = options;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const query = normalizeForSearch(options.query);
  const saved = new Set(options.savedNames.map(normalizeForSearch));
  const stocked = normalizePantry(pantry);
  const index = localeIndex(locale);
  // A saved name is checked against the recipe's name in both languages: a
  // household that saved "Köttbullar" and later switched to English must not
  // be offered "Meatballs" as something new.
  const isSaved = (recipe: CatalogRecipe) => recipeNames(recipe).some((name) => saved.has(name));

  // Plain substring search, never a RegExp: "(" or "c++" are just text. Only
  // the current locale's text is searched, so a Swedish query doesn't hit the
  // English names that happen to share letters.
  const matchesQuery = (recipe: CatalogRecipe) =>
    query === "" ||
    recipeNames(recipe)[index].includes(query) ||
    recipe.ingredients.some((ingredient) => ingredientNames(ingredient)[index].includes(query));

  const filtered = catalog
    .filter((recipe) => !isSaved(recipe))
    .filter((recipe) => tags.every((tag) => recipe.tags.includes(tag)))
    .filter(matchesQuery)
    .map((recipe) => score(recipe, stocked, locale));

  const browsing = query === "" && tags.length === 0;
  // With no search or filter the list answers "what can I make with what I
  // have", so recipes sharing nothing with the pantry are noise. Once the
  // user searches or filters they asked for those recipes, covered or not.
  const candidates = browsing ? filtered.filter((entry) => entry.result.haveCount >= 1) : filtered;

  if (candidates.length === 0 && browsing) {
    // Nothing overlaps (empty pantry, or nothing in it is a known
    // ingredient): show the curated featured set rather than an empty page.
    // The slice comes first so the set doesn't grow to backfill saved ones.
    return catalog
      .slice(0, FEATURED_COUNT)
      .filter((recipe) => !isSaved(recipe))
      .map((recipe) => score(recipe, stocked, locale).result)
      .slice(0, limit);
  }

  return candidates
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.result.expiringMatches.length - a.result.expiringMatches.length ||
        b.result.haveCount - a.result.haveCount ||
        a.result.name.localeCompare(b.result.name, locale),
    )
    .slice(0, limit)
    .map((entry) => entry.result);
}
