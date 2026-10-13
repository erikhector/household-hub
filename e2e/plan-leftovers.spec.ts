import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

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

function mondayOf(day: Date) {
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

const key = (day: Date) => day.toISOString().slice(0, 10);

// A recipe cooked-able tonight, plus a dinner already planned tomorrow, so
// the suggestion has to skip a day: today + 2.
async function planCookTonightAndDinnerTomorrow(recipeName: string) {
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
      { day: utcDay(0), recipe: recipeId, freeform: null },
      { day: utcDay(1), recipe: null, freeform: `Takeaway ${suffix}` },
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

// Cooks the recipe's planned entry with 2 servings left over and taps
// "Plan leftovers" on the toast.
async function cookWithLeftoversAndPlan(page: Page, recipeName: string) {
  await page.goto("/dashboard/meal-planning");
  const entry = page
    .locator("div")
    .filter({ has: page.getByText(recipeName) })
    .filter({ has: page.getByRole("button", { name: "Mark as cooked" }) })
    .filter({ visible: true })
    .last();
  await entry.getByRole("button", { name: "Mark as cooked" }).click();
  const cooked = page.getByRole("dialog", { name: "Mark as cooked" });
  await cooked.getByRole("spinbutton", { name: "Servings left over" }).fill("2");
  await cooked.getByRole("button", { name: "Mark as cooked" }).click();
  await page.getByRole("button", { name: "Plan leftovers" }).click();
  const dialog = page.getByRole("dialog", { name: `Add ${recipeName} to the plan` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Plan leftovers opens the add-to-plan dialog on the next free dinner day, and confirming adds it", async ({
  page,
}) => {
  const recipeName = unique("Lasagna");
  await planCookTonightAndDinnerTomorrow(recipeName);

  const dialog = await cookWithLeftoversAndPlan(page, recipeName);
  // Tomorrow already has a dinner, so the day after is suggested.
  await expect(dialog.getByLabel("Date")).toHaveValue(key(utcDay(2)));
  await expect(dialog.getByRole("spinbutton", { name: "Portions" })).toHaveValue("2");
  await expect(dialog.getByRole("combobox", { name: "Meal" })).toHaveText(/^Dinner/);

  await dialog.getByRole("button", { name: "Add to plan" }).click();
  await expect(dialog).toHaveCount(0);

  // Saved: still there after a reload, on the week that day falls in. That
  // week also holds tonight's cooked entry when both days share a week.
  const sameWeek = key(mondayOf(utcDay(0))) === key(mondayOf(utcDay(2)));
  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(utcDay(2)))}`);
  await expect(page.getByText(recipeName).filter({ visible: true })).toHaveCount(sameWeek ? 2 : 1);
});

test("dismissing Plan leftovers adds nothing", async ({ page }) => {
  const recipeName = unique("Chili");
  await planCookTonightAndDinnerTomorrow(recipeName);

  const dialog = await cookWithLeftoversAndPlan(page, recipeName);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(utcDay(2)))}`);
  const sameWeek = key(mondayOf(utcDay(0))) === key(mondayOf(utcDay(2)));
  await expect(page.getByText(recipeName).filter({ visible: true })).toHaveCount(sameWeek ? 1 : 0);
});
