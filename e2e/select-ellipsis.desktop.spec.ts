import { expect, test } from "@playwright/test";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, LOCALES } from "./ui";

// UX-2: a Select trigger whose label is wider than the trigger must end in
// an ellipsis, not be cut mid-word. The inventory filter row's "Last
// updated: Any time" (en) and "Senast uppdaterad: När som helst" (sv) are
// the kind of labels that clipped at 1280px. Desktop only: phones fold these
// selects into the Filters dialog, where each trigger is full width.
const UPDATED_PREFIX = { en: "Last updated:", sv: "Senast uppdaterad:" } as const;

for (const locale of LOCALES) {
  test.describe(`select trigger ellipsis (${locale})`, () => {
    // Signed in, the language comes from the account (see smoke.spec.ts).
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("select values truncate with an ellipsis instead of clipping", async ({ page }) => {
      await page.goto("/dashboard/inventory");
      const all = page.locator('[data-slot="select-value"]');
      const updated = all.filter({ hasText: UPDATED_PREFIX[locale] });
      await expect(updated).toBeVisible();

      // Every select value is a truncating block, so any label too long for
      // its trigger, in any locale, ends in "…" rather than a mid-word cut.
      for (const el of await all.all()) {
        await expect(el).toHaveCSS("text-overflow", "ellipsis");
        await expect(el).toHaveCSS("overflow-x", "hidden");
      }

      // Pick the longest "updated" option ("Not updated in 90+ days" and its
      // Swedish twin) so the label is certain to be wider than its trigger's
      // box at 1280px, then the ellipsis is what the user sees.
      await updated.click();
      await page.getByRole("option").last().click();
      try {
        await expect(updated).toBeVisible();
        const clipped = await updated.evaluate((el) => el.scrollWidth > el.clientWidth);
        expect(clipped, "the 'Last updated' label should overflow its trigger").toBe(true);
      } finally {
        // The filter is remembered for the signed-in user, and the other
        // inventory specs share that user (they'd start with "Filters 1"
        // active and find nothing), so put it back to "any time".
        await updated.click();
        await page.getByRole("option").first().click();
      }
    });
  });
}
