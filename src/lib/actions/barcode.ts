"use server";

import { requireHousehold } from "@/lib/session";
import { isValidBarcodeFormat } from "@/lib/barcode";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { categoryKeyFromOpenFoodFactsTags } from "@/lib/inventory/auto-category";

// Shared by the inventory add-item form and the shopping list ad-hoc-add
// form (see src/components/shared/barcode-scanner.tsx) — both just need a
// best-effort product name (and, for AUTO-2, a category to pre-fill) for a
// scanned barcode, nothing household-scoped.
// requireHousehold() is still called first, matching every other action in
// this app's "never a reachable, unauthenticated Server Action" convention,
// even though the household id itself isn't used for anything here.

const OPEN_FOOD_FACTS_TIMEOUT_MS = 5000;

export type BarcodeLookupResult = {
  name: string | null;
  /** The product's category from Open Food Facts, mapped to one of the
   * canonical auto-categories (AUTO-2) and labelled in the user's locale —
   * null when there's no product or its tags didn't map to anything. */
  category?: string | null;
};

type OpenFoodFactsResponse = {
  status?: number;
  product?: {
    product_name?: unknown;
    categories_tags?: unknown;
  };
};

export async function lookupBarcodeAction(barcode: string): Promise<BarcodeLookupResult> {
  await requireHousehold();

  const trimmed = barcode.trim();
  if (!isValidBarcodeFormat(trimmed)) {
    return { name: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPEN_FOOD_FACTS_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(trimmed)}.json`,
      {
        signal: controller.signal,
        // Open Food Facts asks API consumers to identify themselves.
        headers: { "User-Agent": "HouseholdHub - Barcode Scanner Feature" },
      },
    );
    if (!response.ok) return { name: null };

    const data = (await response.json()) as OpenFoodFactsResponse;
    if (data.status !== 1 || !data.product) return { name: null };

    const rawName = data.product.product_name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name.length === 0) return { name: null };

    const tags = Array.isArray(data.product.categories_tags)
      ? data.product.categories_tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const categoryKey = categoryKeyFromOpenFoodFactsTags(tags);
    const category = categoryKey ? (await getDictionary()).inventory.autoCategories[categoryKey] : null;
    return { name, category };
  } catch {
    // Network error, timeout, malformed JSON, etc. — the caller falls back
    // to manual entry either way, so no error needs to surface here.
    return { name: null };
  } finally {
    clearTimeout(timeout);
  }
}
