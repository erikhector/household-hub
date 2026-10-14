// Pure helpers for GAP-45's "Fill empty days" preview. Split out from the
// dialog and the Server Action so the pick/swap rules are unit-testable
// without mocking anything, like leftovers.ts. Nothing here writes: the
// proposal lives in the dialog's state until the household accepts it.

export type FavoriteCandidate = { id: string; name: string };
export type DinnerProposal = { dateKey: string; recipeId: string };

// Favorites in a stable order (name, then id) so a proposal doesn't reshuffle
// between renders and a "swap" walks a predictable list. A tiebreak on id
// keeps two same-named recipes from swapping places run to run.
function sortedCandidates(favorites: readonly FavoriteCandidate[]): FavoriteCandidate[] {
  return [...favorites].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// One dinner per empty day, from favorites not already planned this week and
// never the same recipe twice. With fewer unused favorites than empty days
// the later days are left out rather than repeating one: a short preview is
// honest, a repeated dinner is the thing the household asked us not to do.
export function proposeDinners({
  emptyDays,
  favorites,
  plannedRecipeIds,
}: {
  emptyDays: readonly string[];
  favorites: readonly FavoriteCandidate[];
  plannedRecipeIds: ReadonlySet<string>;
}): DinnerProposal[] {
  const pool = sortedCandidates(favorites).filter((f) => !plannedRecipeIds.has(f.id));
  return emptyDays.slice(0, pool.length).map((dateKey, i) => ({ dateKey, recipeId: pool[i].id }));
}

// The next favorite after `currentId` (wrapping) that neither the rest of the
// proposal nor the already-planned week uses. Null when every other favorite
// is taken, so the dialog can disable that row's swap instead of looping on
// the same recipe.
export function nextSwap({
  currentId,
  favorites,
  usedRecipeIds,
}: {
  currentId: string;
  favorites: readonly FavoriteCandidate[];
  usedRecipeIds: ReadonlySet<string>;
}): string | null {
  const sorted = sortedCandidates(favorites);
  const start = sorted.findIndex((f) => f.id === currentId);
  for (let step = 1; step <= sorted.length; step++) {
    const candidate = sorted[(start + step + sorted.length) % sorted.length];
    if (candidate.id !== currentId && !usedRecipeIds.has(candidate.id)) return candidate.id;
  }
  return null;
}
