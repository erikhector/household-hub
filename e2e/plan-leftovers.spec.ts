import { expect, test, type Locator, type Page } from "@playwright/test";
import { mondayOf, unique, uniqueTag, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { farDay } from "./far-weeks";
import { dismissCookieNotice, openRowSheet } from "./ui";

// GAP-39: after "Mark as cooked" records leftovers, the toast offers "Plan
// leftovers", which opens the add-to-plan dialog prefilled with the recipe,
// the leftover servings and the next day with no dinner. Nothing is added
// unless the household confirms.

const DAY_MS = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const plus = (day: Date, days: number) => new Date(day.getTime() + days * DAY_MS);

// The desktop and mobile runs share one household and its dinners, and other
// specs plan dinners for the days around today, so "the next day with no
// dinner" would depend on which ran first. Each test therefore plans on its
// own days a long way ahead, picked at random in this spec's own band of
// weeks (far-weeks.ts, MAINT-117) where nothing else is, which keeps the
// expected suggestion exact. That band is shared by every run of this spec
// in the worker's household (both projects, every --repeat-each run), so
// each test also takes its rows away again: a dinner an earlier run left on
// base + 2 would push the suggestion to base + 3.

// The tag of each test's seeded rows, for the afterEach below.
let seeded: string | undefined;

test.afterEach(async () => {
  if (!seeded) return;
  const tag = seeded;
  seeded = undefined;
  await withDb(async (client) => {
    const recipeId = `e2e-recipe-${tag}`;
    // Only this household's rows, and only the ones this test made: its
    // recipe's entries (the cooked dinner and the planned leftovers, whose
    // ids the app chose), the seeded takeaway, then the recipe (its
    // leftovers batch cascades with it). The other project's run may be
    // planning in the same week right now, so the week's plan stays unless
    // it's one this test made and now empty.
    await client.query(
      `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
       WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1
         AND (entry."recipeId" = $2 OR entry.id = ANY($3))`,
      [E2E_HOUSEHOLD.id, recipeId, [`e2e-entry-${tag}-0`, `e2e-entry-${tag}-1`]],
    );
    await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
    await client.query(
      `DELETE FROM "MealPlan" plan WHERE plan."householdId" = $1 AND plan.id = ANY($2)
         AND NOT EXISTS (SELECT 1 FROM "MealPlanEntry" entry WHERE entry."mealPlanId" = plan.id)`,
      [E2E_HOUSEHOLD.id, [`e2e-plan-${tag}-0`, `e2e-plan-${tag}-1`]],
    );
  });
});

const key = (day: Date) => day.toISOString().slice(0, 10);

// A recipe to cook on day `base`, plus a dinner already planned the day
// after, so the suggestion has to skip a day: base + 2.
async function planCookAndDinnerNextDay(recipeName: string, base: Date) {
  await withDb(async (client) => {
    const tag = uniqueTag();
    const recipeId = `e2e-recipe-${tag}`;
    seeded = tag;
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      recipeId,
      E2E_HOUSEHOLD.id,
      recipeName,
    ]);
    const rows = [
      { day: base, recipe: recipeId, freeform: null },
      { day: plus(base, 1), recipe: null, freeform: `Takeaway ${tag}` },
    ];
    for (const [i, row] of rows.entries()) {
      const monday = mondayOf(row.day);
      await client.query(
        `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
         ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
        [`e2e-plan-${tag}-${i}`, E2E_HOUSEHOLD.id, monday],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", "freeformName")
         SELECT $1, plan.id, $2, 'DINNER', $3, $4
         FROM "MealPlan" plan WHERE plan."householdId" = $5 AND plan."weekStartDate" = $6`,
        [`e2e-entry-${tag}-${i}`, row.day, row.recipe, row.freeform, E2E_HOUSEHOLD.id, monday],
      );
    }
  });
}

// DESIGN.md M3: on a phone both toast buttons are at least 44 x 44 px with
// at least 8 px between them. Desktop keeps Sonner's compact buttons.
async function expectToastButtonsTappable(page: Page, planLeftovers: Locator) {
  if (!(page.viewportSize() && page.viewportSize()!.width < 640)) return;
  const undo = page.getByRole("button", { name: "Undo" });
  // Both buttons are measured together inside one poll, so the checks see
  // the same settled frame: Sonner scales the toast while it slides in and
  // when it restacks, and measuring the buttons one after the other let the
  // second read land mid-transform (MAINT-24, MAINT-30).
  //
  // The CSS floor is a true 44 px (globals.css, `min-height: 44px`). A
  // transformed element's bounding box can still come back as 43.999996 px,
  // which is float rounding of the scale and not a short button, so the
  // bound allows 0.01 px and nothing more.
  const TOLERANCE = 0.01;
  await expect
    .poll(async () => {
      const [a, b] = [await planLeftovers.boundingBox(), await undo.boundingBox()];
      if (!a || !b) return false;
      const gap = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
      return (
        [a, b].every((box) => box.width >= 44 - TOLERANCE && box.height >= 44 - TOLERANCE) &&
        gap >= 8 - TOLERANCE
      );
    })
    .toBe(true);
}

// Cooks the recipe's planned entry with 2 servings left over and taps
// "Plan leftovers" on the toast.
async function cookWithLeftoversAndPlan(page: Page, recipeName: string, base: Date) {
  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(base))}`);
  await (await openRowSheet(page, recipeName)).getByRole("button", { name: "Mark as cooked" }).click();
  const cooked = page.getByRole("dialog", { name: "Mark as cooked" });
  await cooked.getByRole("spinbutton", { name: "Portions left over" }).fill("2");
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
  const base = farDay("plan-leftovers");
  await planCookAndDinnerNextDay(recipeName, base);

  const dialog = await cookWithLeftoversAndPlan(page, recipeName, base);
  // Tomorrow already has a dinner, so the day after is suggested.
  await expect(dialog.getByLabel("Date")).toHaveValue(key(plus(base, 2)));
  await expect(dialog.getByRole("spinbutton", { name: "Portions" })).toHaveValue("2");
  await expect(dialog.getByRole("combobox", { name: "Meal" })).toHaveText(/^Dinner/);

  await dialog.getByRole("button", { name: "Add to plan" }).click();
  await expect(dialog).toHaveCount(0);

  // Saved: still there after a reload, on the week that day falls in. That
  // week also holds tonight's cooked entry when both days share a week.
  const sameWeek = key(mondayOf(base)) === key(mondayOf(plus(base, 2)));
  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(plus(base, 2)))}`);
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
  const base = farDay("plan-leftovers");
  await planCookAndDinnerNextDay(recipeName, base);

  const dialog = await cookWithLeftoversAndPlan(page, recipeName, base);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(plus(base, 2)))}`);
  const sameWeek = key(mondayOf(base)) === key(mondayOf(plus(base, 2)));
  await expect(page.getByText(recipeName).filter({ visible: true })).toHaveCount(sameWeek ? 1 : 0);
});
