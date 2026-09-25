// GAP-15: a rough "what does this recipe cost to make" estimate, joining
// each RecipeIngredient to the price data AUTO-4 already keeps on its
// linked InventoryItem (`lastKnownPrice`). Pure and Prisma-free, same split
// as missing-ingredients.ts — page.tsx does the (already cached) inventory
// fetch and hands this module plain rows, so it's unit-testable without
// mocking anything; see recipe-cost.test.ts.
//
// `lastKnownPrice` is read as the price of ONE of the inventory item's own
// unit (one "pcs", one "kg", …) — the same per-unit reading the shopping
// list already gives it when it defaults a new row's `estimatedPrice` to it
// (REQUIREMENTS.md, "Prices fill themselves in (AUTO-4)"). That's only ever
// approximately true (a receipt line for a 6-pack still records one price),
// which is exactly why the UI prints the result with a "~" and never as a
// hard number.

import { convertQuantity } from "@/lib/units";

export type RecipeCostIngredient = {
  quantity: number;
  // The RecipeIngredient's own unit — independent free text from the
  // linked item's unit below, see schema.prisma.
  unit: string;
  // The linked InventoryItem's unit and price, or null when the ingredient
  // isn't linked to one (a free-typed name that never resolved).
  inventoryItem: { unit: string; lastKnownPrice: number | null } | null;
};

export type RecipeCost = {
  total: number;
  perServing: number;
  // How many ingredients actually contributed to `total` vs. how many were
  // left out (unlinked, never priced, or in a unit that can't be converted
  // into the linked item's) — a non-zero `skippedCount` is what makes the
  // UI label the number as a partial estimate.
  pricedCount: number;
  skippedCount: number;
};

const normalizeUnit = (unit: string) => unit.trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

// Converts each ingredient's quantity into its linked item's unit the same
// way computeMissingIngredients reconciles recipe vs. on-hand units — an
// exact (case/whitespace-insensitive) string match first, then
// src/lib/units.ts's fixed table — and multiplies by that item's
// `lastKnownPrice`. Anything that can't be priced is skipped and counted
// rather than guessed at: a volume-vs-weight pair (cups of flour against a
// flour item kept in kg) needs a density we don't have, and inventing a
// price for it would make the total look more precise than it is.
//
// Returns null when nothing at all could be priced, so the caller can hide
// the line entirely — the common case until AUTO-4 has seen a household's
// shopping for a while, same as the nutrition line is hidden for a recipe
// with no nutrition entered.
export function computeRecipeCost(ingredients: RecipeCostIngredient[], servings: number): RecipeCost | null {
  let total = 0;
  let pricedCount = 0;
  let skippedCount = 0;

  for (const ingredient of ingredients) {
    const price = ingredient.inventoryItem?.lastKnownPrice;
    if (ingredient.inventoryItem === null || price == null) {
      skippedCount++;
      continue;
    }

    const itemUnit = ingredient.inventoryItem.unit;
    const quantityInItemUnit =
      normalizeUnit(ingredient.unit) === normalizeUnit(itemUnit)
        ? ingredient.quantity
        : convertQuantity(ingredient.quantity, ingredient.unit, itemUnit);
    if (quantityInItemUnit === null) {
      skippedCount++;
      continue;
    }

    total += quantityInItemUnit * price;
    pricedCount++;
  }

  if (pricedCount === 0) return null;

  // Recipe.servings is validated >= 1 on save, but a divide-by-zero here
  // would render "Infinity" on the card, so don't trust that blindly.
  const safeServings = servings > 0 ? servings : 1;
  return {
    total: round2(total),
    perServing: round2(total / safeServings),
    pricedCount,
    skippedCount,
  };
}
