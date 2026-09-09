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

function lookup(unit: string): { dimension: Dimension; toBase: number } | null {
  const key = normalize(unit);
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
  const from = lookup(fromUnit);
  const to = lookup(toUnit);
  if (!from || !to || from.dimension !== to.dimension) return null;
  return (quantity * from.toBase) / to.toBase;
}

// Whether two unit strings denominate the same kind of quantity — either
// literally the same unit (case/whitespace-insensitive), or two different
// but convertible units (e.g. "tbsp" and "l").
export function unitsAreComparable(a: string, b: string): boolean {
  return normalize(a) === normalize(b) || convertQuantity(1, a, b) !== null;
}
