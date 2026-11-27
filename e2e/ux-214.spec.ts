import { expect, test, type Locator } from "@playwright/test";
import { unique, uniqueId, withDb } from "./db";
import { farDay } from "./far-weeks";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectRouterPatched, gotoRevealed } from "./ui";

// UX-214 (DESIGN.md M9, "full value reachable"): two meal-planning lists
// cut text off with the rest only in a `title` tooltip, which touch can't
// open. The Cook now row's "N ingredients needed: …" was clamped to two
// lines (one from `sm`), and the place-a-pick sheet truncated what each
// day's slot already holds to one line, under 12 px slot buttons. Now both
// wrap in full and the slot buttons are 14 px.

// Rendered without clipping: a clamped or truncated element scrolls inside
// its own box (scrollHeight/scrollWidth past the client size).
async function expectNotClipped(locator: Locator, what: string) {
  const size = await locator.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(size.scrollHeight, `${what} shows every line`).toBeLessThanOrEqual(size.clientHeight + 1);
  expect(size.scrollWidth, `${what} isn't cut at the side`).toBeLessThanOrEqual(size.clientWidth + 1);
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.describe("Cook now", () => {
  const recipeId = uniqueId("e2e-recipe-ux214");
  const recipe = unique("Weeknight traybake");
  // Cook now lists recipes at most two ingredients short
  // (MAX_MISSING_TO_SURFACE in cookable-recipes.ts), so two long names,
  // long enough together to run past two lines on a phone and one on a
  // desktop. Neither is stocked, so both are missing.
  const missing = [
    unique("Extraordinarily fragrant hand ground smoked seasoning blend"),
    unique("Slow fermented sourdough breadcrumbs from the corner bakery"),
  ];

  test.beforeEach(async () => {
    await withDb(async (client) => {
      await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [
        recipeId,
        E2E_HOUSEHOLD.id,
        recipe,
      ]);
      for (const [i, name] of missing.entries()) {
        await client.query(
          `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit) VALUES ($1, $2, $3, 1, 'pcs')`,
          [`${recipeId}-${i}`, recipeId, name],
        );
      }
    });
  });

  test.afterEach(async () => {
    await withDb((client) =>
      client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, recipeId]),
    );
  });

  test("a row's missing ingredients show in full, with no title tooltip", async ({ page }) => {
    await gotoRevealed(page, "/dashboard/meal-planning?tab=cook");
    // The Recipes tab (hidden, still in the page) lists the recipe too.
    const name = page.getByRole("main").getByText(recipe, { exact: true }).filter({ visible: true });
    await expect(name).toBeVisible();
    const list = page
      .getByRole("main")
      .getByText(`2 ingredients needed: ${missing[0]}, ${missing[1]}`)
      .filter({ visible: true });
    await expect(list).toBeVisible();
    await expectNotClipped(list, "the missing list");
    await expectNotClipped(name, "the recipe name");
    // The row (name, list, Add to plan) carries no hover-only tooltip.
    const row = list.locator("xpath=../..");
    await expect(row.locator("[title]")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("place-a-pick sheet", () => {
  // A week from this spec's own far-weeks.ts band, so the pick and the two
  // dinners are the only rows in it.
  const monday = farDay("ux-214", 0);
  const week = monday.toISOString().slice(0, 10);
  const tuesday = new Date(monday.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pick = unique("Fish pie");
  const dinners = [
    unique("Grandmother's slow roasted lamb shoulder with rosemary potatoes"),
    unique("Leftover vegetable curry with fluffy basmati and mango chutney"),
  ];
  const dropWeek = () =>
    withDb((client) =>
      // The plan's entries and picks go with it.
      client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = $2::date`, [
        E2E_HOUSEHOLD.id,
        week,
      ]),
    );

  test.beforeEach(async () => {
    await dropWeek();
    await withDb(async (client) => {
      const planId = uniqueId("e2e-plan-ux214");
      await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)`, [
        planId,
        E2E_HOUSEHOLD.id,
        week,
      ]);
      await client.query(
        `INSERT INTO "MealPlanPick" (id, "mealPlanId", "freeformName", portions) VALUES ($1, $2, $3, 4)`,
        [uniqueId("e2e-pick-ux214"), planId, pick],
      );
      for (const name of dinners) {
        await client.query(
          `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName") VALUES ($1, $2, $3, 'DINNER', $4)`,
          [uniqueId("e2e-entry-ux214"), planId, tuesday, name],
        );
      }
    });
  });

  test.afterEach(dropWeek);

  test("a slot's meals show in full and the slot buttons are 14 px", async ({ page }, testInfo) => {
    // The chip opens this sheet on touch; a mouse lifts the chip instead
    // (click-to-lift), so the sheet is the phone's.
    test.skip(testInfo.project.name !== "mobile", "the place sheet is the touch path");
    await gotoRevealed(page, `/dashboard/meal-planning?week=${week}`);
    const tray = page.getByRole("region", { name: "Picked for this week" });
    const chip = tray.getByRole("button", { name: new RegExp(`^${pick}`) });
    await expectHydrated(chip);
    await expectRouterPatched(page);
    await chip.click();
    const sheet = page.getByRole("dialog", { name: `Place ${pick}` });
    await expect(sheet.getByRole("button", { name: "Dinner", pressed: true })).toBeVisible();

    for (const name of dinners) {
      const meal = sheet.getByText(name, { exact: true });
      await expect(meal).toBeVisible();
      await expectNotClipped(meal, name);
    }

    // 14 px and whole, at Pixel 7 width and at 320 px, where they go 2×2.
    for (const width of [412, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const slots = sheet.getByRole("group", { name: "Meal", exact: true }).getByRole("button");
      await expect(slots).toHaveCount(4);
      for (const slot of await slots.all()) {
        const px = await slot.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(px, "a slot button's font size (M9)").toBeGreaterThanOrEqual(14);
        await expectNotClipped(slot, `the ${await slot.textContent()} button at ${width} px`);
      }
      for (const name of dinners) await expectNotClipped(sheet.getByText(name, { exact: true }), `${name} at ${width} px`);
      await expectNoHorizontalOverflow(page);
    }
  });
});
