import { expect, test } from "@playwright/test";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, LOCALES } from "./ui";

// UX-2: a Select trigger whose label is wider than the trigger must end in
// an ellipsis, not be cut mid-word. The inventory filter row's "Last
// updated: Any time" (en) and "Senast uppdaterad: När som helst" (sv) are
// the kind of labels that clipped at 1280px. Desktop only: phones fold these
// selects into the Filters dialog, where each trigger is full width.
// Since UX-199 those two triggers size to their content, so their longest
// option no longer overflows (e2e/ux-199.spec.ts checks that); the ellipsis
// stays as the fallback for any trigger with a fixed width, like the
// Category and Location filters holding a long user-typed name.
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
      await expect(all.filter({ hasText: UPDATED_PREFIX[locale] })).toBeVisible();

      // Every select value is a truncating block, so any label too long for
      // its trigger, in any locale, ends in "…" rather than a mid-word cut.
      for (const el of await all.all()) {
        await expect(el).toHaveCSS("text-overflow", "ellipsis");
        await expect(el).toHaveCSS("overflow-x", "hidden");
      }
    });
  });
}
