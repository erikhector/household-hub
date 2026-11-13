import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, gotoRevealed } from "./ui";

// GAP-80: the Recipes tab sorts A–Z by default and can sort by longest since
// cooked (never cooked, then longest ago, first) or most cooked. Two recipes share a unique tag so a
// search narrows the list to just them, and only their relative order is
// asserted: other specs cook recipes in the same household. A (cooked twice,
// most recently) is named so it sorts after B alphabetically, so each sort
// visibly moves something.
const t = en.mealPlanning;
const tag = `Sort ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nameA = `${tag} Zucchini bake`;
const nameB = `${tag} Apple tart`;
const suffix = `${E2E_WORKER}-${tag.replace(/\W/g, "")}`;
const idA = `e2e-recipe-${suffix}-a`;
const idB = `e2e-recipe-${suffix}-b`;
const DAY_MS = 24 * 60 * 60 * 1000;
const mondayOf = (day: Date) => new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);

// Cooked entries in 2025, a year no other spec plans in. B's one cook is
// older than either of A's.
const cooks = [
  { recipeId: idB, day: new Date("2025-02-03T00:00:00Z") },
  { recipeId: idA, day: new Date("2025-02-10T00:00:00Z") },
  { recipeId: idA, day: new Date("2025-02-17T00:00:00Z") },
];
const entryIds = cooks.map((_, i) => `e2e-entry-${suffix}-${i}`);

async function withDb(run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.beforeAll(async () => {
  await withDb(async (client) => {
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3), ($4, $2, $5)`, [
      idA,
      E2E_HOUSEHOLD.id,
      nameA,
      idB,
      nameB,
    ]);
    for (const [i, cook] of cooks.entries()) {
      const monday = mondayOf(cook.day);
      await client.query(
        `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
         ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
        [`e2e-plan-${suffix}-${i}`, E2E_HOUSEHOLD.id, monday],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", "consumedAt")
         SELECT $1, plan.id, $2, 'DINNER', $3, $4
         FROM "MealPlan" plan WHERE plan."householdId" = $5 AND plan."weekStartDate" = $6`,
        [entryIds[i], cook.day, cook.recipeId, new Date(cook.day.getTime() + 18 * 60 * 60 * 1000), E2E_HOUSEHOLD.id, monday],
      );
    }
  });
});

test.afterAll(async () => {
  await withDb(async (client) => {
    await client.query(
      `DELETE FROM "MealPlanEntry" WHERE id = ANY($1) AND "mealPlanId" IN (SELECT id FROM "MealPlan" WHERE "householdId" = $2)`,
      [entryIds, E2E_HOUSEHOLD.id],
    );
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id = ANY($2)`, [E2E_HOUSEHOLD.id, [idA, idB]]);
  });
});

// The two rows' names in list order.
const rowOrder = (page: Page) =>
  page.getByRole("main").getByText(new RegExp(`^${tag} `)).filter({ visible: true }).allTextContents();

async function pickSort(page: Page, label: string) {
  await page.getByRole("combobox", { name: t.recipeSortLabel }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(page.getByRole("combobox", { name: t.recipeSortLabel })).toContainText(label);
}

test("the recipe list sorts by most cooked and by longest since cooked", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/meal-planning?tab=recipes");
  const sort = page.getByRole("combobox", { name: t.recipeSortLabel });
  await expectHydrated(sort);
  await expect(sort).toContainText(t.recipeSortName);
  await page.getByPlaceholder(t.searchRecipesPlaceholder).filter({ visible: true }).fill(tag);

  // Default A–Z: the apple tart first.
  await expect.poll(() => rowOrder(page)).toEqual([nameB, nameA]);

  await pickSort(page, t.recipeSortMostCooked);
  await expect.poll(() => rowOrder(page)).toEqual([nameA, nameB]);

  await pickSort(page, t.recipeSortLastCooked);
  await expect.poll(() => rowOrder(page)).toEqual([nameB, nameA]);

  // The sort shares the filters' row; nothing is wider than a phone.
  await expectNoHorizontalOverflow(page);
});
