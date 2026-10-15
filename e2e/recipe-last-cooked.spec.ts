import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, openRowSheet } from "./ui";

// GAP-46: each recipe on the Recipes tab says how often it was cooked and
// when last ("Cooked 3 times, last 12 Sep"), counted from the entries marked
// as cooked, and says nothing for a recipe never cooked.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const key = (day: Date) => day.toISOString().slice(0, 10);
const mondayOf = (day: Date) => new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);

// Two entries already cooked (in the past) and one planned for a day far
// ahead, where no other spec plans anything; plus a recipe never cooked.
async function seed(cookedName: string, neverName: string, plannedDay: Date) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const suffix = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const cookedId = `e2e-recipe-${suffix}`;
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3), ($4, $2, $5)`, [
      cookedId,
      E2E_HOUSEHOLD.id,
      cookedName,
      `e2e-recipe-${suffix}-never`,
      neverName,
    ]);
    const entries = [
      { day: new Date("2026-08-03T00:00:00Z"), cooked: new Date("2026-08-03T18:00:00Z") },
      { day: new Date("2026-08-10T00:00:00Z"), cooked: new Date("2026-08-10T18:00:00Z") },
      { day: plannedDay, cooked: null },
    ];
    for (const [i, entry] of entries.entries()) {
      const monday = mondayOf(entry.day);
      await client.query(
        `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
         ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
        [`e2e-plan-${suffix}-${i}`, E2E_HOUSEHOLD.id, monday],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", "consumedAt")
         SELECT $1, plan.id, $2, 'DINNER', $3, $4
         FROM "MealPlan" plan WHERE plan."householdId" = $5 AND plan."weekStartDate" = $6`,
        [`e2e-entry-${suffix}-${i}`, entry.day, cookedId, entry.cooked, E2E_HOUSEHOLD.id, monday],
      );
    }
  } finally {
    await client.end();
  }
}

test("a recipe shows how often it was cooked and when last, and a never-cooked one shows nothing", async ({
  page,
}) => {
  const cookedName = unique("Pasta bake");
  const neverName = unique("Fish pie");
  const today = new Date();
  const plannedDay = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) +
      (365 + Math.floor(Math.random() * 5000)) * DAY_MS,
  );
  await seed(cookedName, neverName, plannedDay);

  // Cook the planned entry through the UI: the third time, last today.
  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(plannedDay))}`);
  await (await openRowSheet(page, cookedName)).getByRole("button", { name: "Mark as cooked" }).click();
  await page
    .getByRole("dialog", { name: "Mark as cooked" })
    .getByRole("button", { name: "Mark as cooked" })
    .click();
  await expect(page.getByRole("dialog", { name: "Mark as cooked" })).toHaveCount(0);

  const todayLabel = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(),
  );

  // Reload first: the point is that the count is read back from the database.
  await page.goto("/dashboard/meal-planning");
  await page.getByRole("tab", { name: "Recipes" }).click();
  const search = page.getByPlaceholder("Search recipes…").filter({ visible: true });
  await search.fill(cookedName);
  await expect(page.getByText(`Cooked 3 times, last ${todayLabel}`)).toBeVisible();

  await search.fill(neverName);
  await expect(page.getByText(neverName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Cooked \d+ times?/)).toHaveCount(0);
});
