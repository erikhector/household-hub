// Pure recipe-ingredient → inventory-item matching (MATCH-1, design
// docs/RECIPE_INGREDIENT_MATCHING.md §3.2). Saving a recipe used to
// find-or-create an InventoryItem for every ingredient name that didn't
// match exactly, so "3 eggs" quietly became a zero-stock "eggs" next to the
// household's "Egg". This decides, per row, how sure we are about which
// item the ingredient means, so RecipeFormDialog's "Match ingredients"
// step only asks about the rows it isn't sure of, and skips itself
// entirely when every row is confident.
//
// Nothing here writes anything. The save action gets an explicit decision
// per row (use existing / create new) and never creates an item without
// one (resolveIngredientDecisions in meal-planning/recipe-actions.ts).
//
// Dependency-free (bar the other pure helpers), so the preview action and
// the tests run it the same way.

import {
  findInventoryMatches,
  MATCH_AUTO_ACCEPT_MIN_MARGIN,
  MATCH_AUTO_ACCEPT_MIN_SCORE,
  MATCH_PRESELECT_MIN_SCORE,
  normalizeItemName,
  type InventoryMatchCandidate,
} from "@/lib/item-matching";
import { canonicalUnit, classifyUnits, unitKind, type UnitClass } from "@/lib/units";

export type IngredientMatchInput = {
  name: string;
  unit: string;
  /** The item this row was already linked to when an existing recipe was
   * opened for editing, carried through only while its name is unchanged. */
  linkedItemId?: string | null;
};

export type IngredientMatchItem = InventoryMatchCandidate & { unit: string };

/**
 * - `confident`: linked before, an exact (normalized) name, a single
 *   plural/singular fold, or a fuzzy match above the AUTO-11 bar with a
 *   clear margin. Pre-accepted, but still one tap away in the review.
 * - `suggested`: a best guess (≥ MATCH_PRESELECT_MIN_SCORE, or a tie
 *   between confident-looking items) is pre-selected, but the row is open.
 * - `none`: nothing close enough; the row defaults to "Create new".
 */
export type IngredientMatchStatus = "confident" | "suggested" | "none";

export type IngredientMatchSource = "linked" | "exact" | "plural" | "fuzzy";

export type IngredientMatch = {
  rowIndex: number;
  status: IngredientMatchStatus;
  itemId: string | null;
  source: IngredientMatchSource | null;
  /** Best-first ids to list at the top of the row's picker. */
  candidateIds: string[];
  /** How the recipe unit relates to the matched item's unit (§3.3); null
   * when there's no match. */
  unitClass: UnitClass | null;
};

/**
 * The ingredient name without a trailing parenthesized part: "gul lök
 * (finhackad)" → "gul lök". Until MATCH-2 adds a note column the parser
 * (MATCH-4) keeps prep text in that form, so matching and the default name
 * for "Create new" both ignore it.
 */
export function ingredientBaseName(name: string): string {
  const stripped = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return stripped || name.trim();
}

// English -s/-es and Swedish -ar/-or/-er/-na on the last word (the head
// noun), as in the substitutions table, compared on both sides: "eggs" and
// "egg" fold together, and so do "tomater" and "tomat". A fold can
// over-generate onto a word that merely ends that way, so a fold match is
// only confident when exactly one item folds to the same form, and a stem
// has to keep at least three letters.
const PLURAL_ENDINGS = ["es", "s", "ar", "or", "er", "na"];
const MIN_STEM_LENGTH = 3;

function foldedForms(normalized: string): Set<string> {
  const forms = new Set([normalized]);
  const lastSpace = normalized.lastIndexOf(" ");
  const head = normalized.slice(0, lastSpace + 1);
  const last = normalized.slice(lastSpace + 1);
  for (const ending of PLURAL_ENDINGS) {
    if (last.endsWith(ending) && last.length - ending.length >= MIN_STEM_LENGTH) {
      forms.add(head + last.slice(0, -ending.length));
    }
  }
  return forms;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

// How many best-first candidates a row's picker lists above the rest.
const CANDIDATE_LIMIT = 5;

function matchOne(
  row: IngredientMatchInput,
  rowIndex: number,
  items: IngredientMatchItem[],
  itemsById: Map<string, IngredientMatchItem>,
  folded: { item: IngredientMatchItem; normalized: string; forms: Set<string> }[],
): IngredientMatch {
  const result = (
    status: IngredientMatchStatus,
    item: IngredientMatchItem | null,
    source: IngredientMatchSource | null,
    candidateIds: string[],
  ): IngredientMatch => ({
    rowIndex,
    status,
    itemId: item?.id ?? null,
    source,
    candidateIds,
    unitClass: item ? classifyUnits(row.unit, item.unit) : null,
  });

  const linked = row.linkedItemId ? itemsById.get(row.linkedItemId) : undefined;
  if (linked) return result("confident", linked, "linked", [linked.id]);

  const baseName = ingredientBaseName(row.name);
  const normalized = normalizeItemName(baseName);
  const fuzzy = findInventoryMatches(baseName, items, {
    limit: CANDIDATE_LIMIT,
    minScore: MATCH_PRESELECT_MIN_SCORE,
  });
  const fuzzyIds = fuzzy.map((match) => match.id);
  // Exact and fold hits go first in the picker, then the fuzzy ranking.
  const withFirst = (ids: string[]) => [...new Set([...ids, ...fuzzyIds])].slice(0, CANDIDATE_LIMIT);

  const exact = folded.filter((entry) => entry.normalized === normalized).map((entry) => entry.item);
  if (exact.length === 1) return result("confident", exact[0], "exact", withFirst([exact[0].id]));
  // Two items with the same name ("Mjölk" and "mjölk."): which one is a
  // genuine choice, so pre-select the first and leave it open.
  if (exact.length > 1) return result("suggested", exact[0], "exact", withFirst(exact.map((item) => item.id)));

  const rowForms = foldedForms(normalized);
  const byFold = folded.filter((entry) => intersects(rowForms, entry.forms)).map((entry) => entry.item);
  if (byFold.length === 1) return result("confident", byFold[0], "plural", withFirst([byFold[0].id]));
  if (byFold.length > 1) return result("suggested", byFold[0], "plural", withFirst(byFold.map((item) => item.id)));

  const [best, runnerUp] = fuzzy;
  if (!best) return result("none", null, null, []);
  const clearWinner = !runnerUp || best.score - runnerUp.score >= MATCH_AUTO_ACCEPT_MIN_MARGIN;
  const status = best.score >= MATCH_AUTO_ACCEPT_MIN_SCORE && clearWinner ? "confident" : "suggested";
  return result(status, itemsById.get(best.id)!, "fuzzy", fuzzyIds);
}

/** Matches every recipe row against the household's inventory, in order. */
export function matchIngredientRows(
  rows: IngredientMatchInput[],
  items: IngredientMatchItem[],
): IngredientMatch[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const folded = items.map((item) => {
    const normalized = normalizeItemName(item.name);
    return { item, normalized, forms: foldedForms(normalized) };
  });
  return rows.map((row, index) => matchOne(row, index, items, itemsById, folded));
}

/**
 * Whether a row has to be shown in the review step. A confident name match
 * isn't enough on its own: the unit must also reconcile, or cooking will
 * hit a unit mismatch every time. The exception is a row that was already
 * linked when the recipe was opened for editing — the user matched it
 * before, and with no way yet to remember a per-item conversion (MATCH-3)
 * asking again on every edit would change nothing.
 */
export function ingredientNeedsReview(match: IngredientMatch): boolean {
  if (match.status !== "confident") return true;
  return match.unitClass === "unknown" && match.source !== "linked";
}

/**
 * The unit a new inventory item starts with when it's created from a
 * recipe row (design §3.3). Pantries count things differently from how
 * recipes measure them: a count unit stays as it is (canonicalized), any
 * other volume becomes litres and any weight grams, and spoon measures
 * become pieces, because you buy a jar of spice, not 3 tsp of it. An
 * unrecognized unit also falls back to pieces. Always editable.
 */
export function defaultNewItemUnit(recipeUnit: string): string {
  switch (unitKind(recipeUnit)) {
    case "count":
      return canonicalUnit(recipeUnit);
    case "volume":
      return "l";
    case "weight":
      return "g";
    default:
      return "pcs";
  }
}
