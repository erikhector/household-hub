import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, gotoRevealed, waitForDialogHistory } from "./ui";

// Week picks' desktop drag and drop (REQUIREMENTS.md, "Week picks"): a pick
// dragged onto a day lands on its dinner, and a planned meal dragged back up
// to the tray becomes a pick again. Desktop only: phones place through the
// pick's sheet (week-picks.spec.ts), and there's no drag on a touch screen.
const WEEK = "2032-06-14";
const tag = `${E2E_WORKER}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const meal = `Tacos ${tag}`;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await withClient(async (client) => {
    const plan = await client.query<{ id: string }>(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO UPDATE SET "weekStartDate" = EXCLUDED."weekStartDate"
       RETURNING id`,
      [`e2e-plan-${tag}`, E2E_HOUSEHOLD.id, WEEK],
    );
    await client.query(`INSERT INTO "MealPlanPick" (id, "mealPlanId", "freeformName") VALUES ($1, $2, $3)`, [
      `e2e-pick-${tag}`,
      plan.rows[0].id,
      meal,
    ]);
  });
});

test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = $2`, [E2E_HOUSEHOLD.id, WEEK]),
  );
});

const tray = (page: Page) => page.getByRole("region", { name: "Picked for this week" });
const dayCard = (page: Page, day: string) =>
  page.getByRole("main").locator("[data-slot=card]").filter({ has: page.getByText(day, { exact: true }) });

test("drag a pick onto a day, then the meal back to the tray", async ({ page }) => {
  await gotoRevealed(page, `/dashboard/meal-planning?week=${WEEK}`);
  const chip = tray(page).getByRole("button", { name: new RegExp(`^${meal}`) });
  await expectHydrated(chip);

  await chip.dragTo(dayCard(page, "Wed"));
  await expect(page.getByText(/^Placed as dinner on Wed \d+$/)).toBeVisible();
  const row = dayCard(page, "Wed").getByText(meal, { exact: true });
  await expect(row).toBeVisible();
  await expect(chip).toHaveCount(0);

  await row.dragTo(tray(page));
  await expect(page.getByText(`${meal} is back in your picks`)).toBeVisible();
  await expect(chip).toBeVisible();

  await waitForDialogHistory(page);
  await page.reload();
  await expect(chip).toBeVisible();
  await expect(dayCard(page, "Wed").getByText(meal, { exact: true })).toHaveCount(0);
});
