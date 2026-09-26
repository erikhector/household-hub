// PERF-6 — the category labels below are the only piece of the (large)
// locale dictionaries that shopping-mode-grouping.ts needs (to recognize a
// category stored in either locale — see that file's KNOWN_CATEGORY_KEYS —
// and that module is reachable from the client shopping-list-client.tsx.
// Before this file existed, shopping-mode-grouping.ts imported the whole
// `en`/`sv` dictionaries just for these few strings, and Next bundled both
// complete dictionaries (~68 KB gz) into the shopping-list route's client
// chunk. Splitting just these labels out lets en.ts/sv.ts still own them
// (imported back in below, so `inventory.autoCategories`/`uncategorized`
// keep living where translators expect dictionary text) while
// shopping-mode-grouping.ts imports only this tiny, dependency-free module.
//
// Shape mirrors `inventory.autoCategories`/`uncategorized` in en.ts (see
// AUTO_CATEGORY_KEYS, src/lib/inventory/auto-category.ts, for the keys).
// Values are plain strings, same rule as the dictionaries themselves — kept
// as `string` (no `as const`) so sv's labels type-check as the same shape
// as en's rather than as their own literal strings, which `Dictionary`
// (`typeof en`, see dictionaries/en.ts) would otherwise reject.
import type { AutoCategoryKey } from "@/lib/inventory/auto-category";

type CategoryLabels = { uncategorized: string; autoCategories: Record<AutoCategoryKey, string> };

export const categoryLabels: { en: CategoryLabels; sv: CategoryLabels } = {
  en: {
    uncategorized: "Uncategorized",
    autoCategories: {
      produce: "Produce",
      bakery: "Bakery",
      dairy: "Dairy & eggs",
      meat: "Meat & fish",
      pantry: "Pantry basics",
      frozen: "Frozen",
      drinks: "Drinks",
      cleaning: "Cleaning supplies",
      bathroom: "Bathroom essentials",
    },
  },
  sv: {
    uncategorized: "Okategoriserat",
    autoCategories: {
      produce: "Frukt & grönt",
      bakery: "Bröd",
      dairy: "Mejeri & ägg",
      meat: "Kött & fisk",
      pantry: "Basvaror skafferi",
      frozen: "Fryst",
      drinks: "Dryck",
      cleaning: "Städartiklar",
      bathroom: "Badrumsartiklar",
    },
  },
};
