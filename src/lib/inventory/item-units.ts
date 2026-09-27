// The item page's unit maths (MATCH-6, design §6.1): each recipe amount
// restated in the item's own unit, how a saved conversion reads, and what
// "Change unit…" does to the stock, the low-stock threshold and the saved
// conversions. Pure, so the page, the dialog's preview and the Server
// Action all agree on it and it's tested without a database.

import { canonicalUnit, convertForItem, convertQuantity, type ItemUnitConversionLike } from "@/lib/units";
import { conversionLeadUnit } from "@/lib/recipes/unit-hints";
import { MAX_UNIT_FACTOR, MIN_UNIT_FACTOR } from "@/lib/recipes/unit-choice";

export const isFactorInRange = (factor: number) =>
  Number.isFinite(factor) && factor >= MIN_UNIT_FACTOR && factor <= MAX_UNIT_FACTOR;

// Ten significant digits: enough to keep every real amount exact while
// dropping float drift (0.1 × 3 = 0.30000000000000004), so a stock of
// "1.5 l" changed to dl is stored as 15, not 15.000000000000002. Not the
// item form's two decimals: "5 g" in kg is 0.005 and must not become 0.
export const roundAmount = (value: number) => Number(value.toPrecision(10));

export type UsedInIngredient = {
  id: string;
  recipeId: string;
  recipeName: string;
  quantity: number;
  unit: string;
};

export type UsedInRow = UsedInIngredient & {
  /** The same amount in the item's unit, or null (⚠) when neither the
   * generic table nor the item's conversions reach the recipe's unit. */
  converted: number | null;
};

/** Every recipe row linked to the item, with its amount in the item's own
 * unit through `convertForItem` (the same conversion cooking, the shopping
 * bridge and the cost use), sorted by recipe name. */
export function usedInRows(
  ingredients: readonly UsedInIngredient[],
  item: { unit: string },
  conversions: readonly ItemUnitConversionLike[],
): UsedInRow[] {
  return ingredients
    .map((ingredient) => ({
      ...ingredient,
      converted: convertForItem(ingredient.quantity, ingredient.unit, item, conversions),
    }))
    .sort((a, b) => a.recipeName.localeCompare(b.recipeName));
}

export type ConversionSentence = { leadUnit: string; amount: number; otherUnit: string };

/**
 * How a saved conversion ("1 `fromUnit` = `factor` × item unit") reads on
 * the page, in the direction people know the number: "1 pcs = 2000 g" for
 * flour counted in bags rather than "1 g = 0.0005 pcs". Same rule as the
 * recipe review's "Remember" sentence (`conversionLeadUnit`).
 */
export function conversionSentence(fromUnit: string, factor: number, itemUnit: string): ConversionSentence {
  return conversionLeadUnit(fromUnit, itemUnit) === "item"
    ? { leadUnit: itemUnit, amount: roundAmount(1 / factor), otherUnit: fromUnit }
    : { leadUnit: fromUnit, amount: roundAmount(factor), otherUnit: itemUnit };
}

/** The saved factor (per `fromUnit`) for an amount typed into the
 * sentence "1 lead = [amount] other", or null when it isn't a positive
 * number within the factor bounds. */
export function factorFromSentence(fromUnit: string, itemUnit: string, typed: string): number | null {
  const amount = Number(typed.trim().replace(",", "."));
  if (!typed.trim() || !Number.isFinite(amount) || amount <= 0) return null;
  const factor = conversionLeadUnit(fromUnit, itemUnit) === "item" ? 1 / amount : amount;
  return isFactorInRange(factor) ? factor : null;
}

export type ConversionProblem = "empty" | "ownUnit" | "generic";

/**
 * Why a conversion from `fromUnit` can't be saved for an item counted in
 * `itemUnit`, or null when it can: a conversion from the item's own unit
 * would be 1 = 1, and one the generic table already converts ("kg" on an
 * item counted in g) is never consulted by `convertForItem`, so saving it
 * would only mislead.
 */
export function conversionProblem(fromUnit: string, itemUnit: string): ConversionProblem | null {
  if (!canonicalUnit(fromUnit)) return "empty";
  if (canonicalUnit(fromUnit) === canonicalUnit(itemUnit)) return "ownUnit";
  if (convertQuantity(1, fromUnit, itemUnit) !== null) return "generic";
  return null;
}

export type UnitChangeItem = {
  unit: string;
  quantity: number;
  lowStockThreshold: number;
  conversions: readonly ItemUnitConversionLike[];
};

export type UnitChangePlan = {
  unit: string;
  quantity: number;
  lowStockThreshold: number;
  /** The item's whole set of conversions afterwards, canonical `fromUnit`. */
  conversions: { fromUnit: string; factor: number }[];
};

export type UnitChangeProblem = "sameUnit" | "emptyUnit" | "factor" | "conversionRange";

/**
 * "Change unit…" (design §6.1): the item goes from its unit to `newUnit`,
 * with 1 old unit = `factor` new units ("1 pcs = 2000 g" → 2000). Stock
 * and threshold are multiplied by it. A saved "1 X = c old" becomes
 * "1 X = c × factor new" (the design writes this as ÷ with the factor the
 * other way round). A conversion the new unit makes pointless is dropped:
 * one from the new unit itself, or one the generic table now converts.
 * The old unit becomes a conversion, so recipes and lists written in it
 * keep working. Prices aren't touched (they're per purchase line).
 */
export function planUnitChange(
  item: UnitChangeItem,
  newUnit: string,
  factor: number,
): { plan: UnitChangePlan } | { problem: UnitChangeProblem } {
  const unit = newUnit.trim();
  if (!canonicalUnit(unit)) return { problem: "emptyUnit" };
  if (canonicalUnit(unit) === canonicalUnit(item.unit)) return { problem: "sameUnit" };
  if (!isFactorInRange(factor)) return { problem: "factor" };

  const kept = item.conversions
    .filter((conversion) => convertQuantity(1, conversion.fromUnit, unit) === null)
    .filter((conversion) => canonicalUnit(conversion.fromUnit) !== canonicalUnit(item.unit))
    .map((conversion) => ({
      fromUnit: canonicalUnit(conversion.fromUnit),
      factor: roundAmount(conversion.factor * factor),
    }));
  if (kept.some((conversion) => !isFactorInRange(conversion.factor))) return { problem: "conversionRange" };

  return {
    plan: {
      unit,
      quantity: roundAmount(item.quantity * factor),
      lowStockThreshold: roundAmount(item.lowStockThreshold * factor),
      conversions: [...kept, { fromUnit: canonicalUnit(item.unit), factor: roundAmount(factor) }],
    },
  };
}

/** The dialog's starting factor: what the generic table says 1 old unit
 * is in the new one ("l" → "dl" = 10), else what a saved conversion from
 * the new unit implies ("1 g = 0.0005 pcs" → 1 pcs = 2000 g), else null
 * for the user to fill in. */
export function suggestedUnitChangeFactor(
  itemUnit: string,
  newUnit: string,
  conversions: readonly ItemUnitConversionLike[],
): number | null {
  if (!newUnit.trim()) return null;
  const generic = convertQuantity(1, itemUnit, newUnit);
  if (generic !== null) return generic;
  const perNew = convertForItem(1, newUnit, { unit: itemUnit }, conversions);
  return perNew !== null && perNew > 0 ? roundAmount(1 / perNew) : null;
}
