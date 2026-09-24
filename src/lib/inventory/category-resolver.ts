import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { resolveAutoCategory, type KnownItem } from "@/lib/inventory/auto-category";
import { isAiCategoryFallbackConfigured, resolveCategoriesWithAiFallback } from "@/lib/inventory/ai-category-fallback";
import { logger } from "@/lib/logger";

// Every locale's "Uncategorized" label, plus the English literal the
// shopping-list create paths have always written regardless of locale — an
// item sitting in any of them has no real category to lend to a new one.
// Exported so scheduleAiCategoryFallback (below) can guard its patch
// against a category that changed in the time its background call took.
export const PLACEHOLDER_CATEGORIES = [en.inventory.uncategorized, sv.inventory.uncategorized, "Uncategorized"];

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

/**
 * AUTO-2b(a): schedules the optional AI fallback for `names` — the items a
 * caller's createCategoryResolver call already missed on (household memory
 * and the dictionary both came up empty), after they've already been
 * committed as "Uncategorized". A no-op with no I/O at all when no
 * provider key is configured, so every call site can call this
 * unconditionally without its own key check.
 *
 * Wrapped in `after()` (next/server) so it runs once the response has
 * already been sent — the add itself never waits on this — while still
 * running to completion rather than racing a serverless invocation's
 * teardown the way a bare fire-and-forget promise would. Every InventoryItem
 * this resolves is patched by (householdId, name), not by id: every caller
 * already has the name in hand right after creating the row, so there's
 * nothing worth threading a batch of freshly-created ids through for.
 *
 * The `category: { in: PLACEHOLDER_CATEGORIES }` guard on the patch is what
 * makes a race safe: if the household (or another automation) already gave
 * the item a real category by the time this call returns, that category
 * wins and is never clobbered — the same "corrections stick" guardrail
 * createCategoryResolver already honors for the deterministic tiers.
 *
 * Never throws past its own boundary and never surfaces anything to the
 * user — see the module doc comment on ai-category-fallback.ts.
 */
export function scheduleAiCategoryFallback(householdId: string, names: readonly string[]): void {
  const candidates = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (candidates.length === 0 || !isAiCategoryFallbackConfigured()) return;

  after(async () => {
    try {
      const categories = await resolveCategoriesWithAiFallback(householdId, candidates);
      if (categories.size === 0) return;

      const dict = await getDictionary();
      let patchedAny = false;
      for (const [name, key] of categories) {
        const { count } = await prisma.inventoryItem.updateMany({
          where: { householdId, name, category: { in: PLACEHOLDER_CATEGORIES } },
          data: { category: dict.inventory.autoCategories[key] },
        });
        patchedAny ||= count > 0;
      }
      // Runs after the response has already been sent, so this revalidation
      // is for whoever loads/reloads the page next — the user who triggered
      // the add won't see the patched category until their next navigation.
      if (patchedAny) revalidatePath("/dashboard/inventory");
    } catch (error) {
      // Fire-and-forget: a failure here must never surface to the user —
      // the item already exists as "Uncategorized", exactly as if no AI
      // key were configured at all.
      logger.error("AI category fallback: failed to patch category after create", { error });
    }
  });
}
