import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-16: what a server action returns as `{ error }` and the labels that
// primitives hard-coded ("Close" on every dialog) follow the user's
// language. A name of only spaces passes the browser's `required` check but
// not the server's trim().min(1), so the form shows the action's own message.
for (const [locale, storageState, t] of [
  ["en", STORAGE_STATE, en],
  ["sv", STORAGE_STATE_SV, sv],
] as const) {
  test.describe(`server errors and dialog labels (${locale})`, () => {
    test.use({ storageState });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("the add-item sheet says Close in the user's language", async ({ page }) => {
      await page.goto("/dashboard/inventory");
      await page.getByRole("button", { name: t.inventory.addItem }).first().click();
      const dialog = page.getByRole("dialog", { name: t.inventory.addDialogTitle });
      await expect(dialog.getByRole("button", { name: t.common.close, exact: true })).toBeVisible();
    });

    test("a rejected name shows the server's message in the user's language", async ({ page }) => {
      await page.goto("/dashboard/inventory");
      await page.getByRole("button", { name: t.inventory.addItem }).first().click();
      const dialog = page.getByRole("dialog", { name: t.inventory.addDialogTitle });
      await dialog.getByLabel(t.inventory.nameLabel, { exact: true }).fill("   ");
      await dialog.getByRole("button", { name: t.inventory.addItem, exact: true }).click();

      await expect(dialog.getByText(t.errors.nameRequired)).toBeVisible();
    });
    // MAINT-7: the household actions follow the language too.
    test("a rejected household name shows the server's message in the user's language", async ({ page }, testInfo) => {
      await page.goto("/dashboard");
      const row = testInfo.project.name === "mobile" ? page.getByRole("banner") : page.getByRole("complementary");
      const switcher = row.getByRole("button", { name: /E2E Household/ });
      await expectHydrated(switcher);
      await switcher.click();
      await page.getByRole("menuitem", { name: t.household.switcher.createMenuItem }).click();

      const dialog = page.getByRole("dialog", { name: t.household.switcher.createNew });
      await dialog.getByLabel(t.household.switcher.nameLabel).fill("   ");
      await dialog.getByRole("button", { name: t.household.switcher.create, exact: true }).click();

      await expect(dialog.getByText(t.errors.householdNameRequired)).toBeVisible();
    });
  });
}
