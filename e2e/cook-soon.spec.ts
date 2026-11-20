import { expect, test } from "@playwright/test";
import { mondayOf, uniqueTag, withDb } from "./db";
import { en } from "@/lib/i18n/dictionaries/en";
import { farDay } from "./far-weeks";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, openRowSheet, waitForDialogHistory } from "./ui";

// GAP-51: a recipe's sheet has a "Cook soon" toggle that pins the recipe to a
// shelf at the top of the Recipes tab, and the shelf empties itself once the
// recipe is planned or cooked. Each test seeds its own recipe (and, for the
// cooked case, a meal in a far-future week nobody else plans in) and removes
// them again, so the shared seeded recipes stay untouched.
const t = en.mealPlanning;
const key = (day: Date) => day.toISOString().slice(0, 10);

let name: string;
let recipeId: string;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const tag = uniqueTag();
  name = `Chili ${tag}`;
  recipeId = `e2e-recipe-cooksoon-${E2E_WORKER}-${tag}`;
  await withDb((client) =>
    client.query(`INSERT INTO "Recipe" (id, "householdId", name, instructions) VALUES ($1, $2, $3, 'Simmer')`, [
      recipeId,
      E2E_HOUSEHOLD.id,
      name,
    ]),
  );
});

test.afterEach(async () => {
  await withDb(async (client) => {
    await client.query(
      `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
       WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND entry."recipeId" = $2`,
      [E2E_HOUSEHOLD.id, recipeId],
    );
    await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
  });
});

test("toggling Cook soon pins the recipe to the shelf, survives a reload, and toggles off", async ({ page }) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");
  const shelf = page.getByRole("region", { name: t.cookSoonTitle, exact: true });
  await expect(shelf).toHaveCount(0);

  await (await openRowSheet(page, name)).getByRole("button", { name: t.cookSoonAdd, exact: true }).click();
  await expect(page.getByText(`${name} added to Cook soon`)).toBeVisible();
  await expect(shelf.getByText(name, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await waitForDialogHistory(page);
  await page.reload();
  await expect(shelf.getByText(name, { exact: true })).toBeVisible();

  await (await openRowSheet(page, name)).getByRole("button", { name: t.cookSoonRemove, exact: true }).click();
  await expect(page.getByText(`${name} removed from Cook soon`)).toBeVisible();
  await expect(shelf).toHaveCount(0);

  await waitForDialogHistory(page);
  await page.reload();
  await expect(page.getByRole("main").getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(shelf).toHaveCount(0);
});

test("planning a Cook soon recipe takes it off the shelf", async ({ page }) => {
  const day = farDay("cook-soon");
  await page.goto("/dashboard/meal-planning?tab=recipes");
  const shelf = page.getByRole("region", { name: t.cookSoonTitle, exact: true });

  await (await openRowSheet(page, name)).getByRole("button", { name: t.cookSoonAdd, exact: true }).click();
  await expect(shelf.getByText(name, { exact: true })).toBeVisible();

  await (await openRowSheet(page, name)).getByRole("button", { name: t.addToPlanButton, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Add ${name} to the plan` });
  await dialog.getByLabel(t.dateLabel).fill(key(day));
  await dialog.getByRole("button", { name: t.addToPlanSubmit, exact: true }).click();
  await expect(page.getByText(`Added ${name} to the plan`)).toBeVisible();

  await waitForDialogHistory(page);
  await page.reload();
  await expect(page.getByRole("main").getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(shelf).toHaveCount(0);
});

test("marking a Cook soon recipe as cooked takes it off the shelf", async ({ page }) => {
  // A meal in a week of its own years ahead, planned straight in the
  // database along with the queueing: queueing first and planning through
  // the UI would clear the shelf at planning time, before the cook.
  const day = farDay("cook-soon");
  const monday = mondayOf(day);
  const tag = uniqueTag();
  await withDb(async (client) => {
    await client.query(`UPDATE "Recipe" SET "cookSoonAt" = now() WHERE id = $1`, [recipeId]);
    await client.query(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
      [`e2e-plan-cooksoon-${tag}`, E2E_HOUSEHOLD.id, monday],
    );
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", portions)
       SELECT $1, plan.id, $2, 'DINNER', $3, 4
       FROM "MealPlan" plan WHERE plan."householdId" = $4 AND plan."weekStartDate" = $5`,
      [`e2e-entry-cooksoon-${tag}`, day, recipeId, E2E_HOUSEHOLD.id, monday],
    );
  });

  await page.goto("/dashboard/meal-planning?tab=recipes");
  const shelf = page.getByRole("region", { name: t.cookSoonTitle, exact: true });
  await expect(shelf.getByText(name, { exact: true })).toBeVisible();

  await page.goto(`/dashboard/meal-planning?week=${key(monday)}`);
  await (await openRowSheet(page, name)).getByRole("button", { name: t.markCookedAriaLabel }).click();
  const cooked = page.getByRole("dialog", { name: t.markCookedDialogTitle });
  await cooked.getByRole("button", { name: t.markCookedSubmit }).click();
  await expect(cooked).toHaveCount(0);

  await page.goto("/dashboard/meal-planning?tab=recipes");
  await expect(page.getByRole("main").getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(shelf).toHaveCount(0);
});
