// A small, fixed conversion table for the handful of metric/US measures
// recipes and inventory actually use (see KNOWN_UNITS in recipe-import.ts
// for the same vocabulary). This deliberately does NOT attempt to be a
// general unit system: volume and weight are never convertible into each
// other (that needs ingredient-specific density, e.g. cups of flour vs
// grams of flour), and count-style units ("pcs", "clove", "can", ...)
// aren't convertible into anything but themselves, since "1 clove" and
// "1 pcs" aren't the same amount of anything. Anything not listed here
// (an unrecognized unit) simply can't be converted — callers fall back to
// treating it as an exact string match, same as before this table existed.

type Dimension = "volume" | "weight";

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  tsk: 5,
  krm: 1,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  msk: 15,
  cup: 240,
  cups: 240,
  "fl oz": 30,
  floz: 30,
  pint: 473,
  pints: 473,
  quart: 946,
  quarts: 946,
  gallon: 3785,
  gallons: 3785,
};

const WEIGHT_TO_G: Record<string, number> = {
  mg: 0.001,
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6,
};

function normalize(unit: string): string {
  return unit.trim().toLowerCase();
}

// Spellings that mean exactly the same unit (MATCH-1): Swedish and English
// recipe text ("3 st ägg", "1 msk olja", "2 cloves garlic") and the units
// an inventory item stores ("pcs", "tbsp", "clove") should compare as
// equal, not merely as convertible, so a recipe written in Swedish never
// reads as a mismatch against an English-unit pantry. Units not listed map
// to themselves (lowercased, trimmed).
const UNIT_SYNONYMS: Record<string, string> = {
  st: "pcs",
  "st.": "pcs",
  stk: "pcs",
  styck: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  msk: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsk: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  cups: "cup",
  ounce: "oz",
  ounces: "oz",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  cloves: "clove",
  klyfta: "clove",
  klyftor: "clove",
  cans: "can",
  burk: "can",
  burkar: "can",
  packs: "pack",
  paket: "pack",
  förp: "pack",
  förpackning: "pack",
  slices: "slice",
  skiva: "slice",
  skivor: "slice",
  bunches: "bunch",
  knippe: "bunch",
  nypa: "pinch",
};

// Counted things rather than measured amounts (canonical spellings only).
// Never convertible into each other or into volume/weight — see the file
// comment.
const COUNT_UNITS = new Set(["pcs", "clove", "can", "pack", "slice", "bunch", "jar", "bag", "bottle", "box"]);

// Measures too small to stock by: a pantry buys a jar of cumin, not 3 tsp
// of it, so a new item created from one of these defaults to counting
// jars (see defaultNewItemUnit in src/lib/recipes/ingredient-match.ts).
const SPOON_UNITS = new Set(["tsp", "tbsp", "krm", "pinch"]);

/** The one spelling a unit is compared by: "st" → "pcs", "msk" → "tbsp",
 * "Liters" → "l". Unknown units come back lowercased and trimmed. */
export function canonicalUnit(unit: string): string {
  const key = normalize(unit);
  return UNIT_SYNONYMS[key] ?? key;
}

export type UnitKind = "count" | "spoon" | Dimension;

/** What kind of amount a unit measures, or null for an unrecognized unit.
 * "spoon" is a volume, split out because it's never how a pantry counts. */
export function unitKind(unit: string): UnitKind | null {
  const canonical = canonicalUnit(unit);
  if (COUNT_UNITS.has(canonical)) return "count";
  if (SPOON_UNITS.has(canonical)) return "spoon";
  return lookup(canonical)?.dimension ?? null;
}

/**
 * How a recipe's unit relates to the unit an inventory item is counted in
 * (MATCH-1, design §3.3):
 * - `same`: the same unit after canonicalizing ("st" and "pcs").
 * - `convertible`: the generic table converts between them ("dl" and "l").
 * - `unknown`: different dimensions, count vs measure, or an unrecognized
 *   unit. Cooking asks for the amount (MarkCookedDialog's unit mismatch).
 */
export type UnitClass = "same" | "convertible" | "unknown";

export function classifyUnits(recipeUnit: string, itemUnit: string): UnitClass {
  if (canonicalUnit(recipeUnit) === canonicalUnit(itemUnit)) return "same";
  if (convertQuantity(1, recipeUnit, itemUnit) !== null) return "convertible";
  return "unknown";
}

function lookup(unit: string): { dimension: Dimension; toBase: number } | null {
  const key = canonicalUnit(unit);
  if (key in VOLUME_TO_ML) return { dimension: "volume", toBase: VOLUME_TO_ML[key] };
  if (key in WEIGHT_TO_G) return { dimension: "weight", toBase: WEIGHT_TO_G[key] };
  return null;
}

// Converts `quantity` from `fromUnit` into the equivalent amount in
// `toUnit`. Returns null when either unit is unrecognized, or when they
// belong to different dimensions (e.g. volume vs weight) — there's no
// generally-correct conversion in that case, only an ingredient-specific
// one we don't have the data for.
export function convertQuantity(quantity: number, fromUnit: string, toUnit: string): number | null {
  // Synonyms ("st"/"pcs") are the same unit, so the amount is unchanged —
  // this also keeps callers that pair unitsAreComparable with
  // convertQuantity(...)! from ever getting null for a count synonym.
  if (canonicalUnit(fromUnit) === canonicalUnit(toUnit)) return quantity;
  const from = lookup(fromUnit);
  const to = lookup(toUnit);
  if (!from || !to || from.dimension !== to.dimension) return null;
  return (quantity * from.toBase) / to.toBase;
}

// Whether two unit strings denominate the same kind of quantity — either
// the same unit after canonicalizing synonyms ("st" and "pcs"), or two
// different but convertible units (e.g. "tbsp" and "l").
export function unitsAreComparable(a: string, b: string): boolean {
  return classifyUnits(a, b) !== "unknown";
}
