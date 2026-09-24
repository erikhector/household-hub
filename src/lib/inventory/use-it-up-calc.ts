// "Use it up" recipe suggestions (BACKLOG GAP-1) — Grocy's headline feature:
// surface recipes whose ingredients overlap with what's expiring soon or
// already running low, instead of only listing every recipe flat. This is
// deliberately a *partial*-overlap ranking, distinct from
// src/app/dashboard/meal-planning/cookable-recipes.ts' "what can I cook right
// now" (full-match, at most a couple of ingredients missing): a recipe can
// rank here even with plenty of *other* missing ingredients, as long as it
// uses at least one item that's still on hand but about to be wasted or run
// out (see reasonFor's quantity gate below — you can't "use up" something
// you already have none of). Read-only —
// this never creates a meal-plan entry or touches inventory (BACKLOG.md's
// Guardrails); it only feeds a dismissible suggestion chip, same spirit as
// MealVarietyRecap.

import type { ExpiryStatus } from "@/lib/inventory/expiry";
import type { StockStatus } from "@/lib/stock-status";

// One inventory item worth working into tonight's cooking — expiring
// (expired or "soon", see getExpiryStatus) counts the same as running low
// (getStockStatus): both mean "use this before it's wasted or someone has to
// make a special trip to replace it." `quantity` is carried through (rather
// than folded into `stockStatus` beforehand) because reasonFor below has to
// gate on it directly — see its comment.
export type FlaggedInventoryItem = {
  id: string;
  name: string;
  quantity: number;
  expiryStatus: ExpiryStatus;
  stockStatus: StockStatus;
};

export type UseItUpReason = "expiring" | "lowStock";

// One ingredient match backing a suggestion, named for the UI's "uses N
// things expiring soon" chip text rather than for a shopping-list-style
// diff.
export type UseItUpMatch = {
  name: string;
  reason: UseItUpReason;
};

export type UseItUpSuggestion = {
  recipeId: string;
  recipeName: string;
  // Sorted by name, deduplicated per matched inventory item — see the dedupe
  // note below.
  matches: UseItUpMatch[];
};

export type RecipeIngredientRef = {
  name: string;
  // The linked InventoryItem's id, when the ingredient row has one — see
  // RecipeIngredient.inventoryItemId in schema.prisma. Null falls back to a
  // case-insensitive name match against `flaggedItems`, the same loose-match
  // fallback getCookableRecipes uses for an ingredient whose link was
  // cleared by a since-deleted inventory item (the relation is
  // `onDelete: SetNull`).
  inventoryItemId: string | null;
};

export type RecipeForUseItUp = {
  recipeId: string;
  recipeName: string;
  ingredients: RecipeIngredientRef[];
};

// Beyond this many suggestions, the chip row would crowd out whatever tab it
// sits above instead of reading as a quick nudge — same "keep it short and
// actionable" reasoning as MAX_MISSING_TO_SURFACE in cookable-recipes.ts.
const MAX_SUGGESTIONS = 5;

// An item that's both about to go off *and* running low is reported as
// "expiring" — the more urgent framing, and the one the "use it before it's
// wasted" pitch is actually about.
//
// Zero (or negative) on hand is excluded from *both* reasons — there's
// nothing left to cook with, so "use it up" is backwards; that gap belongs
// to the shopping-list bridge, not this feature. This isn't just a
// theoretical edge case: every ingredient auto-created via
// parseIngredientRows/addMissingIngredientsToShoppingListAction starts at
// quantity 0 with lowStockThreshold 0 (see recipe-actions.ts), which makes
// it "out" from the moment it's created. Without this gate, almost any
// recipe with a freshly-added ingredient would misleadingly show up here —
// caught in PR review, see the use-it-up-calc.test.ts cases for both
// reasons.
function reasonFor(item: FlaggedInventoryItem): UseItUpReason | null {
  if (item.quantity <= 0) return null;
  if (item.expiryStatus !== null) return "expiring";
  // getStockStatus can't return "out" once quantity > 0 is already
  // guaranteed above, so "low" is the only remaining low-stock case.
  if (item.stockStatus === "low") return "lowStock";
  return null;
}

// Pure ranking step — unit-tested directly (see use-it-up-calc.test.ts).
// Ingredient resolution mirrors getCookableRecipes: prefer the linked
// InventoryItem id, fall back to a case-insensitive name match.
export function computeUseItUpSuggestions(
  recipes: RecipeForUseItUp[],
  flaggedItems: FlaggedInventoryItem[],
): UseItUpSuggestion[] {
  const byId = new Map(flaggedItems.map((item) => [item.id, item]));
  const byName = new Map(flaggedItems.map((item) => [item.name.toLowerCase(), item]));

  const suggestions: UseItUpSuggestion[] = [];

  for (const recipe of recipes) {
    // Dedupe by matched item id so a recipe that lists the same ingredient
    // across two rows (or two ingredient rows that loose-match the same
    // inventory item) doesn't inflate its match count.
    const matchedByItemId = new Map<string, UseItUpMatch>();

    for (const ingredient of recipe.ingredients) {
      const item =
        (ingredient.inventoryItemId ? byId.get(ingredient.inventoryItemId) : undefined) ??
        byName.get(ingredient.name.toLowerCase());
      if (!item) continue;

      const reason = reasonFor(item);
      if (!reason) continue;

      matchedByItemId.set(item.id, { name: item.name, reason });
    }

    if (matchedByItemId.size === 0) continue;

    const matches = [...matchedByItemId.values()].sort((a, b) => a.name.localeCompare(b.name));
    suggestions.push({ recipeId: recipe.recipeId, recipeName: recipe.recipeName, matches });
  }

  // Product call (PR #24 review): keep low-stock as a suggestion reason
  // rather than dropping it — a slowly-dwindling item is a legitimate "use
  // this before you're out" signal, not just noise — but rank a suggestion
  // that includes an *expiring* match ahead of a same-size one that's
  // low-stock-only. Using something up that's already low makes it run out
  // even sooner, so on a tie that's the less urgent of the two reasons.
  const hasExpiringMatch = (matches: UseItUpMatch[]) => matches.some((match) => match.reason === "expiring");

  return suggestions
    .sort(
      (a, b) =>
        b.matches.length - a.matches.length ||
        Number(hasExpiringMatch(b.matches)) - Number(hasExpiringMatch(a.matches)) ||
        a.recipeName.localeCompare(b.recipeName),
    )
    .slice(0, MAX_SUGGESTIONS);
}
