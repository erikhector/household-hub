import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { withCurrentWeekMeal } from "./current-week-meal";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-99: today's card in the weekly planner says "Today" in words and carries
// aria-current="date" (the purple ring alone is colour only), and the seven
// "Add meal" buttons and the recipe stars are each named for what they act on.
const suffix = Math.random().toString(36).slice(2, 8);
const recipeId = `e2e-ux99-${E2E_WORKER}-${suffix}`;
const recipeName = `Greek salad ${suffix}`;

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
  await withClient((client) =>
    client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [recipeId, E2E_HOUSEHOLD.id, recipeName]),
  );
});

test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, recipeId]),
  );
});

test("today's card says Today and is the current date; day buttons are named by day", async ({ page }) => {
  // UX-50: an empty week has no day cards, so plan one meal today first.
  await withCurrentWeekMeal(`names-${suffix}`, async () => {
    await page.goto("/dashboard/meal-planning");

    const today = page.locator('[aria-current="date"]').filter({ visible: true });
    await expect(today).toHaveCount(1);
    await expect(today.getByText("Today", { exact: true })).toBeVisible();
    // Only today's card has the badge.
    await expect(page.getByText("Today", { exact: true }).filter({ visible: true })).toHaveCount(1);

    const adds = page.getByRole("button", { name: /^Add meal, (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+$/ });
    await expect(adds).toHaveCount(7);
    const names = await adds.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(new Set(names).size).toBe(7);
    // The button inside today's card is named for today's date.
    await expect(today.getByRole("button", { name: /^Add meal, / })).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });
});

test("a recipe's star is named for the recipe", async ({ page }) => {
  await page.goto(`/dashboard/meal-planning?tab=recipes`);
  await expect(page.getByRole("button", { name: `Favorite ${recipeName}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Favorite recipe", exact: true })).toHaveCount(0);
});
