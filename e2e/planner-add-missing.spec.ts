import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-91: a planned week has a labelled, bottom-anchored "Add N missing to
// shopping list" button (not just the ⋯ menu), hidden on an empty week; the
// toast after adding names the count and links to the list. The spec seeds a
// recipe with two ingredients no pantry item matches, plans it in a far-future
// week of its own (per project, since the add test changes the list), and
// removes everything it made.
const EMPTY_WEEK = "2031-03-03";
const plannedWeek = (project: string) => (project === "mobile" ? "2031-03-17" : "2031-03-10");

const tag = `${E2E_WORKER}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const sheets = `Lasagne sheets ${tag}`;
const ricotta = `Ricotta ${tag}`;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await dismissCookieNotice(context, baseURL!);
  const week = plannedWeek(testInfo.project.name);
  await withClient(async (client) => {
    const recipe = `e2e-recipe-${tag}`;
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      recipe,
      E2E_HOUSEHOLD.id,
      `Lasagne ${tag}`,
    ]);
    await client.query(
      `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit)
       VALUES ($1, $3, $4, 12, 'pcs'), ($2, $3, $5, 2, 'pcs')`,
      [`${recipe}-a`, `${recipe}-b`, recipe, sheets, ricotta],
    );
    // The app creates a week's MealPlan itself the first time it needs one, and
    // that row has its own id, so a plain insert collides on
    // (householdId, weekStartDate) whenever a row for the week already exists
    // (the flaky mobile failure, MAINT-35). Upsert and hang the entry off
    // whichever row is there. The no-op DO UPDATE is what makes RETURNING
    // give back the existing row's id.
    const plan = await client.query<{ id: string }>(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO UPDATE SET "weekStartDate" = EXCLUDED."weekStartDate"
       RETURNING id`,
      [`e2e-plan-${tag}-${week}`, E2E_HOUSEHOLD.id, week],
    );
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", portions)
       VALUES ($1, $2, $3, 'DINNER', $4, 4)`,
      [`e2e-entry-${tag}-${week}`, plan.rows[0].id, week, recipe],
    );
  });
});

test.afterEach(async () => {
  await withClient(async (client) => {
    // By week, not by our id prefix: a plan the app created for these
    // far-future weeks has a different id and would otherwise outlive the test.
    await client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = ANY($2::date[])`, [
      E2E_HOUSEHOLD.id,
      [EMPTY_WEEK, plannedWeek("mobile"), plannedWeek("desktop")],
    ]);
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id = $2`, [
      E2E_HOUSEHOLD.id,
      `e2e-recipe-${tag}`,
    ]);
    await client.query(
      `DELETE FROM "ShoppingListItem" WHERE name IN ($1, $2)
         AND "shoppingListId" IN (SELECT id FROM "ShoppingList" WHERE "householdId" = $3)`,
      [sheets, ricotta, E2E_HOUSEHOLD.id],
    );
  });
});

test("an empty week has no Add missing button", async ({ page }) => {
  await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);
  await expect(page.getByRole("button", { name: "Add your first dinner" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add \d+ missing to shopping list$/ })).toHaveCount(0);
});

test("a planned week's primary button adds the missing items and the toast opens the list", async ({
  page,
}, testInfo) => {
  await page.goto(`/dashboard/meal-planning?week=${plannedWeek(testInfo.project.name)}`);

  const button = page.getByRole("button", { name: "Add 2 missing to shopping list" });
  await expect(button).toBeVisible();
  if (testInfo.project.name === "mobile") {
    // M2: floating in the bottom half, above the bottom bar, a 48 px target.
    const box = await button.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y).toBeGreaterThan(viewport.height / 2);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  }

  await button.click();
  const dialog = page.getByRole("dialog", { name: "Add missing ingredients" });
  await expect(dialog.getByText(sheets)).toBeVisible();
  await expect(dialog.getByText(ricotta)).toBeVisible();
  await dialog.getByRole("button", { name: "Add to list", exact: true }).click();

  await expect(page.getByText(/^Added 2 items to ".+"$/)).toBeVisible();
  await page.getByRole("button", { name: "Open list", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/]+$/);
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${sheets}`) })).toBeVisible();
});
