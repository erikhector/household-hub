import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { format } from "@/lib/i18n/format";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, openRowSheet, waitForDialogHistory } from "./ui";

// GAP-72: a recipe can be marked with the course(s) it suits. "Add to plan"
// then preselects the first one, and the recipe list can be narrowed to a
// course. Each test creates a uniquely named recipe through the form and
// removes it afterwards.
let name: string;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  name = `Course ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
});

test.afterEach(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND name = $2`, [E2E_HOUSEHOLD.id, name]);
  } finally {
    await client.end();
  }
});

for (const [locale, storageState, t] of [
  ["en", STORAGE_STATE, en.mealPlanning],
  ["sv", STORAGE_STATE_SV, sv.mealPlanning],
] as const) {
  test.describe(`recipe course (${locale})`, () => {
    test.use({ storageState });

    test("a Breakfast recipe is preselected as Breakfast in Add to plan and found by the meal filter", async ({ page }) => {
      await page.goto("/dashboard/meal-planning?tab=recipes");
      const newRecipe = page.getByRole("button", { name: t.newRecipe });
      await expectHydrated(newRecipe);
      await newRecipe.click();

      const dialog = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
      await dialog.getByRole("textbox", { name: t.recipeNameLabel, exact: true }).fill(name);
      const chip = dialog.getByRole("button", { name: t.mealTypeBreakfast, exact: true });
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      await dialog.getByRole("button", { name: t.create, exact: true }).click();
      await expect(dialog).toBeHidden();
      await waitForDialogHistory(page);

      // Saved: Add to plan starts on Breakfast after a reload.
      await page.reload();
      const sheet = await openRowSheet(page, name);
      await sheet.getByRole("button", { name: t.addToPlanButton, exact: true }).click();
      const plan = page.getByRole("dialog", { name: format(t.addToPlanDialogTitle, { recipe: name }) });
      await expect(plan).toBeVisible();
      await expect(plan.getByRole("combobox", { name: t.mealTypeLabel })).toContainText(t.mealTypeBreakfast);
      await page.keyboard.press("Escape");
      await expect(plan).toHaveCount(0);

      // The list's meal filter drops it under Snack and keeps it under Breakfast.
      const filter = page.getByRole("combobox", { name: t.mealTypeFilterLabel });
      await filter.click();
      await page.getByRole("option", { name: t.mealTypeSnack, exact: true }).click();
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
      await filter.click();
      await page.getByRole("option", { name: t.mealTypeBreakfast, exact: true }).click();
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    });
  });
}
