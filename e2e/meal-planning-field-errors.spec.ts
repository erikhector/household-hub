import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { withDb } from "./db";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectRouterPatched } from "./ui";

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
  await withDb(async (client) => {
    const like = `e2e-ux183b-plan-${E2E_WORKER}-%-${testInfo.project.name}`;
    await client.query(`DELETE FROM "MealPlanEntry" WHERE "mealPlanId" LIKE $1`, [like]);
    await client.query(`DELETE FROM "MealPlan" WHERE id LIKE $1 AND "householdId" = $2`, [like, E2E_HOUSEHOLD.id]);
  });
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
      // in a week of its own (a Monday per project and locale). MAINT-115:
      // these used to be four 2032 Mondays week-picks.spec.ts also seeds, and
      // desktop and mobile share a worker's household while running at the
      // same time, so one spec's live plan blocked the other's insert on
      // MealPlan's (householdId, weekStartDate) key. A long-past year keeps
      // them clear of every other spec's fixed weeks (grep `e2e/` for the
      // year before changing them) and of the random far-future weeks
      // plan-leftovers, cook-soon and friends pick, which far-weeks.ts keeps
      // in 2036-2099. The menu item doesn't care whether the week is over.
      const week = `2019-04-${{ desktop: { en: "01", sv: "08" }, mobile: { en: "15", sv: "22" } }[testInfo.project.name === "mobile" ? "mobile" : "desktop"][locale]}`;
      const planId = `e2e-ux183b-plan-${E2E_WORKER}-${locale}-${testInfo.project.name}`;
      await withDb(async (client) => {
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
      });
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

    // UX-204: "Custom meal…" with no name used to post and come back as one
    // form-level line under the note field, below the fold of the sheet on
    // a phone, worded as if no recipe had been picked.
    test("an empty custom meal name is flagged under the field", async ({ page }, testInfo) => {
      // An empty week of its own per project and locale (same reasoning as
      // the template test's weeks above), so the sheet opens from the empty
      // state's one button and nothing planned there gets in the way.
      const week = `2019-05-${{ desktop: { en: "06", sv: "13" }, mobile: { en: "20", sv: "27" } }[testInfo.project.name === "mobile" ? "mobile" : "desktop"][locale]}`;
      await page.goto(`/dashboard/meal-planning?week=${week}`);
      const first = page.getByRole("button", { name: t.addFirstDinner });
      await expectHydrated(first);
      await expectRouterPatched(page);
      await first.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: t.recipeLabel }).click();
      await page.getByRole("option", { name: t.customMealOption }).click();
      const name = dialog.getByRole("textbox", { name: t.customMealNameLabel });
      const ingredients = dialog.getByRole("textbox", { name: t.customMealIngredientsLabel });
      await ingredients.fill("2 tortillas");

      await dialog.getByRole("button", { name: t.add, exact: true }).click();
      const alert = dialog.getByRole("alert").filter({ hasText: t.customMealNameRequired });
      await expect(alert).toBeInViewport();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
      await expect(ingredients).toHaveValue("2 tortillas");
      const nameBox = (await name.boundingBox())!;
      const alertBox = (await alert.boundingBox())!;
      expect(alertBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);

      // Nothing posted: the week has no meal.
      await withDb(async (client) => {
        const { rowCount } = await client.query(
          `SELECT 1 FROM "MealPlanEntry" e JOIN "MealPlan" p ON p.id = e."mealPlanId"
           WHERE p."householdId" = $1 AND p."weekStartDate" = $2`,
          [E2E_HOUSEHOLD.id, week],
        );
        expect(rowCount).toBe(0);
      });

      await name.fill("Taco night");
      await expect(alert).toHaveCount(0);
      await expect(name).not.toHaveAttribute("aria-invalid", "true");
    });
  });
}
