import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { createHouseholdMenuTrigger, dismissCookieNotice, expectHydrated } from "./ui";

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

    // UX-183: the add-item form checks the name itself now, so a blank one
    // never reaches the server; the field's own message is in the language.
    test("a blank item name shows the field's message in the user's language", async ({ page }) => {
      await page.goto("/dashboard/inventory");
      await page.getByRole("button", { name: t.inventory.addItem }).first().click();
      const dialog = page.getByRole("dialog", { name: t.inventory.addDialogTitle });
      await dialog.getByLabel(t.inventory.nameLabel, { exact: true }).fill("   ");
      await dialog.getByRole("button", { name: t.inventory.addItem, exact: true }).click();

      await expect(dialog.getByRole("alert").filter({ hasText: t.inventory.nameRequired })).toBeVisible();
    });
    // MAINT-7, UX-183b: the household actions follow the language too (an all-space name is caught by the form itself).
    test("a blank household name shows the field message in the user's language", async ({ page, isMobile }) => {
      await page.goto("/dashboard");
      const switcher = createHouseholdMenuTrigger(page, isMobile, t.nav.more);
      await expectHydrated(switcher);
      await switcher.click();
      await page.getByRole("menuitem", { name: t.household.switcher.createMenuItem }).click();

      const dialog = page.getByRole("dialog", { name: t.household.switcher.createNew });
      await dialog.getByLabel(t.household.switcher.nameLabel).fill("   ");
      await dialog.getByRole("button", { name: t.household.switcher.create, exact: true }).click();

      await expect(dialog.getByRole("alert").filter({ hasText: t.household.switcher.nameRequired })).toBeVisible();
    });
    // MAINT-7, UX-183b: so does the profile name (an all-space name is caught by the form itself).
    test("a blank profile name shows the field message in the user's language", async ({ page }) => {
      await page.goto("/dashboard/profile");
      const name = page.getByLabel(t.profile.displayNameForm.label);
      await expectHydrated(name);
      await name.fill("   ");
      await page.getByRole("button", { name: t.profile.displayNameForm.save, exact: true }).click();

      await expect(page.getByText(t.profile.displayNameForm.nameRequired)).toBeVisible();
    });
    // MAINT-7: the invite email's delivery failure is the action's own text,
    // not the English one email.ts logs. The e2e server has no Resend key.
    test("a failed invite email says so in the user's language", async ({ page }) => {
      await page.goto("/dashboard/household");
      const invite = page.getByRole("button", { name: t.household.invite.button });
      await expectHydrated(invite);
      await invite.click();
      const email = page.getByRole("textbox", { name: t.household.invite.emailPlaceholder });
      await email.fill("someone@squirrel.test");
      await email.press("Enter");

      await expect(page.locator("[data-sonner-toast]").getByText(t.errors.emailNotConfigured)).toBeVisible();
    });
  });
}
