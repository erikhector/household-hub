import { unitKind } from "@/lib/units";

// "Check stock" (GAP-69): the manual counterpart of the AI shelf scan's
// restock mode. These are the pure parts of the walk-through (which items,
// in what order, what a typed amount means), so the dialog stays thin and the
// rules are unit-tested. Saving goes through bulkSetInventoryQuantitiesAction
// as counted values, never deltas.

export type StockCheckItem = { id: string; name: string; quantity: number; unit: string; location: string | null };

/** The items to walk: one location's, or everything when `location` is null,
 * sorted by name so the walk is predictable. Every item counts, including
 * ones at 0, since "I thought we were out" is exactly what a check finds. */
export function buildStockCheckQueue<T extends StockCheckItem>(items: readonly T[], location: string | null): T[] {
  return items
    .filter((item) => location === null || item.location === location)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** What a typed amount means. `kept` for a blank field or the same number
 * (nothing to save), `invalid` for text that isn't an amount of 0 or more. */
export type CountedAmount = { kind: "kept" } | { kind: "changed"; quantity: number } | { kind: "invalid" };

export function readCountedAmount(current: number, typed: string): CountedAmount {
  const text = typed.trim().replace(",", ".");
  if (text === "") return { kind: "kept" };
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity < 0) return { kind: "invalid" };
  return quantity === current ? { kind: "kept" } : { kind: "changed", quantity };
}

/** The on-screen keyboard for a unit: whole pieces get the digit pad, weights
 * and volumes the decimal one. A piece count already holding a fraction
 * (1.5 pcs) keeps the decimal pad so it can be corrected. */
export function inputModeForUnit(unit: string, current: number): "numeric" | "decimal" {
  return unitKind(unit) === "count" && Number.isInteger(current) ? "numeric" : "decimal";
}

export type StockCheckStepResult<R> =
  | { kind: "kept" }
  | { kind: "invalid" }
  | { kind: "corrected"; quantity: number; result: R };

/** One "Correct, next" step: a changed amount is handed to `save` (the
 * dialog passes bulkSetInventoryQuantitiesAction, which takes counted values
 * and scopes them to the session household); an unchanged one is not sent at
 * all, so confirming a correct amount costs no write and no side effects. */
export async function confirmStockCheckStep<R>(
  item: Pick<StockCheckItem, "id" | "quantity">,
  typed: string,
  save: (updates: { itemId: string; quantity: number }[]) => Promise<R>,
): Promise<StockCheckStepResult<R>> {
  const counted = readCountedAmount(item.quantity, typed);
  if (counted.kind !== "changed") return { kind: counted.kind };
  const result = await save([{ itemId: item.id, quantity: counted.quantity }]);
  return { kind: "corrected", quantity: counted.quantity, result };
}
