// GAP-80: the Recipes tab's sort. A plain module so the client list and its
// unit test share one comparator. The page query hands recipes over already
// alphabetical; every other order is applied client-side from the GAP-46
// cooked stats (recipe-cooked-stats.ts) and Recipe.createdAt, so changing
// the sort costs no round trip and nothing is stored.

export const RECIPE_SORTS = ["name", "lastCooked", "mostCooked", "newest"] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

export function isRecipeSort(value: string): value is RecipeSort {
  return (RECIPE_SORTS as readonly string[]).includes(value);
}

type SortableRecipe = { id: string; name: string; createdAt: string };
type CookedStats = Record<string, { count: number; lastCookedAt: string }>;

/**
 * Returns a sorted copy (the input is never mutated):
 * - `name`: A–Z, the page query's own order, so it's returned as given.
 * - `lastCooked`: the longest since cooked first, and a never-cooked recipe
 *   before any cooked one, since the point is finding what has dropped out
 *   of rotation.
 * - `mostCooked`: the highest cooked count first; never cooked counts as 0.
 * - `newest`: the most recently created first.
 * Ties fall back to the name, so the order never depends on where a recipe
 * happened to sit in the input.
 */
export function sortRecipes<T extends SortableRecipe>(recipes: T[], sort: RecipeSort, cooked: CookedStats): T[] {
  if (sort === "name") return recipes;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const primary = (a: T, b: T): number => {
    if (sort === "mostCooked") return (cooked[b.id]?.count ?? 0) - (cooked[a.id]?.count ?? 0);
    if (sort === "newest") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    // lastCooked: never cooked sorts as -Infinity, i.e. first.
    const last = (r: T) => (cooked[r.id] ? Date.parse(cooked[r.id].lastCookedAt) : -Infinity);
    const diff = last(a) - last(b);
    // -Infinity - -Infinity is NaN: two never-cooked recipes are a tie.
    return Number.isNaN(diff) ? 0 : diff;
  };
  return [...recipes].sort((a, b) => primary(a, b) || byName(a, b));
}
