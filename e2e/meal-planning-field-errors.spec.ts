import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { Client } from "pg";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
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

test.afterEach(async ({}, testInfo) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const like = `e2e-ux183b-plan-${E2E_WORKER}-%-${testInfo.project.name}`;
    await client.query(`DELETE FROM "MealPlanEntry" WHERE "mealPlanId" LIKE $1`, [like]);
    await client.query(`DELETE FROM "MealPlan" WHERE id LIKE $1 AND "householdId" = $2`, [like, E2E_HOUSEHOLD.id]);
  } finally {
    await client.end();
  }
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

    test("an empty template name is flagged under the field", async ({ page }, testInfo) => {
      // "Save week as template" only shows for a week with meals, so seed one
      // in a far-future week of its own (a Monday per project and locale).
      const week = `2032-05-${{ desktop: { en: "03", sv: "10" }, mobile: { en: "17", sv: "24" } }[testInfo.project.name === "mobile" ? "mobile" : "desktop"][locale]}`;
      const planId = `e2e-ux183b-plan-${E2E_WORKER}-${locale}-${testInfo.project.name}`;
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query(`DELETE FROM "MealPlanEntry" WHERE "mealPlanId" = $1`, [planId]);
        await client.query(`DELETE FROM "MealPlan" WHERE id = $1`, [planId]);
        await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)`, [
          planId,
          E2E_HOUSEHOLD.id,
          week,
        ]);
        await client.query(
          `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName", portions)
           VALUES ($1, $2, $3, 'DINNER', 'Field error pasta', 2)`,
          [`${planId}-entry`, planId, week],
        );
      } finally {
        await client.end();
      }
      await page.goto(`/dashboard/meal-planning?week=${week}`);
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
