import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-183b (meal planning): the recipe form and the save-week-as-template
// dialog word a missing field under it, in the page's language
// (role="alert"), instead of the browser's own bubble. Focus moves to the
// first empty field, it gets aria-invalid, the message clears as the field
// is edited, and what was typed elsewhere stays. The date fields of Add to
// plan, Move and the bulk move share the same hook but a date input can't
// be left empty through the UI, so they have no spec of their own.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

for (const [locale, storageState, t] of [
  ["en", STORAGE_STATE, en.mealPlanning],
  ["sv", STORAGE_STATE_SV, sv.mealPlanning],
] as const) {
  test.describe(`meal planning field errors (${locale})`, () => {
    test.use({ storageState });

    test("an empty recipe name and portions are flagged under their fields", async ({ page }) => {
      await page.goto("/dashboard/meal-planning?tab=recipes");
      const newRecipe = page.getByRole("button", { name: t.newRecipe });
      await expectHydrated(newRecipe);
      await newRecipe.click();

      const dialog = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
      const name = dialog.getByRole("textbox", { name: t.recipeNameLabel, exact: true });
      const servings = dialog.getByRole("spinbutton", { name: t.servingsLabel });
      const instructions = dialog.getByRole("textbox", { name: t.instructionsLabel });
      await instructions.fill("kept instructions");
      await servings.fill("");

      await dialog.getByRole("button", { name: t.create, exact: true }).click();
      const nameAlert = dialog.getByRole("alert").filter({ hasText: t.recipeNameRequired });
      const servingsAlert = dialog.getByRole("alert").filter({ hasText: t.servingsRequired });
      await expect(nameAlert).toBeVisible();
      await expect(servingsAlert).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
      await expect(instructions).toHaveValue("kept instructions");

      await name.fill("Pancakes");
      await expect(nameAlert).toHaveCount(0);
      await expect(servingsAlert).toBeVisible();
    });

    test("an empty template name is flagged under the field", async ({ page }) => {
      await page.goto("/dashboard/meal-planning");
      const more = page.getByRole("button", { name: t.morePlannerActions });
      await expectHydrated(more);
      await more.click();
      await page.getByRole("menuitem", { name: t.templates.saveMenuItem }).click();
      const dialog = page.getByRole("dialog", { name: t.templates.saveTitle });
      const name = dialog.getByRole("textbox", { name: t.templates.nameLabel });

      await dialog.getByRole("button", { name: t.templates.save, exact: true }).click();
      const alert = dialog.getByRole("alert").filter({ hasText: t.templates.nameRequired });
      await expect(alert).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();

      await name.fill("School week");
      await expect(alert).toHaveCount(0);
    });
  });
}
