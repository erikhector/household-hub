import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";

// UX-96: the order of the add-meal sheet's recipe list. Favourites first
// (GAP-18), then the most recently cooked (GAP-46), then the rest in the
// order they came in (alphabetical from the page's query). Within the
// favourites the recently cooked still come first, so the household's
// go-to meal it made last week is the top row. Pure so it can be tested
// without rendering the sheet.
export function orderRecipesForPicker<T extends { id: string; isFavorite: boolean }>(
  recipes: T[],
  cooked: Record<string, Pick<RecipeCookedStats, "lastCookedAt"> | undefined>,
): T[] {
  // ISO strings from the same `toISOString` sort chronologically as text.
  const lastCooked = (id: string) => cooked[id]?.lastCookedAt ?? "";
  return recipes
    .map((recipe, index) => ({ recipe, index }))
    .sort((a, b) => {
      const fav = Number(b.recipe.isFavorite) - Number(a.recipe.isFavorite);
      if (fav !== 0) return fav;
      const ca = lastCooked(a.recipe.id);
      const cb = lastCooked(b.recipe.id);
      if (ca !== cb) return ca < cb ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ recipe }) => recipe);
}
