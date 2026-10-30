import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, LOCALES } from "./ui";

// GAP-67: the OS share sheet needs a real Android device, but what it opens
// is just /dashboard/share?url=…|text=…, which this spec visits directly. The
// handler only pre-fills: nothing is imported or added.
const dicts = { en, sv };

for (const locale of LOCALES) {
  const d = dicts[locale];

  test.describe(`share target (${locale})`, () => {
    // Signed in, the language comes from the account, not the cookie, so
    // Swedish runs as the seeded Swedish user (e2e/seed.ts).
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("a shared link opens the recipe dialog with the import field filled in", async ({ page }) => {
      const link = "https://example.com/recipes/pasta";
      await page.goto(`/dashboard/share?title=Pasta&url=${encodeURIComponent(link)}`);
      const dialog = page.getByRole("dialog", { name: d.mealPlanning.newRecipeDialogTitle });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(d.mealPlanning.importUrlLabel)).toHaveValue(link);
      // Pre-filled only: the param is stripped so a reload doesn't reopen it.
      await expect(page).not.toHaveURL(/importUrl=/);

      // The share is spent once the dialog closes: reopening starts empty.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.getByRole("button", { name: d.mealPlanning.newRecipe }).first().click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(d.mealPlanning.importUrlLabel)).toHaveValue("");
    });

    test("shared text opens the shopping list's paste dialog filled in", async ({ page }) => {
      await page.goto(`/dashboard/share?text=${encodeURIComponent("Milk 1 l\nEggs x12")}`);
      const dialog = page.getByRole("dialog", { name: d.shoppingList.importList.dialogTitle });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("textbox")).toHaveValue("Milk 1 l\nEggs x12");
      await expect(page).not.toHaveURL(/pasteText=/);
    });

    test("a share with nothing usable lands on the dashboard", async ({ page }) => {
      await page.goto("/dashboard/share?title=Hi");
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
}
