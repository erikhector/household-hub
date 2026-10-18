// Pure recipe-ingredient → inventory-item matching (MATCH-1, design
// docs/archive/RECIPE_INGREDIENT_MATCHING.md §3.2). Saving a recipe used to
// find-or-create an InventoryItem for every ingredient name that didn't
// match exactly, so "3 eggs" quietly became a zero-stock "eggs" next to the
// household's "Egg". This decides, per row, how sure we are about which
// item the ingredient means, so RecipeFormDialog's "Match ingredients"
// step only asks about the rows it isn't sure of, and skips itself
// entirely when every row is confident.
//
// Nothing here writes anything. The save action gets an explicit decision
// per row (use existing / create new / don't track) and never creates an
// item without one (resolveIngredientDecisions in
// meal-planning/recipe-actions.ts). MATCH-2 adds the household's learned
// aliases (ItemAlias) and a tiny built-in list of names that default to
// "Don't track".
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
import { canonicalUnit, classifyUnits, unitKind, type ItemUnitConversionLike, type UnitClass } from "@/lib/units";

export type IngredientMatchInput = {
  name: string;
  unit: string;
  /** The item this row was already linked to when an existing recipe was
   * opened for editing, carried through only while its name is unchanged. */
  linkedItemId?: string | null;
  /** The row was saved as "Don't track" and its name is unchanged (MATCH-2),
   * carried through the same way as `linkedItemId`. */
  untracked?: boolean;
};

/** A learned alias (ItemAlias, MATCH-2): `normalizedName` means that item,
 * or, with a null `inventoryItemId`, "never tracked". */
export type IngredientAlias = { normalizedName: string; inventoryItemId: string | null };

/** An inventory item to match against, with its saved unit conversions
 * (MATCH-3), so a row whose unit one of them covers is `known`, not
 * `unknown`. */
export type IngredientMatchItem = InventoryMatchCandidate & {
  unit: string;
  conversions?: readonly ItemUnitConversionLike[];
};

/**
 * - `confident`: linked before, an exact (normalized) name, a learned
 *   alias, or a fuzzy match above the AUTO-11 bar with a clear margin.
 *   Pre-accepted, but still one tap away in the review.
 * - `suggested`: a best guess (a plural/singular fold, a fuzzy score
 *   ≥ MATCH_PRESELECT_MIN_SCORE, or a tie between confident-looking items)
 *   is pre-selected, but the row is open.
 * - `none`: nothing close enough; the row defaults to "Create new".
 */
export type IngredientMatchStatus = "confident" | "suggested" | "none";

export type IngredientMatchSource = "linked" | "exact" | "alias" | "staple" | "plural" | "fuzzy";

export type IngredientMatch = {
  rowIndex: number;
  status: IngredientMatchStatus;
  itemId: string | null;
  /** Defaults to "Don't track" (MATCH-2): saved that way before, an
   * untracked alias, or a built-in staple. `itemId` is null when set. */
  untracked: boolean;
  source: IngredientMatchSource | null;
  /** Best-first ids to list at the top of the row's picker. */
  candidateIds: string[];
  /** How the recipe unit relates to the matched item's unit (§3.3); null
   * when there's no match. */
  unitClass: UnitClass | null;
};

/**
 * The ingredient name without a trailing parenthesized part: "gul lök
 * (finhackad)" → "gul lök". An imported row's prep text goes to its own
 * `note` (MATCH-2), but a row typed by hand can still carry it in that
 * form, so matching, aliases and the default name for "Create new" all
 * ignore it.
 */
export function ingredientBaseName(name: string): string {
  const stripped = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return stripped || name.trim();
}

// English -s/-es and Swedish -ar/-or/-er/-na on the last word (the head
// noun), as in the substitutions table, compared on both sides: "eggs" and
// "egg" fold together, and so do "tomater" and "tomat". A fold also
// over-generates onto words that merely end that way ("creamer" folds to
// "cream"), so a fold match is only ever a pre-selected suggestion, never
// confident, and a stem has to keep at least three letters. The item
// catalog's duplicate finder (MATCH-7) folds item names the same way.
const PLURAL_ENDINGS = ["es", "s", "ar", "or", "er", "na"];
const MIN_STEM_LENGTH = 3;

export function foldedForms(normalized: string): Set<string> {
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

// Decision 1 in the design (§7): only water and ice default to "Don't
// track". Anything else the household never wants tracked is learned as an
// untracked alias the first time they say so. Compared on the normalized
// name, so "Vatten" and "water." count; "kallt vatten" doesn't.
const UNTRACKED_STAPLES = new Set(["water", "vatten", "ice", "is"]);

// How many best-first candidates a row's picker lists above the rest.
const CANDIDATE_LIMIT = 5;

function matchOne(
  row: IngredientMatchInput,
  rowIndex: number,
  items: IngredientMatchItem[],
  itemsById: Map<string, IngredientMatchItem>,
  folded: { item: IngredientMatchItem; normalized: string; forms: Set<string> }[],
  aliases: Map<string, string | null>,
): IngredientMatch {
  const result = (
    status: IngredientMatchStatus,
    item: IngredientMatchItem | null,
    source: IngredientMatchSource | null,
    candidateIds: string[],
    untracked = false,
  ): IngredientMatch => ({
    rowIndex,
    status,
    itemId: item?.id ?? null,
    untracked,
    source,
    candidateIds,
    unitClass: item ? classifyUnits(row.unit, item.unit, item.conversions) : null,
  });

  const linked = row.linkedItemId ? itemsById.get(row.linkedItemId) : undefined;
  if (linked) return result("confident", linked, "linked", [linked.id]);
  if (row.untracked) return result("confident", null, "linked", [], true);

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

  // A learned alias is the household's own earlier answer, so it's as good
  // as an exact name. One whose item has since gone is ignored (the
  // cascade normally removes it first).
  const aliasItemId = aliases.get(normalized);
  if (aliasItemId === null) return result("confident", null, "alias", fuzzyIds, true);
  const aliasItem = aliasItemId ? itemsById.get(aliasItemId) : undefined;
  if (aliasItem) return result("confident", aliasItem, "alias", withFirst([aliasItem.id]));

  // A staple is only a default: the row stays open, so the first recipe
  // with water in it asks once, and that answer is learned as an alias.
  if (UNTRACKED_STAPLES.has(normalized)) return result("suggested", null, "staple", fuzzyIds, true);

  const rowForms = foldedForms(normalized);
  const byFold = folded.filter((entry) => intersects(rowForms, entry.forms)).map((entry) => entry.item);
  if (byFold.length > 0) return result("suggested", byFold[0], "plural", withFirst(byFold.map((item) => item.id)));

  const [best, runnerUp] = fuzzy;
  if (!best) return result("none", null, null, []);
  const clearWinner = !runnerUp || best.score - runnerUp.score >= MATCH_AUTO_ACCEPT_MIN_MARGIN;
  const status = best.score >= MATCH_AUTO_ACCEPT_MIN_SCORE && clearWinner ? "confident" : "suggested";
  return result(status, itemsById.get(best.id)!, "fuzzy", fuzzyIds);
}

/** Matches every recipe row against the household's inventory and learned
 * aliases, in order. */
export function matchIngredientRows(
  rows: IngredientMatchInput[],
  items: IngredientMatchItem[],
  aliases: IngredientAlias[] = [],
): IngredientMatch[] {
  const aliasMap = new Map(aliases.map((alias) => [alias.normalizedName, alias.inventoryItemId]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const folded = items.map((item) => {
    const normalized = normalizeItemName(item.name);
    return { item, normalized, forms: foldedForms(normalized) };
  });
  return rows.map((row, index) => matchOne(row, index, items, itemsById, folded, aliasMap));
}

/**
 * Whether a row has to be shown in the review step. A confident name match
 * isn't enough on its own: the unit must also reconcile (the same unit, the
 * generic table, or one of the item's saved conversions), or cooking will
 * hit a unit mismatch every time. The exception is a row that was already
 * linked when the recipe was opened for editing — the user matched it
 * before and chose then how to handle its unit ("Decide when cooking" is a
 * valid answer), so asking again on every edit would only nag.
 */
export function ingredientNeedsReview(match: IngredientMatch): boolean {
  if (match.status !== "confident") return true;
  return match.unitClass === "unknown" && match.source !== "linked";
}

/**
 * What the "Match ingredients" step starts a row on (UX-90). A suggestion
 * is a guess, and one tap on "Create recipe" must never save a guess as a
 * link: a loose fuzzy hit (Rice → Ricotta, Cream → Breadcrumbs) or a
 * plural fold that only looks like one (cream → creamer) would otherwise
 * feed the missing list and "Mark as cooked" with the wrong item. So only
 * a confident match, or a name that exactly equals more than one item
 * (which of the twins is the open question), starts on "Use existing"; a
 * weaker suggestion starts on "Create new" and needs a tap to accept.
 * `selectedId` still carries the suggestion, so that tap lands on the
 * item the matcher guessed instead of an empty picker.
 */
export function defaultReviewChoice(match: IngredientMatch): {
  mode: "existing" | "new" | "untracked";
  selectedId: string;
} {
  const selectedId = match.itemId ?? "";
  if (match.untracked) return { mode: "untracked", selectedId };
  if (!match.itemId) return { mode: "new", selectedId };
  const trusted = match.status === "confident" || match.source === "exact";
  return { mode: trusted ? "existing" : "new", selectedId };
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
