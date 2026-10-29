import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, openRecipesTab, openRowSheet } from "./ui";

// GAP-55: a recipe's sheet on the Recipes tab says when it is next on the
// plan ("Planned: Tue 21 Oct, Sat 25 Oct"), each date linking to that week
// of the planner, and says nothing for a recipe that isn't planned.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const key = (day: Date) => day.toISOString().slice(0, 10);
const mondayOf = (day: Date) => new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
const label = (day: Date) =>
  new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(day);

async function seed(plannedName: string, idleName: string, days: Date[]) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const suffix = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const plannedId = `e2e-recipe-${suffix}`;
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3), ($4, $2, $5)`, [
      plannedId,
      E2E_HOUSEHOLD.id,
      plannedName,
      `e2e-recipe-${suffix}-idle`,
      idleName,
    ]);
    for (const [i, day] of days.entries()) {
      const monday = mondayOf(day);
      await client.query(
        `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
         ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
        [`e2e-plan-${suffix}-${i}`, E2E_HOUSEHOLD.id, monday],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId")
         SELECT $1, plan.id, $2, 'DINNER', $3
         FROM "MealPlan" plan WHERE plan."householdId" = $4 AND plan."weekStartDate" = $5`,
        [`e2e-entry-${suffix}-${i}`, day, plannedId, E2E_HOUSEHOLD.id, monday],
      );
    }
  } finally {
    await client.end();
  }
}

test("a planned recipe lists its next dates, each linking to its week, and an unplanned one shows nothing", async ({
  page,
}) => {
  const plannedName = unique("Lentil stew");
  const idleName = unique("Leek tart");
  const today = new Date();
  // Far ahead, where no other spec plans anything, and in two different
  // weeks so the links differ. Four days: the fourth must not show.
  const first = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) +
      (400 + Math.floor(Math.random() * 5000)) * DAY_MS,
  );
  const days = [0, 1, 8, 9].map((offset) => new Date(first.getTime() + offset * DAY_MS));
  await seed(plannedName, idleName, days);

  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  const search = page.getByPlaceholder("Search recipes…").filter({ visible: true });
  await search.fill(plannedName);
  const sheet = await openRowSheet(page, plannedName);

  await expect(sheet.getByText(`Planned: ${days.slice(0, 3).map(label).join(", ")}`)).toBeVisible();
  await expect(sheet.getByText(label(days[3]))).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: label(days[2]) })).toHaveAttribute(
    "href",
    `/dashboard/meal-planning?week=${key(mondayOf(days[2]))}`,
  );

  // The link lands on that week of the planner. The URL only changes once
  // Next has fetched and committed the new week's server render (a dynamic
  // page, behind the router's pending tab-restore), and under a loaded
  // runner that took 4.8 s to 9 s: the 5 s default expired while the
  // push was still on its way (MAINT-70, a pushState 4.8 s after the click).
  await sheet.getByRole("link", { name: label(days[2]) }).click();
  await expect(page).toHaveURL(new RegExp(`week=${key(mondayOf(days[2]))}`), { timeout: 15_000 });

  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  await page.getByPlaceholder("Search recipes…").filter({ visible: true }).fill(idleName);
  const idleSheet = await openRowSheet(page, idleName);
  await expect(idleSheet.getByText(/Planned:/)).toHaveCount(0);
});
