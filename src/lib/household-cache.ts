import { updateTag } from "next/cache";
import { isHomeCacheEnabled } from "@/lib/home-cache-flag";

// PERF-32a: every cache tag in the app is built here, so none is ever
// unscoped. A tag names one household's data in one area of the app
// ("household:<id>:home"); a cached function tags its entry with it and every
// write to that data clears it. A bare area tag ("home") would let one
// household's write clear, or a bug serve, another household's entry.
//
// Only "home" exists so far. PERF-33..36 add an area each (inventory, tasks,
// meal planning, budget) once PERF-32b has shown the Home cache pays off.
type CacheArea = "home";

export function householdTag(householdId: string, area: CacheArea): string {
  // An empty id would make "household::home", one tag shared by every
  // caller that lost its id: fail loudly instead.
  if (!householdId) throw new Error("householdTag needs a household id");
  return `household:${householdId}:${area}`;
}

/**
 * Clears the household's cached Home batch (src/lib/home-data.ts). Every
 * Server Action that writes data Home shows calls it after the write, next
 * to its revalidatePath calls. A no-op while the Home cache is off
 * (src/lib/home-cache-flag.ts), so with the flag off actions behave exactly
 * as before. Server Actions only: updateTag throws anywhere else, and it
 * makes the action's own refresh read fresh data (read-your-own-writes).
 */
export function invalidateHome(householdId: string): void {
  if (!isHomeCacheEnabled()) return;
  updateTag(householdTag(householdId, "home"));
}
