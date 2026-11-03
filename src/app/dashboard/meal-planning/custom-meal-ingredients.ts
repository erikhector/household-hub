import { parseSmartAddInput } from "@/lib/shopping/smart-add-suggestions";

// GAP-58: a custom meal ("Taco night") can list what it needs, one per line.
// Stored as the text the user typed (MealPlanEntry.freeformIngredients), so
// the form shows it back as written, and read with the smart-add line parser
// whenever the bridge needs rows.
export const MAX_FREEFORM_INGREDIENTS_LENGTH = 1000;

// Blank lines and trailing spaces dropped; null when nothing is left, so an
// emptied field clears the column rather than storing whitespace.
export function normalizeFreeformIngredients(raw: string | null | undefined): string | null {
  const lines = (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : null;
}

export type FreeformIngredient = { name: string; quantity: number; unit: string };

// "2 tortillas" -> 2 pcs, "salsa" -> 1 pcs (the parser's default when no
// quantity or unit was typed). Nothing scales these: a custom meal has no
// portions.
export function parseFreeformIngredients(text: string | null | undefined): FreeformIngredient[] {
  if (!text) return [];
  return parseSmartAddInput(text).map((row) => ({
    name: row.name,
    quantity: row.quantity,
    unit: row.unit ?? "pcs",
  }));
}
