"use server";

import { requireHousehold } from "@/lib/session";
import { isValidBarcodeFormat } from "@/lib/barcode";

// Shared by the inventory add-item form and the shopping list ad-hoc-add
// form (see src/components/shared/barcode-scanner.tsx) — both just need a
// best-effort product name for a scanned barcode, nothing household-scoped.
// requireHousehold() is still called first, matching every other action in
// this app's "never a reachable, unauthenticated Server Action" convention,
// even though the household id itself isn't used for anything here.

const OPEN_FOOD_FACTS_TIMEOUT_MS = 5000;

export type BarcodeLookupResult = { name: string | null };

type OpenFoodFactsResponse = {
  status?: number;
  product?: {
    product_name?: unknown;
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
    return { name: name.length > 0 ? name : null };
  } catch {
    // Network error, timeout, malformed JSON, etc. — the caller falls back
    // to manual entry either way, so no error needs to surface here.
    return { name: null };
  } finally {
    clearTimeout(timeout);
  }
}
