// Pure helpers for GAP-45's "Fill empty days" preview. Split out from the
// dialog and the Server Action so the pick/swap rules are unit-testable
// without mocking anything, like leftovers.ts. Nothing here writes: the
// proposal lives in the dialog's state until the household accepts it.

export type RecipeCandidate = { id: string; name: string; isFavorite: boolean };
export type DinnerProposal = { dateKey: string; recipeId: string };

// Every recipe in a stable order: favorites first, then the rest, each group
// by name and then id (UX-97), so a proposal doesn't reshuffle between renders
// and a "swap" walks a predictable list. The id tiebreak keeps two same-named
// recipes from swapping places run to run.
function sortedCandidates(recipes: readonly RecipeCandidate[]): RecipeCandidate[] {
  return [...recipes].sort(
    (a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

// One dinner per empty day, from recipes not already planned this week and
// never the same recipe twice. Favorites come first and the household's other
// recipes fill the remaining days once favorites run out (UX-97). With fewer
// unused recipes than empty days the later days are left out rather than
// repeating one: a short preview is honest, a repeated dinner is the thing
// the household asked us not to do.
export function proposeDinners({
  emptyDays,
  recipes,
  plannedRecipeIds,
}: {
  emptyDays: readonly string[];
  recipes: readonly RecipeCandidate[];
  plannedRecipeIds: ReadonlySet<string>;
}): DinnerProposal[] {
  const pool = sortedCandidates(recipes).filter((f) => !plannedRecipeIds.has(f.id));
  return emptyDays.slice(0, pool.length).map((dateKey, i) => ({ dateKey, recipeId: pool[i].id }));
}

// The next recipe after `currentId` (wrapping, favorites first) that neither
// the rest of the proposal nor the already-planned week uses. Null when every other recipe
// is taken, so the dialog can disable that row's swap instead of looping on
// the same recipe.
export function nextSwap({
  currentId,
  recipes,
  usedRecipeIds,
}: {
  currentId: string;
  recipes: readonly RecipeCandidate[];
  usedRecipeIds: ReadonlySet<string>;
}): string | null {
  const sorted = sortedCandidates(recipes);
  const start = sorted.findIndex((f) => f.id === currentId);
  for (let step = 1; step <= sorted.length; step++) {
    const candidate = sorted[(start + step + sorted.length) % sorted.length];
    if (candidate.id !== currentId && !usedRecipeIds.has(candidate.id)) return candidate.id;
  }
  return null;
}
