// The unit side of one row in the recipe review (MATCH-3, design §3.3):
// how the recipe's unit relates to the chosen item's, and, when the item
// can't convert it, which of the three choices is picked with what amount.
// Pure, so the review step and the save's FormData agree on it and it's
// tested without a browser.

import { classifyUnits, type ItemUnitConversionLike, type UnitClass } from "@/lib/units";
import { conversionLeadUnit, unitConversionHint } from "@/lib/recipes/unit-hints";

export type UnitChoiceAction = "remember" | "override" | "defer";

// A conversion is between two amounts a kitchen actually uses, so a factor
// outside this range is a typo, never a real density. The save action
// enforces the same bounds; checking them here too flags the row inline
// instead of failing the whole save with a message that doesn't fit.
export const MIN_UNIT_FACTOR = 1e-6;
export const MAX_UNIT_FACTOR = 1e6;

/** The fields of a review row this reads (ReviewRow in
 * ingredient-review-step.tsx). */
export type UnitChoiceRow = {
  mode: "existing" | "new" | "untracked";
  selectedId: string;
  newName: string;
  newUnit: string;
  unit: string;
  quantity: number;
  needsReview: boolean;
  unitAction: UnitChoiceAction | null;
  rememberValue: string | null;
  overrideValue: string | null;
};

export type UnitChoiceItem = {
  id: string;
  name: string;
  unit: string;
  conversions?: readonly ItemUnitConversionLike[];
};

// Three significant digits: enough for a density or a piece weight, and
// short enough to read ("0.15", "2000", "0.0167").
const roundHint = (value: number) => String(Number(value.toPrecision(3)));

function positiveNumber(value: string): number | null {
  const number = Number(value.trim().replace(",", "."));
  return value.trim() && Number.isFinite(number) && number > 0 ? number : null;
}

export type RowUnitChoice = {
  /** What the pantry counts this in: the chosen item's unit, or the unit
   * the new item will get. Undefined when there's nothing to compare to. */
  pantryUnit: string | undefined;
  unitClass: UnitClass | null;
  action: "none" | UnitChoiceAction;
  /** Which unit "1 X = [n] Y" starts with. */
  leadUnit: string;
  otherUnit: string;
  /** Whether the "Remember" value is still the ≈ density hint. */
  fromHint: boolean;
  rememberValue: string;
  overrideValue: string;
  /** What the save action gets: 1 recipe unit = factor × pantry unit. */
  factor: number | null;
  overrideQuantity: number | null;
};

/**
 * The unit side of a row (MATCH-3, design §3.3): how its unit relates to
 * the item's, and, for an `unknown` one, which of the three choices is
 * picked with what amount. "Remember" is pre-selected and pre-filled when
 * the built-in density table has a hint for the item; otherwise "Decide
 * when cooking" is the default. A row that isn't up for review (a link
 * kept from an earlier edit) always defaults to deciding when cooking, so
 * a save never stores a guessed conversion nobody looked at.
 */
export function rowUnitChoice(row: UnitChoiceRow, items: readonly UnitChoiceItem[]): RowUnitChoice {
  const item = row.mode === "existing" ? items.find((candidate) => candidate.id === row.selectedId) : undefined;
  const pantryUnit = row.mode === "existing" ? item?.unit : row.mode === "new" ? row.newUnit.trim() || undefined : undefined;
  const unitClass = pantryUnit ? classifyUnits(row.unit, pantryUnit, item?.conversions) : null;

  const lead = pantryUnit ? conversionLeadUnit(row.unit, pantryUnit) : "recipe";
  const leadUnit = lead === "recipe" ? row.unit : (pantryUnit ?? "");
  const otherUnit = lead === "recipe" ? (pantryUnit ?? "") : row.unit;
  const itemName = row.mode === "existing" ? (item?.name ?? "") : row.newName;
  const hint = unitClass === "unknown" && pantryUnit ? unitConversionHint(itemName, row.unit, pantryUnit) : null;

  const fromHint = row.rememberValue === null && hint !== null;
  const rememberValue = row.rememberValue ?? (hint !== null ? roundHint(lead === "recipe" ? hint : 1 / hint) : "");
  const overrideValue = row.overrideValue ?? (hint !== null ? roundHint(row.quantity * hint) : "");
  const typed = positiveNumber(rememberValue);
  const perRecipeUnit = typed === null ? null : lead === "recipe" ? typed : 1 / typed;
  const factor =
    perRecipeUnit !== null && perRecipeUnit >= MIN_UNIT_FACTOR && perRecipeUnit <= MAX_UNIT_FACTOR
      ? perRecipeUnit
      : null;

  const action =
    unitClass !== "unknown"
      ? "none"
      : (row.unitAction ?? (hint !== null && row.needsReview ? "remember" : "defer"));
  return {
    pantryUnit,
    unitClass,
    action,
    leadUnit,
    otherUnit,
    fromHint,
    rememberValue,
    overrideValue,
    factor,
    overrideQuantity: positiveNumber(overrideValue),
  };
}
