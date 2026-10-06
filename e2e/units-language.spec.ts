import { expect, test } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice } from "./ui";

// UX-44: stored units are free text ("pcs", "tbsp"), but they're shown in
// the user's language: a Swedish user sees "6 st", not "6 pcs", while the
// stored value (and so the English user's view of the same rows) is
// unchanged. The seeded household owns Tomatoes (6 pcs) in the pantry and
// Apples (6 pcs) on its shopping list, and has one English and one Swedish
// member (e2e/seed.ts).
for (const [locale, storageState, unit] of [
  ["en", STORAGE_STATE, "pcs"],
  ["sv", STORAGE_STATE_SV, "st"],
] as const) {
  test.describe(`units (${locale})`, () => {
    test.use({ storageState });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test(`the pantry shows "pcs" as "${unit}"`, async ({ page }) => {
      await page.goto("/dashboard/inventory");
      // The stepper's label is the quantity and unit, rendered once per
      // layout (table row and phone card), so match the visible one.
      await expect(page.getByRole("main").getByText(`6 ${unit}`, { exact: true }).first()).toBeVisible();
      if (locale === "sv") await expect(page.getByRole("main").getByText(/\bpcs\b/)).toHaveCount(0);
    });

    test(`a shopping list shows "pcs" as "${unit}"`, async ({ page }) => {
      await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
      await expect(page.getByRole("main").getByText(`Apples × 6 ${unit}`, { exact: true }).first()).toBeVisible();
    });
  });
}
