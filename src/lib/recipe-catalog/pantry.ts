// Loads what discovery needs to know about a household: its pantry (for
// ranking) and the names of recipes it already saved (hidden from discovery).
//
// Server-only: it imports prisma. Shared by the discover Server Actions and
// the meal-planning page (which ranks the sheet's first list as it renders),
// so the "what counts as expiring" rule lives in one place.
import { getExpiryStatus } from "@/lib/inventory/expiry";
import { prisma } from "@/lib/prisma";
import type { PantryEntry } from "./rank";

// `householdId` comes from the caller's session (requireHousehold), never from
// the client. `now` is passed in so the caller decides the clock.
export async function loadDiscoverContext(
  householdId: string,
  now: number,
): Promise<{ pantry: PantryEntry[]; savedNames: string[] }> {
  const [items, recipes] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId },
      select: { name: true, quantity: true, expiresAt: true },
    }),
    prisma.recipe.findMany({ where: { householdId }, select: { name: true } }),
  ]);
  return {
    pantry: items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      // Expired and about-to-expire both mean "cook this soon".
      expiring: getExpiryStatus(item.expiresAt, now) !== null,
    })),
    savedNames: recipes.map((recipe) => recipe.name),
  };
}
