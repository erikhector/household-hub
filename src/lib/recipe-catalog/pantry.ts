// Loads what discovery needs to know about a household: its pantry (for
// ranking) and the names of recipes it already saved (hidden from discovery).
//
// Server-only: it imports prisma. The mapping is the pure `toDiscoverContext`,
// so the meal-planning page (which ranks the sheet's first list as it renders)
// can run it on the inventory and recipes it already fetched, while the
// discover Server Actions go through `loadDiscoverContext`. Either way the
// "what counts as expiring" rule lives in one place.
import { getExpiryStatus } from "@/lib/inventory/expiry";
import { prisma } from "@/lib/prisma";
import type { PantryEntry } from "./rank";

export type DiscoverContext = { pantry: PantryEntry[]; savedNames: string[] };

// Pure: maps inventory rows and saved recipe names to the discovery context.
// `now` is passed in so the caller decides the clock.
export function toDiscoverContext(
  items: ReadonlyArray<{ name: string; quantity: number; expiresAt: Date | null }>,
  recipeNames: ReadonlyArray<string>,
  now: number,
): DiscoverContext {
  return {
    pantry: items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      // Expired and about-to-expire both mean "cook this soon".
      expiring: getExpiryStatus(item.expiresAt, now) !== null,
    })),
    savedNames: [...recipeNames],
  };
}

// `householdId` comes from the caller's session (requireHousehold), never from
// the client. `now` is passed in so the caller decides the clock.
export async function loadDiscoverContext(householdId: string, now: number): Promise<DiscoverContext> {
  const [items, recipes] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId },
      select: { name: true, quantity: true, expiresAt: true },
    }),
    prisma.recipe.findMany({ where: { householdId }, select: { name: true } }),
  ]);
  return toDiscoverContext(
    items,
    recipes.map((recipe) => recipe.name),
    now,
  );
}
