import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { clickListSetting, dismissCookieNotice, expectHydrated, expectRouterPatched } from "./ui";

// UX-183b (shopping): the Rename list and Save as template dialogs word a
// cleared name under the field, in the page's language (role="alert"),
// instead of the browser's own bubble. Focus moves to the field, it gets
// aria-invalid, the message clears as the field is edited, and it doesn't
// greet the next opening of the dialog. The empty submit is blocked before
// it reaches the server, so the seeded list is never changed.
const listUrl = `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

for (const [locale, storageState, t] of [
  ["en", STORAGE_STATE, en.shoppingList],
  ["sv", STORAGE_STATE_SV, sv.shoppingList],
] as const) {
  test.describe(`shopping field errors (${locale})`, () => {
    test.use({ storageState });

    async function openListSetting(page: Page, item: string) {
      const more = page.getByRole("button", { name: t.moreActions });
      await expectHydrated(more);
      // The dialog pushes a history entry as it opens (see expectRouterPatched).
      await expectRouterPatched(page);
      await more.click();
      await clickListSetting(page, item, t.menuListSettings);
    }

    test("a cleared list name is flagged under the field", async ({ page }) => {
      await page.goto(listUrl);
      await openListSetting(page, t.renameList.menuItem);
      const dialog = page.getByRole("dialog", { name: t.renameList.dialogTitle });
      const name = dialog.getByRole("textbox", { name: t.renameList.nameLabel });
      await name.fill("");

      await dialog.getByRole("button", { name: t.renameList.save, exact: true }).click();
      const alert = dialog.getByRole("alert").filter({ hasText: t.renameList.nameRequired });
      await expect(alert).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
      await expect(dialog).toBeVisible();

      await name.fill("Groceries");
      await expect(alert).toHaveCount(0);
      await expect(name).not.toHaveAttribute("aria-invalid", "true");

      // Leave a message behind, close, and open again: it's gone.
      await name.fill("");
      await dialog.getByRole("button", { name: t.renameList.save, exact: true }).click();
      await expect(alert).toBeVisible();
      await dialog.getByRole("button", { name: t.renameList.cancel }).click();
      await expect(dialog).toBeHidden();
      await openListSetting(page, t.renameList.menuItem);
      await expect(page.getByRole("dialog", { name: t.renameList.dialogTitle }).getByRole("alert")).toHaveCount(0);
    });

    test("a cleared template name is flagged under the field", async ({ page }) => {
      await page.goto(listUrl);
      await openListSetting(page, t.templates.menuItem);
      const dialog = page.getByRole("dialog", { name: t.templates.dialogTitle });
      const name = dialog.getByRole("textbox", { name: t.templates.nameLabel });
      await name.fill("");

      await dialog.getByRole("button", { name: t.templates.save, exact: true }).click();
      const alert = dialog.getByRole("alert").filter({ hasText: t.templates.nameRequired });
      await expect(alert).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
      await expect(dialog).toBeVisible();

      await name.fill("Weekly shop");
      await expect(alert).toHaveCount(0);
    });
  });
}
