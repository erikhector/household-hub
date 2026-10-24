// GAP-15: a rough "what does this recipe cost to make" estimate, joining
// each RecipeIngredient to the price data AUTO-4 already keeps on its
// linked InventoryItem (`lastKnownPrice`). Pure and Prisma-free, same split
// as missing-ingredients.ts — page.tsx does the queries and hands this
// module plain rows, so it's unit-testable without mocking anything; see
// recipe-cost.test.ts.
//
// `lastKnownPrice` is NOT the price of one of the item's own unit. It's the
// price of one purchased shopping-list *line*, whatever quantity that line
// was for: togglePurchasedAction records the line's `estimatedPrice`, and
// both receipt paths record the line's converted price (shopping-list
// actions.ts; estimated-total.ts calls it "per-unit, unmultiplied by
// quantity" in the same sense — per line). So for flour kept in "g" whose
// last 500 g pack cost 24, `lastKnownPrice` is 24, and multiplying it by a
// recipe's 200 g would claim the recipe costs 4800.
//
// BUG-3 refined that: new writers store the price per unit of the line's
// quantity (3 cartons for 45 is 15), so "one 500 g pack for 24" is still 24
// but "2 packs for 48" is 24 too, not 48. Lines saved before that kept the
// line price; unitPriceFromLastPurchase reads both.
//
// There's no quantity on PriceHistory or InventoryItem to divide by, but
// every writer of `lastKnownPrice` leaves behind the purchased,
// inventory-linked ShoppingListItem the price came from, with its
// `quantity`/`unit` and an `estimatedPrice` equal to the price it recorded.
// So the per-unit price is recovered as `lastKnownPrice ÷ (that line's
// quantity in the item's unit)` — 24 ÷ 500 g = 0.048/g, and 200 g costs
// 9.60. That's preferred over a capped "fraction of one purchase" because
// it's the same number when the fraction is computable and there's no
// schema change either way.
//
// When that line can't be found (its list was deleted, or its price was
// corrected afterwards so it no longer matches) or its unit can't be
// converted into the item's — the typical "1 pcs" receipt line for an item
// kept in grams, where we have no idea how many grams that piece was — the
// ingredient is skipped and counted rather than priced from a guess. A
// multi-pack entered as "1 pcs" of an item counted in pcs still reads as
// one piece; stock was incremented by 1 for that same line, so the
// estimate is at least consistent with what inventory believes was bought.
// That residual fuzziness is why the UI prints the result with a "~".

import { round2 } from "@/lib/math";
import { convertForItem, type ItemUnitConversionLike } from "@/lib/units";

// A purchased shopping-list line linked to the inventory item: what was
// paid for it (`price`, its `estimatedPrice`) and how much it was for.
export type RecipeCostPurchase = {
  quantity: number;
  unit: string;
  price: number;
};

export type RecipeCostIngredient = {
  // RecipeIngredient.untracked (MATCH-2): "Don't track" rows (water, …)
  // cost nothing worth estimating, so they're left out entirely rather
  // than counted as skipped and making the estimate read as partial.
  untracked?: boolean;
  quantity: number;
  // The RecipeIngredient's own unit — independent free text from the
  // linked item's unit below, see schema.prisma.
  unit: string;
  // The linked InventoryItem's unit and price, plus its purchased lines
  // newest-first (by createdAt), or null when the ingredient isn't linked
  // to one (a free-typed name that never resolved).
  inventoryItem: {
    unit: string;
    lastKnownPrice: number | null;
    purchases: RecipeCostPurchase[];
    // Its saved unit conversions (ItemUnitConversion, MATCH-3), so "300 g"
    // of flour counted in pcs can still be priced.
    conversions?: readonly ItemUnitConversionLike[];
  } | null;
};

export type RecipeCost = {
  total: number;
  perServing: number;
  // How many ingredients actually contributed to `total` vs. how many were
  // left out (unlinked, never priced, no recoverable purchase quantity, or
  // in a unit that can't be converted into the linked item's) — a non-zero
  // `skippedCount` is what makes the UI label the number as a partial
  // estimate.
  pricedCount: number;
  skippedCount: number;
};

// The same reconciliation computeMissingIngredients uses for recipe vs.
// on-hand units: the same unit, src/lib/units.ts's fixed table, then the
// item's own saved conversions (MATCH-3). null when there's no conversion.
function toItemUnit(
  quantity: number,
  unit: string,
  item: NonNullable<RecipeCostIngredient["inventoryItem"]>,
): number | null {
  return convertForItem(quantity, unit, item, item.conversions);
}

// The price of one of the item's own unit, recovered from the purchased
// line that set `lastKnownPrice`: the newest one whose price equals it
// (exact equality is safe — every writer copies the same number into both
// columns). Matching on the price rather than just taking the newest line
// matters because ShoppingListItem only has `createdAt`, not a purchase
// time: a line added last week but checked off today set the price, while
// a line added yesterday and checked off yesterday didn't, and the newest
// row would pick the wrong one of those two.
export function unitPriceFromLastPurchase(item: NonNullable<RecipeCostIngredient["inventoryItem"]>): number | null {
  const price = item.lastKnownPrice;
  if (price == null) return null;

  // BUG-3: lastKnownPrice is now per unit of the line's quantity, so the
  // line that set it has `price === lastKnownPrice × quantity` (to the
  // cent: the unit price is stored to four decimals). Lines recorded before
  // that stored the line price as is (`price === lastKnownPrice`); for a
  // quantity of 1 the two readings are the same number.
  for (const p of item.purchases) {
    if (Math.abs(p.price - price * p.quantity) < 0.01) {
      const oneInItemUnit = toItemUnit(1, p.unit, item);
      if (oneInItemUnit === null || !(oneInItemUnit > 0)) return null;
      return price / oneInItemUnit;
    }
    if (p.price === price) {
      const purchasedInItemUnit = toItemUnit(p.quantity, p.unit, item);
      // A zero/negative quantity would divide into Infinity or a negative
      // price; treat it as unrecoverable like any other bad row.
      if (purchasedInItemUnit === null || !(purchasedInItemUnit > 0)) return null;
      return price / purchasedInItemUnit;
    }
  }
  return null;
}

// Converts each ingredient's quantity into its linked item's unit and
// multiplies by that item's per-unit price from unitPriceFromLastPurchase.
// Anything that can't be priced is skipped and counted rather than guessed
// at: a volume-vs-weight pair (cups of flour against a flour item kept in
// kg) needs a density we don't have, and inventing a price for it would
// make the total look more precise than it is.
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
    if (ingredient.untracked) continue;
    const item = ingredient.inventoryItem;
    const unitPrice = item ? unitPriceFromLastPurchase(item) : null;
    const quantityInItemUnit = item ? toItemUnit(ingredient.quantity, ingredient.unit, item) : null;
    if (unitPrice === null || quantityInItemUnit === null) {
      skippedCount++;
      continue;
    }

    total += quantityInItemUnit * unitPrice;
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
