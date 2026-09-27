// Typical densities and piece weights for a short list of staples (MATCH-3,
// design §3.3, product decision 2 in §7). When a recipe measures something
// the pantry counts differently ("300 g vetemjöl" against flour kept in dl,
// "3 eggs" against eggs kept in g), the review's "Remember for this item"
// choice is pre-filled from here, shown with "≈" like an estimated expiry
// date. It is only ever a starting value the user can change: nothing is
// converted with it unless they save it as the item's own conversion.
//
// Deliberately short. A real food-density database would be more complete,
// but every entry here is a guess that ends up in someone's stock count, so
// only staples whose typical value is well known (and doesn't vary much by
// brand) are listed. Anything else starts empty.

import { normalizeItemName } from "@/lib/item-matching";
import { canonicalUnit, convertQuantity, unitKind } from "@/lib/units";

type StapleHint = {
  // Normalized names (normalizeItemName) in English and Swedish, including
  // the plural a pantry item is often called by.
  names: string[];
  // Grams per millilitre, for anything measured by volume.
  gramsPerMl?: number;
  // Grams per piece, for anything counted.
  gramsPerPiece?: number;
};

const STAPLE_HINTS: StapleHint[] = [
  { names: ["flour", "wheat flour", "vetemjöl", "mjöl"], gramsPerMl: 0.6 },
  { names: ["sugar", "socker", "strösocker"], gramsPerMl: 0.85 },
  { names: ["icing sugar", "powdered sugar", "florsocker"], gramsPerMl: 0.5 },
  { names: ["rice", "ris"], gramsPerMl: 0.85 },
  { names: ["oats", "rolled oats", "havregryn"], gramsPerMl: 0.35 },
  { names: ["butter", "smör"], gramsPerMl: 0.95 },
  { names: ["milk", "mjölk"], gramsPerMl: 1.03 },
  { names: ["cream", "grädde", "vispgrädde"], gramsPerMl: 1 },
  { names: ["salt"], gramsPerMl: 1.2 },
  { names: ["honey", "honung"], gramsPerMl: 1.4 },
  { names: ["oil", "olive oil", "rapeseed oil", "olja", "olivolja", "rapsolja"], gramsPerMl: 0.92 },
  { names: ["cocoa", "kakao"], gramsPerMl: 0.45 },
  { names: ["egg", "eggs", "ägg"], gramsPerPiece: 55 },
  { names: ["onion", "onions", "yellow onion", "lök", "gul lök"], gramsPerPiece: 150 },
  { names: ["red onion", "rödlök"], gramsPerPiece: 100 },
  { names: ["potato", "potatoes", "potatis"], gramsPerPiece: 150 },
  { names: ["carrot", "carrots", "morot", "morötter"], gramsPerPiece: 70 },
  { names: ["tomato", "tomatoes", "tomat", "tomater"], gramsPerPiece: 100 },
  { names: ["apple", "apples", "äpple", "äpplen"], gramsPerPiece: 150 },
  { names: ["lemon", "lemons", "citron", "citroner"], gramsPerPiece: 120 },
  { names: ["banana", "bananas", "banan", "bananer"], gramsPerPiece: 120 },
];

const HINTS_BY_NAME = new Map(STAPLE_HINTS.flatMap((hint) => hint.names.map((name) => [name, hint] as const)));

// One unit of `unit` in grams for this staple, or null when the hint
// doesn't cover that kind of unit (a piece weight for "dl", say).
function gramsPerUnit(unit: string, hint: StapleHint): number | null {
  const weight = convertQuantity(1, unit, "g");
  if (weight !== null) return weight;
  const volume = convertQuantity(1, unit, "ml");
  if (volume !== null) return hint.gramsPerMl ? volume * hint.gramsPerMl : null;
  if (canonicalUnit(unit) === "pcs") return hint.gramsPerPiece ?? null;
  return null;
}

/**
 * A typical factor for the item's conversion, "1 `recipeUnit` ≈ factor ×
 * `itemUnit`", when `itemName` is one of the staples and the hint covers
 * both units (through grams). Null otherwise, including when the generic
 * table already converts the two units and no conversion is needed.
 */
export function unitConversionHint(itemName: string, recipeUnit: string, itemUnit: string): number | null {
  if (convertQuantity(1, recipeUnit, itemUnit) !== null) return null;
  const hint = HINTS_BY_NAME.get(normalizeItemName(itemName));
  if (!hint) return null;
  const fromGrams = gramsPerUnit(recipeUnit, hint);
  const toGrams = gramsPerUnit(itemUnit, hint);
  if (!fromGrams || !toGrams) return null;
  return fromGrams / toGrams;
}

/**
 * Which unit the review's "Remember" sentence starts with, "1 X = [n] Y",
 * so `n` reads as the number people know rather than its reciprocal:
 * "1 pcs = 2000 g" for flour counted in bags, "1 pcs = 55 g" for an egg,
 * "1 dl = 60 g" for flour weighed in grams. The item's unit goes first when
 * it's a count (how much one of what the pantry holds is), or a volume
 * against a recipe weight ("1 l = 1030 g"); otherwise the recipe's unit
 * does. The saved factor is always "1 recipe unit = factor × item unit",
 * whichever way round it was typed.
 */
export function conversionLeadUnit(recipeUnit: string, itemUnit: string): "recipe" | "item" {
  const itemKind = unitKind(itemUnit);
  if (itemKind === "count") return "item";
  const recipeKind = unitKind(recipeUnit);
  if (recipeKind === "weight" && (itemKind === "volume" || itemKind === "spoon")) return "item";
  return "recipe";
}
