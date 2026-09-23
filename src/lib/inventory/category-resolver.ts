import { prisma } from "@/lib/prisma";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { resolveAutoCategory, type KnownItem } from "@/lib/inventory/auto-category";

// Every locale's "Uncategorized" label, plus the English literal the
// shopping-list create paths have always written regardless of locale — an
// item sitting in any of them has no real category to lend to a new one.
const PLACEHOLDER_CATEGORIES = [en.inventory.uncategorized, sv.inventory.uncategorized, "Uncategorized"];

/**
 * AUTO-2's server half: returns a `(name) => category | null` for filling in
 * the blank category of an InventoryItem about to be created, backed by
 * resolveAutoCategory (household memory, then the built-in dictionary,
 * labelled in the current user's locale).
 *
 * The household's items are loaded once, on the first call, so a batch
 * (a pasted list, a receipt) costs one extra query rather than one per line,
 * and a caller whose items all came with a category costs none. Callers keep
 * their own "Uncategorized" fallback for a null result, and never call this
 * when the user typed a category — see the Guardrails in BACKLOG.md.
 *
 * A caller that has already loaded the household's items (name + category)
 * for its own dedupe can pass them as `preloaded` to skip the query.
 */
export function createCategoryResolver(
  householdId: string,
  preloaded?: KnownItem[],
): (name: string) => Promise<string | null> {
  let context: Promise<{ knownItems: KnownItem[]; labels: typeof en.inventory.autoCategories }> | null = null;

  return async (name: string) => {
    context ??= Promise.all([
      preloaded ?? prisma.inventoryItem.findMany({ where: { householdId }, select: { name: true, category: true } }),
      getDictionary(),
    ]).then(([knownItems, dict]) => ({ knownItems, labels: dict.inventory.autoCategories }));

    const { knownItems, labels } = await context;
    return resolveAutoCategory(name, { knownItems, labels, placeholderCategories: PLACEHOLDER_CATEGORIES });
  };
}
