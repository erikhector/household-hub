// Possible duplicates in the item catalog (MATCH-7, design §6.3): which
// pantry items are probably the same thing ("Egg" / "eggs" / "Ägg"), in
// groups, each with a suggested keeper. Pure, so the catalog page, the
// inventory page's "Manage items" badge and the tests all agree on it.

import { itemNameSimilarity, normalizeItemName } from "@/lib/item-matching";
import { convertQuantity } from "@/lib/units";
import { foldedForms } from "@/lib/recipes/ingredient-match";

export type DuplicateItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  createdAt: Date;
  barcode: string | null;
  recipeCount: number;
  /** Shopping-list rows of any kind, ticked or not. */
  listCount: number;
  templateCount: number;
  priceCount: number;
  /** Ticked (bought) shopping-list rows. */
  purchasedListCount: number;
};

export type DuplicateAlias = { normalizedName: string; inventoryItemId: string | null };
export type DuplicateDismissal = { itemAId: string; itemBId: string };

export type DuplicateMember = DuplicateItem & { neverStocked: boolean };

export type DuplicateGroup = {
  /** The strongest pair's score: 1 for the same name, down to the fuzzy
   * threshold. Groups are sorted by it. */
  strength: number;
  /** In suggested-keeper order: `members[0]` is the one to keep. */
  members: DuplicateMember[];
};

// How sure each rule is, so groups sort by their strongest pair. The same
// normalized name is certain; the plural fold over-generates ("creamer" →
// "cream"), and an alias is a past answer about a recipe name, not about
// these two items. A fuzzy pair scores its own similarity, which is below 1
// for any two different normalized names.
const EXACT_STRENGTH = 1;
const FOLD_STRENGTH = 0.95;
const ALIAS_STRENGTH = 0.9;
export const FUZZY_MIN_SCORE = 0.8;

// Bounds on the fuzzy pass, the only part that compares pairs rather than
// looking names up. Everything else is a hash lookup and stays linear. The
// fuzzy pass only compares names that share a character pair (an inverted
// index), which keeps a 2,000-item household well under a second, but
// its worst case is still quadratic, so a household beyond this many items
// gets the exact, plural and alias rules only. Very long names are
// skipped for the same reason; they're pasted notes rather than item names.
export const FUZZY_MAX_ITEMS = 3000;
const FUZZY_MAX_NAME_LENGTH = 60;

/** Quantity 0, never bought on a list and no recorded price: mostly
 * phantom items created from recipes (design §6.2). */
export function isNeverStocked(item: Pick<DuplicateItem, "quantity" | "priceCount" | "purchasedListCount">): boolean {
  return item.quantity <= 0 && item.priceCount === 0 && item.purchasedListCount === 0;
}

const historyCount = (item: DuplicateItem) => item.recipeCount + item.listCount + item.templateCount + item.priceCount;

/** Suggested keeper first: the one with stock, then the most recipe, list
 * and price history, then the oldest. */
export function compareKeeper(a: DuplicateItem, b: DuplicateItem): number {
  return (
    Number(b.quantity > 0) - Number(a.quantity > 0) ||
    historyCount(b) - historyCount(a) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** The two ids in the order an InventoryDuplicateDismissal stores them. */
export function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const pairKey = (a: string, b: string) => sortedPair(a, b).join("\u0000");

function bigramCounts(name: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < name.length - 1; i++) {
    const gram = name.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * Every pair of names whose bigram similarity is at least FUZZY_MIN_SCORE,
 * scored exactly like `itemNameSimilarity` (Dice's coefficient over
 * character bigrams, counting repeats). Only names that share a bigram are
 * ever compared: an inverted index from bigram to the names holding it adds
 * up the shared count for each earlier name.
 */
function fuzzyPairs(names: string[], add: (i: number, j: number, strength: number) => void) {
  const postings = new Map<string, { index: number; count: number }[]>();
  const lengths = names.map((name) => name.length - 1);
  const shared = new Float64Array(names.length);
  const touched: number[] = [];

  names.forEach((name, i) => {
    if (name.length < 2 || name.length > FUZZY_MAX_NAME_LENGTH) return;
    const grams = bigramCounts(name);
    for (const [gram, count] of grams) {
      const list = postings.get(gram);
      if (!list) continue;
      for (const posting of list) {
        if (shared[posting.index] === 0) touched.push(posting.index);
        shared[posting.index] += Math.min(count, posting.count);
      }
    }
    for (const j of touched) {
      const score = (2 * shared[j]) / (lengths[i] + lengths[j]);
      // Equal names are the exact rule's; a different name can't score 1.
      if (score >= FUZZY_MIN_SCORE && names[i] !== names[j]) add(i, j, score);
      shared[j] = 0;
    }
    touched.length = 0;
    for (const [gram, count] of grams) {
      const list = postings.get(gram);
      if (list) list.push({ index: i, count });
      else postings.set(gram, [{ index: i, count }]);
    }
  });
}

/**
 * Groups of items that are probably the same thing. Two items are a
 * candidate pair when their normalized names are equal, equal after the
 * plural fold, one's name is an alias of the other, or their fuzzy score is
 * at least 0.8. A pair the household dismissed ("Not duplicates") is
 * skipped. Pairs are joined into groups (union-find), so "Egg" ~ "eggs" and
 * "eggs" ~ "Ägg" make one group of three.
 */
export function findDuplicateGroups(
  items: readonly DuplicateItem[],
  aliases: readonly DuplicateAlias[],
  dismissals: readonly DuplicateDismissal[],
): DuplicateGroup[] {
  const dismissed = new Set(dismissals.map((dismissal) => pairKey(dismissal.itemAId, dismissal.itemBId)));
  const names = items.map((item) => normalizeItemName(item.name));
  const indexById = new Map(items.map((item, index) => [item.id, index]));

  // Union-find over item indexes, tracking each pair's strength so a group
  // can report its strongest.
  const parent = items.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const strongest = new Map<string, number>();
  const add = (i: number, j: number, strength: number) => {
    if (i === j) return;
    const key = pairKey(items[i].id, items[j].id);
    if (dismissed.has(key)) return;
    if ((strongest.get(key) ?? 0) < strength) strongest.set(key, strength);
    parent[find(i)] = find(j);
  };

  // Equal names, and equal after the plural fold: every item is filed
  // under each of its forms, and items sharing a form pair up. The exact
  // name is one of its own forms, so it's told apart by comparing names.
  const byForm = new Map<string, number[]>();
  names.forEach((name, i) => {
    if (!name) return;
    for (const form of foldedForms(name)) {
      const list = byForm.get(form);
      if (list) list.push(i);
      else byForm.set(form, [i]);
    }
  });
  for (const list of byForm.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const [i, j] = [list[a], list[b]];
        add(i, j, names[i] === names[j] ? EXACT_STRENGTH : FOLD_STRENGTH);
      }
    }
  }

  // One's name is a learned alias of the other.
  const byName = new Map<string, number[]>();
  names.forEach((name, i) => {
    const list = byName.get(name);
    if (list) list.push(i);
    else byName.set(name, [i]);
  });
  for (const alias of aliases) {
    const target = alias.inventoryItemId === null ? undefined : indexById.get(alias.inventoryItemId);
    if (target === undefined) continue;
    for (const i of byName.get(alias.normalizedName) ?? []) add(i, target, ALIAS_STRENGTH);
  }

  if (items.length <= FUZZY_MAX_ITEMS) fuzzyPairs(names, add);

  const groups = new Map<number, { strength: number; members: DuplicateMember[] }>();
  for (const [key, strength] of strongest) {
    const [a] = key.split("\u0000");
    const root = find(indexById.get(a)!);
    const group = groups.get(root);
    if (group) group.strength = Math.max(group.strength, strength);
    else groups.set(root, { strength, members: [] });
  }
  items.forEach((item, i) => {
    groups.get(find(i))?.members.push({ ...item, neverStocked: isNeverStocked(item) });
  });

  return [...groups.values()]
    .map((group) => ({ strength: group.strength, members: group.members.sort(compareKeeper) }))
    .sort((a, b) => b.strength - a.strength || a.members[0].name.localeCompare(b.members[0].name));
}

export type NameMatchCandidate = { id: string; name: string };

/**
 * UX-126: the existing item a name being typed into the Add dialog is
 * probably the same as, or null. It applies the catalog's pair rules
 * (equal normalized name, equal after the plural fold, bigram score of at
 * least FUZZY_MIN_SCORE) to one typed name instead of every pair. Aliases
 * and "Not duplicates" dismissals are about two stored items, so they have
 * no say here. The strongest rule wins ("Smör" over "Smöret"), then the
 * higher fuzzy score, then the first in the list's order.
 */
export function findDuplicateOfName<T extends NameMatchCandidate>(typed: string, items: readonly T[]): T | null {
  const normalized = normalizeItemName(typed);
  if (!normalized) return null;
  const forms = foldedForms(normalized);
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const other = normalizeItemName(item.name);
    if (!other) continue;
    let score = 0;
    if (other === normalized) score = EXACT_STRENGTH;
    else if ([...foldedForms(other)].some((form) => forms.has(form))) score = FOLD_STRENGTH;
    else if (normalized.length <= FUZZY_MAX_NAME_LENGTH && other.length <= FUZZY_MAX_NAME_LENGTH) {
      const similarity = itemNameSimilarity(normalized, other);
      if (similarity >= FUZZY_MIN_SCORE) score = similarity;
    }
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * UX-126: the form's amount expressed in the matched item's own unit, or
 * null when the two units don't convert ("2 kg" onto an item counted in
 * pcs). "Add to existing" must never add a number in a different unit than
 * the item is stored in, so the caller hides the button on null. Rounded to
 * four decimals to drop float noise (0.1 kg is 100 g, not 100.00000000000001).
 */
export function amountInExistingUnit(amount: number, formUnit: string, existingUnit: string): number | null {
  const converted = convertQuantity(amount, formUnit, existingUnit);
  return converted === null ? null : Math.round(converted * 10000) / 10000;
}
