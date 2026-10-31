import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  gotoRevealed,
  openRowSheet,
  waitForDialogHistory,
} from "./ui";

// Week picks (REQUIREMENTS.md, "Week picks"): the planner's "Picked for this
// week" tray. Pick a meal, see it counted toward the shopping list, put it on
// a day, send it back to the tray, and spread several over the week with one
// Undo. Desktop places by click-to-lift ("Place here" on a day), the phone by
// the pick's place sheet; both are the click paths for the drag, which
// week-picks-drag.desktop.spec.ts covers. Each test plans its own far-future
// week (one per project, since both may share a worker's household), so every
// dinner is free and nothing carries over.

const tag = `${E2E_WORKER}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const curry = `Curry ${tag}`;
const salmon = `Salmon ${tag}`;
const coconut = `Coconut milk ${tag}`;
const fillet = `Salmon fillet ${tag}`;

// Mondays, a pair per test so desktop and mobile never share a week.
const WEEKS = {
  pick: { desktop: "2032-05-03", mobile: "2032-05-10" },
  spread: { desktop: "2032-05-17", mobile: "2032-05-24" },
} as const;
const ALL_WEEKS = Object.values(WEEKS).flatMap((w) => [w.desktop, w.mobile]);
const weekFor = (which: keyof typeof WEEKS, testInfo: TestInfo) =>
  WEEKS[which][testInfo.project.name === "mobile" ? "mobile" : "desktop"];

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// The same upsert as planner-add-missing.spec.ts: the app may already have
// made the week's plan, with an id of its own.
async function planFor(client: Client, week: string): Promise<string> {
  const plan = await client.query<{ id: string }>(
    `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
     ON CONFLICT ("householdId", "weekStartDate") DO UPDATE SET "weekStartDate" = EXCLUDED."weekStartDate"
     RETURNING id`,
    [`e2e-plan-${tag}-${week}`, E2E_HOUSEHOLD.id, week],
  );
  return plan.rows[0].id;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await withClient(async (client) => {
    // Two recipes, one unstocked ingredient each, so each pick is "1 missing".
    for (const [suffix, name, ingredient] of [
      ["curry", curry, coconut],
      ["salmon", salmon, fillet],
    ]) {
      const id = `e2e-recipe-${tag}-${suffix}`;
      await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [
        id,
        E2E_HOUSEHOLD.id,
        name,
      ]);
      await client.query(
        `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit) VALUES ($1, $2, $3, 1, 'pcs')`,
        [`${id}-a`, id, ingredient],
      );
    }
  });
});

test.afterEach(async () => {
  await withClient(async (client) => {
    // By week, not id: plans the app made for these weeks have their own ids.
    // Their entries and picks go with them.
    await client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = ANY($2::date[])`, [
      E2E_HOUSEHOLD.id,
      ALL_WEEKS,
    ]);
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `e2e-recipe-${tag}-%`,
    ]);
  });
});

const tray = (page: Page) => page.getByRole("region", { name: "Picked for this week" });
const chip = (page: Page, name: string) => tray(page).getByRole("button", { name: new RegExp(`^${name}`) });
const dayCard = (page: Page, day: string) =>
  page.getByRole("main").locator("[data-slot=card]").filter({ has: page.getByText(day, { exact: true }) });

async function openPlanner(page: Page, week: string) {
  await gotoRevealed(page, `/dashboard/meal-planning?week=${week}`);
  await expect(tray(page)).toBeVisible();
  await expectHydrated(tray(page).getByRole("button").first());
  await expectRouterPatched(page);
}

test("pick a meal, shop for it, place it and send it back to the tray", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  await openPlanner(page, weekFor("pick", testInfo));
  await expect(tray(page).getByText("Pick the meals you want this week, then place them on days.")).toBeVisible();

  // Pick: several at once is the point, but one is enough to follow it round.
  await tray(page).getByRole("button", { name: "Pick meals" }).click();
  const picker = page.getByRole("dialog", { name: /^Pick meals for / });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: "Tick a meal to add it" })).toBeDisabled();
  await picker.getByRole("checkbox", { name: curry }).check();
  await expect(picker.getByRole("group", { name: `Portions of ${curry}` })).toBeVisible();
  await picker.getByRole("button", { name: `More portions of ${curry}` }).click();
  await picker.getByRole("button", { name: "Add 1 meal", exact: true }).click();
  await expect(page.getByText("Added 1 meal to this week's picks")).toBeVisible();
  await expect(chip(page, curry)).toContainText("5 ptn");
  if (mobile) await expectNoHorizontalOverflow(page);

  // Shop: the pick counts before it has a day, grouped as "Not on a day yet".
  const shop = page.getByRole("button", { name: "Add 1 missing to shopping list" });
  await expect(shop).toBeVisible();
  await shop.click();
  const review = page.getByRole("dialog", { name: "Add missing ingredients" });
  await expect(review.getByText("Not on a day yet")).toBeVisible();
  await expect(review.getByText(coconut)).toBeVisible();
  await page.keyboard.press("Escape");
  await waitForDialogHistory(page);

  // Place it on Tuesday's dinner.
  if (mobile) {
    await chip(page, curry).click();
    const sheet = page.getByRole("dialog", { name: `Place ${curry}` });
    await expect(sheet.getByRole("button", { name: "Dinner", pressed: true })).toBeVisible();
    await sheet.getByRole("button", { name: /^Tue \d+ Dinner free$/ }).click();
  } else {
    await chip(page, curry).click();
    await expect(chip(page, curry)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: new RegExp(`^Place ${curry} on Tue \\d+$`) }).click();
  }
  await expect(page.getByText(/^Placed on Tue \d+$/)).toBeVisible();
  await expect(dayCard(page, "Tue").getByText(curry, { exact: true })).toBeVisible();
  await expect(tray(page).getByText("Every pick is on a day.")).toBeVisible();

  await waitForDialogHistory(page);
  await page.reload();
  await expect(dayCard(page, "Tue").getByText(curry, { exact: true })).toBeVisible();
  await expect(chip(page, curry)).toHaveCount(0);

  // Back to picks, from the meal's own sheet.
  await expectHydrated(dayCard(page, "Tue").getByRole("button").first());
  const sheet = await openRowSheet(page, curry);
  await sheet.getByRole("button", { name: "Back to picks" }).click();
  await expect(page.getByText(`${curry} is back in your picks`)).toBeVisible();
  await expect(chip(page, curry)).toBeVisible();
  await expect(dayCard(page, "Tue").getByText(curry, { exact: true })).toHaveCount(0);

  await waitForDialogHistory(page);
  await page.reload();
  await expect(chip(page, curry)).toContainText("5 ptn");
});

test("spread picks over the week, then undo it in one go", async ({ page }, testInfo) => {
  const week = weekFor("spread", testInfo);
  await withClient(async (client) => {
    const plan = await planFor(client, week);
    await client.query(
      `INSERT INTO "MealPlanPick" (id, "mealPlanId", "recipeId", portions, "createdAt")
       VALUES ($1, $3, $4, 4, now() - interval '1 minute'), ($2, $3, $5, 4, now())`,
      [`e2e-pick-${tag}-a`, `e2e-pick-${tag}-b`, plan, `e2e-recipe-${tag}-curry`, `e2e-recipe-${tag}-salmon`],
    );
  });
  await openPlanner(page, week);
  await expect(chip(page, curry)).toBeVisible();
  await expect(chip(page, salmon)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add 2 missing to shopping list" })).toBeVisible();

  await tray(page).getByRole("button", { name: "Spread over the week" }).click();
  const preview = page.getByRole("dialog", { name: "Spread 2 meals over the week" });
  await expect(preview.getByText("Next free dinner")).toHaveCount(2);
  await preview.getByRole("button", { name: "Place all 2" }).click();

  await expect(page.getByText("Placed 2 meals on the week")).toBeVisible();
  await expect(dayCard(page, "Mon").getByText(curry, { exact: true })).toBeVisible();
  await expect(dayCard(page, "Tue").getByText(salmon, { exact: true })).toBeVisible();
  await expect(chip(page, curry)).toHaveCount(0);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chip(page, curry)).toBeVisible();
  await expect(chip(page, salmon)).toBeVisible();
  await expect(dayCard(page, "Mon").getByText(curry, { exact: true })).toHaveCount(0);

  await waitForDialogHistory(page);
  await page.reload();
  await expect(chip(page, curry)).toBeVisible();
  await expect(chip(page, salmon)).toBeVisible();
});
