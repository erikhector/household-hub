// GAP-29 — recipe dietary tags. A small, CLOSED set of keys stored on
// `Recipe.tags` (a Postgres text[] — see schema.prisma) and labelled per
// locale from `mealPlanning.recipeTags` in en.ts/sv.ts, the same
// key-in-the-database, label-in-the-dictionary split AUTO-2's
// `inventory.autoCategories` uses. Keys rather than labels are what's stored
// so switching language relabels every recipe instead of leaving a mix of
// "Vegetarian" and "Vegetariskt" behind, and so the filter can compare
// exact values rather than fuzzy-matching free text.
//
// Deliberately not free-form: a household typing "veg", "veggie" and
// "vegetarian" on three different recipes would split one filter into three.
// Adding a tag means adding a key here and a label in both dictionaries —
// nothing else, since the column holds arbitrary strings and every read
// path runs through parseRecipeTags below. Removing one is also safe: a
// stored key that's no longer in the set is silently dropped on read.
//
// Pure and dependency-free so it's shared by the Server Actions, the
// recipe-import parser and the client-side filter alike. Deliberately no
// zod (PERF-7): recipe-manager.tsx and recipe-form-dialog.tsx import this
// file, and a zod import here pulled a ~99 KB gz chunk into the
// meal-planning client bundle for what is only a closed-set membership check.

// Order is display order — in the form's chips, the filter's options and a
// recipe card's badges — roughly strictest diet first, "quick" (not a diet
// at all, but the other thing people filter a weeknight recipe list by)
// last.
export const RECIPE_TAGS = [
  "vegan",
  "vegetarian",
  "glutenFree",
  "dairyFree",
  "nutFree",
  "lowCarb",
  "quick",
] as const;

export type RecipeTag = (typeof RECIPE_TAGS)[number];

// A generous cap well above RECIPE_TAGS.length — parseRecipeTags dedupes
// before this ever matters, so it only bounds how much junk a crafted
// request can make the server iterate over before the enum check drops it.
const MAX_RAW_TAG_VALUES = 100;

const RECIPE_TAG_SET: ReadonlySet<unknown> = new Set(RECIPE_TAGS);

export function isRecipeTag(value: unknown): value is RecipeTag {
  return RECIPE_TAG_SET.has(value);
}

/**
 * Normalizes untrusted input (FormData.getAll("tags"), a stored text[] that
 * may predate a tag's removal, an import) to a deduped, canonically ordered
 * RecipeTag[]. Unknown values are dropped rather than rejected — a stale
 * browser tab offering a since-removed tag shouldn't make the whole recipe
 * unsaveable, and nothing outside the closed set can ever reach the
 * database either way.
 */
export function parseRecipeTags(values: Iterable<unknown>): RecipeTag[] {
  const found = new Set<RecipeTag>();
  let seen = 0;
  for (const value of values) {
    if (++seen > MAX_RAW_TAG_VALUES) break;
    const candidate = typeof value === "string" ? value.trim() : value;
    if (isRecipeTag(candidate)) found.add(candidate);
  }
  return RECIPE_TAGS.filter((tag) => found.has(tag));
}

// A vegan recipe is by definition also vegetarian and dairy-free, so
// filtering by either of those should surface it without the household
// having to tick all three boxes (and without an import that only says
// "VeganDiet" being invisible under "Vegetarian"). Applied at filter time
// rather than by writing the implied tags into the column, so un-ticking
// "vegan" later doesn't leave stale implied tags behind.
const IMPLIED_BY: Partial<Record<RecipeTag, RecipeTag[]>> = {
  vegetarian: ["vegan"],
  dairyFree: ["vegan"],
};

/** Whether a recipe carrying `tags` should appear under the `filter` tag. */
export function recipeMatchesTag(tags: readonly RecipeTag[], filter: RecipeTag): boolean {
  if (tags.includes(filter)) return true;
  return (IMPLIED_BY[filter] ?? []).some((implying) => tags.includes(implying));
}

// schema.org/RestrictedDiet values (as used in a Recipe's `suitableForDiet`)
// that map cleanly onto a tag. Only the unambiguous ones: LowLactoseDiet
// isn't dairy-free, and LowCalorie/LowFat/LowSalt/Diabetic/Halal/Kosher/
// Hindu have no tag here, so they're ignored rather than approximated.
const SCHEMA_ORG_DIET_TAGS: Record<string, RecipeTag> = {
  vegandiet: "vegan",
  vegetariandiet: "vegetarian",
  glutenfreediet: "glutenFree",
};

/**
 * Maps a JSON-LD `suitableForDiet` value — a single string or an array,
 * each either a bare enum name ("VeganDiet") or a full schema.org URL
 * ("https://schema.org/VeganDiet", "http://schema.org/GlutenFreeDiet") —
 * to recipe tags. Anything else (objects, unknown diets, junk) is ignored,
 * and the result goes through parseRecipeTags like any other untrusted
 * input.
 */
export function tagsFromSchemaOrgDiet(value: unknown): RecipeTag[] {
  const values = Array.isArray(value) ? value : [value];
  const tags: RecipeTag[] = [];
  for (const raw of values.slice(0, MAX_RAW_TAG_VALUES)) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().split("/").pop()?.toLowerCase() ?? "";
    const tag = SCHEMA_ORG_DIET_TAGS[name];
    if (tag) tags.push(tag);
  }
  return parseRecipeTags(tags);
}
