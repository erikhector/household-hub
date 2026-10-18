import { canonicalUnit } from "@/lib/units";

// UX-119: how far one −/+ tap moves an item's quantity, and which amounts the
// "I used some / I bought more" sheet offers as one-tap chips. A flat 1 suits
// "3 pcs" but turns Smör 500 g into 499 g and Gul lök 1.5 kg into 0.5 kg, so
// weights and volumes step by an amount a person actually weighs out.
// Keyed by canonical unit ("gram" and "grams" are "g"); anything else,
// including a custom unit, keeps the old step of 1.
const STEPS: Record<string, { step: number; presets: number[] }> = {
  g: { step: 50, presets: [100, 200, 500] },
  ml: { step: 50, presets: [100, 200, 500] },
  kg: { step: 0.25, presets: [0.25, 0.5, 1] },
  l: { step: 0.25, presets: [0.25, 0.5, 1] },
};
const DEFAULT = { step: 1, presets: [1, 2, 5] };

export function quantityStep(unit: string): number {
  return (STEPS[canonicalUnit(unit)] ?? DEFAULT).step;
}

export function quantityPresets(unit: string): number[] {
  return (STEPS[canonicalUnit(unit)] ?? DEFAULT).presets;
}

/**
 * A typed amount as a positive number, or null when it isn't one. Accepts
 * a decimal comma ("0,5"), the keypad most Swedish phones show. Rounded to
 * the 2 decimals the item schema stores.
 */
export function parseAmount(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  if (!raw.trim() || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? rounded : null;
}
