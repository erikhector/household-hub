import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, openRowSheet } from "./ui";

// GAP-39: after "Mark as cooked" records leftovers, the toast offers "Plan
// leftovers", which opens the add-to-plan dialog prefilled with the recipe,
// the leftover servings and the next day with no dinner. Nothing is added
// unless the household confirms.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

function utcDay(offset: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY_MS);
}

// The desktop and mobile runs share one household and its dinners, and other
// specs plan dinners for the days around today, so "the next day with no
// dinner" would depend on which ran first. Each test therefore plans on its
// own days a long way ahead (1-14 years, picked at random) where nothing else
// is, which keeps the expected suggestion exact.
function farOffset() {
  return 365 + Math.floor(Math.random() * 5000);
}

function mondayOf(day: Date) {
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

const key = (day: Date) => day.toISOString().slice(0, 10);

// A recipe to cook on day `base`, plus a dinner already planned the day
// after, so the suggestion has to skip a day: base + 2.
async function planCookAndDinnerNextDay(recipeName: string, base: number) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const suffix = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const recipeId = `e2e-recipe-${suffix}`;
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      recipeId,
      E2E_HOUSEHOLD.id,
      recipeName,
    ]);
    const rows = [
      { day: utcDay(base), recipe: recipeId, freeform: null },
      { day: utcDay(base + 1), recipe: null, freeform: `Takeaway ${suffix}` },
    ];
    for (const [i, row] of rows.entries()) {
      const monday = mondayOf(row.day);
      await client.query(
        `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
         ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
        [`e2e-plan-${suffix}-${i}`, E2E_HOUSEHOLD.id, monday],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", "freeformName")
         SELECT $1, plan.id, $2, 'DINNER', $3, $4
         FROM "MealPlan" plan WHERE plan."householdId" = $5 AND plan."weekStartDate" = $6`,
        [`e2e-entry-${suffix}-${i}`, row.day, row.recipe, row.freeform, E2E_HOUSEHOLD.id, monday],
      );
    }
  } finally {
    await client.end();
  }
}

// DESIGN.md M3: on a phone both toast buttons are at least 44 x 44 px with
// at least 8 px between them. Desktop keeps Sonner's compact buttons.
async function expectToastButtonsTappable(page: Page, planLeftovers: Locator) {
  if (!(page.viewportSize() && page.viewportSize()!.width < 640)) return;
  const undo = page.getByRole("button", { name: "Undo" });
  // Polled until the toast has finished sliding in: mid-animation its scale
  // makes the buttons a hair under 44 px (seen once the toast moved to the
  // top on phones, UX-48).
  await expect
    .poll(async () => (await planLeftovers.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(44);
  const [a, b] = [await planLeftovers.boundingBox(), await undo.boundingBox()];
  expect(a && b).toBeTruthy();
  for (const box of [a!, b!]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const gap = Math.max(a!.x - (b!.x + b!.width), b!.x - (a!.x + a!.width));
  expect(gap).toBeGreaterThanOrEqual(8);
}

// Cooks the recipe's planned entry with 2 servings left over and taps
// "Plan leftovers" on the toast.
async function cookWithLeftoversAndPlan(page: Page, recipeName: string, base: number) {
  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(utcDay(base)))}`);
  await (await openRowSheet(page, recipeName)).getByRole("button", { name: "Mark as cooked" }).click();
  const cooked = page.getByRole("dialog", { name: "Mark as cooked" });
  await cooked.getByRole("spinbutton", { name: "Servings left over" }).fill("2");
  await cooked.getByRole("button", { name: "Mark as cooked" }).click();
  const planLeftovers = page.getByRole("button", { name: "Plan leftovers" });
  await expect(planLeftovers).toBeVisible();
  await expectToastButtonsTappable(page, planLeftovers);
  await planLeftovers.click();
  const dialog = page.getByRole("dialog", { name: `Add ${recipeName} to the plan` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Plan leftovers opens the add-to-plan dialog on the next free dinner day, and confirming adds it", async ({
  page,
}) => {
  const recipeName = unique("Lasagna");
  const base = farOffset();
  await planCookAndDinnerNextDay(recipeName, base);

  const dialog = await cookWithLeftoversAndPlan(page, recipeName, base);
  // Tomorrow already has a dinner, so the day after is suggested.
  await expect(dialog.getByLabel("Date")).toHaveValue(key(utcDay(base + 2)));
  await expect(dialog.getByRole("spinbutton", { name: "Portions" })).toHaveValue("2");
  await expect(dialog.getByRole("combobox", { name: "Meal" })).toHaveText(/^Dinner/);

  await dialog.getByRole("button", { name: "Add to plan" }).click();
  await expect(dialog).toHaveCount(0);

  // Saved: still there after a reload, on the week that day falls in. That
  // week also holds tonight's cooked entry when both days share a week.
  const sameWeek = key(mondayOf(utcDay(base))) === key(mondayOf(utcDay(base + 2)));
  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(utcDay(base + 2)))}`);
  await expect(page.getByText(recipeName).filter({ visible: true })).toHaveCount(sameWeek ? 2 : 1);
  // GAP-49: the leftovers are a meal-prep batch, and the new slot eats from
  // it, so it (and not the cooked entry) carries the Prepped badge, which
  // sits in the meal's row (the button that opens its sheet).
  await expect(
    page
      .getByText(recipeName, { exact: true })
      .filter({ visible: true })
      .locator("xpath=ancestor::button[1]")
      .getByText("Prepped", { exact: true }),
  ).toHaveCount(1);
});

test("dismissing Plan leftovers adds nothing", async ({ page }) => {
  const recipeName = unique("Chili");
  const base = farOffset();
  await planCookAndDinnerNextDay(recipeName, base);

  const dialog = await cookWithLeftoversAndPlan(page, recipeName, base);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(utcDay(base + 2)))}`);
  const sameWeek = key(mondayOf(utcDay(base))) === key(mondayOf(utcDay(base + 2)));
  await expect(page.getByText(recipeName).filter({ visible: true })).toHaveCount(sameWeek ? 1 : 0);
});
