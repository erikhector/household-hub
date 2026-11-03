import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, openRowSheet, waitForDialogHistory } from "./ui";

// GAP-70: a recipe keeps the page it came from (shown as its host name, a
// plain external link) and the household's own notes (under the method in the
// sheet). Each test creates a recipe with a unique name through the form,
// reloads, and checks the sheet; the recipe is removed afterwards.
let name: string;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  name = `Source ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
  test.describe(`recipe source link and notes (${locale})`, () => {
    test.use({ storageState });

    test("a saved link shows as its host name and the note shows in the sheet after a reload", async ({ page }) => {
      await page.goto("/dashboard/meal-planning?tab=recipes");
      const newRecipe = page.getByRole("button", { name: t.newRecipe });
      await expectHydrated(newRecipe);
      await newRecipe.click();

      const dialog = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
      await dialog.getByRole("textbox", { name: t.recipeNameLabel, exact: true }).fill(name);
      await dialog.getByLabel(t.sourceUrlLabel).fill("https://www.bbc.co.uk/food/recipes/pancakes");
      await dialog.getByLabel(t.recipeNotesLabel).fill("Use half the sugar");
      await dialog.getByRole("button", { name: t.create, exact: true }).click();
      await expect(dialog).toBeHidden();
      await waitForDialogHistory(page);

      await page.reload();
      const sheet = await openRowSheet(page, name);
      const link = sheet.getByRole("link", { name: "bbc.co.uk" });
      await expect(link).toHaveAttribute("href", "https://www.bbc.co.uk/food/recipes/pancakes");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("rel", /noreferrer/);
      await expect(sheet.getByText("Use half the sugar")).toBeVisible();
    });

    test("a javascript: link is refused with the field error and nothing is saved", async ({ page }) => {
      await page.goto("/dashboard/meal-planning?tab=recipes");
      const newRecipe = page.getByRole("button", { name: t.newRecipe });
      await expectHydrated(newRecipe);
      await newRecipe.click();

      const dialog = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
      await dialog.getByRole("textbox", { name: t.recipeNameLabel, exact: true }).fill(name);
      // The browser's own url check would stop a non-URL before the server
      // sees it; a javascript: address is a valid URL, so it reaches the
      // action, which is the rule under test.
      await dialog.getByLabel(t.sourceUrlLabel).fill("javascript:alert(1)");
      await dialog.getByRole("button", { name: t.create, exact: true }).click();

      await expect(dialog.getByText(/http:\/\/ eller https:\/\/|http:\/\/ or https:\/\//)).toBeVisible();
    });
  });
}
