import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { collectErrors, dismissCookieNotice, expectRendersCleanly, openRowSheet, saveScreenshot, waitForDialogHistory } from "./ui";

// GAP-49 meal prep, end to end: record a batch on the Prep tab, spread its
// portions over the planner, give one back, eat one, discard the rest; and
// the planner's "From meal prep" source with "Don't use prep", plus the home
// dashboard's Meal prep card.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Set by a test to remove the rows it planned, pass or fail. The desktop and
// mobile runs (and a retry) share the household, so a dinner left behind can
// sit in the slot a later run picks and take its name there.
let cleanup: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

function utcDay(offset: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY_MS);
}

function mondayOf(day: Date) {
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

const key = (day: Date) => day.toISOString().slice(0, 10);

// The Monday `weeks` weeks after this one.
const weekAhead = (weeks: number) => new Date(mondayOf(utcDay(0)).getTime() + weeks * 7 * DAY_MS);

// The Plan portions dialog names each day's group the way it formats the
// heading (plan-portions-dialog.tsx): "Monday, Oct 19", in UTC.
const dayGroupName = (day: Date) =>
  new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(day);

async function withClient<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const suffix = () => `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// A two-serving recipe whose one ingredient (100 g) is linked to an
// inventory item holding 1000 g, so recording a batch takes something off
// inventory and the spec can check that eating it takes nothing more. A
// `lowStockThreshold` above 900 makes a two-portion prep cross the item
// into low stock, so AUTO-8 puts it on "Next shop".
async function seedRecipe(recipeName: string, lowStockThreshold = 1) {
  const id = suffix();
  const recipeId = `e2e-prep-recipe-${id}`;
  const itemId = `e2e-prep-item-${id}`;
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
       VALUES ($1, $2, $3, 'Pantry', 1000, 'g', $4, now())`,
      [itemId, E2E_HOUSEHOLD.id, `Rice ${id}`, lowStockThreshold],
    );
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name, servings) VALUES ($1, $2, $3, 2)`, [
      recipeId,
      E2E_HOUSEHOLD.id,
      recipeName,
    ]);
    await client.query(
      `INSERT INTO "RecipeIngredient" (id, "recipeId", "inventoryItemId", name, quantity, unit)
       VALUES ($1, $2, $3, 'Rice', 100, 'g')`,
      [`${recipeId}-ing`, recipeId, itemId],
    );
  });
  return { recipeId, itemId };
}

const itemQuantity = (itemId: string) =>
  withClient(async (client) => {
    const { rows } = await client.query(`SELECT quantity FROM "InventoryItem" WHERE id = $1 AND "householdId" = $2`, [
      itemId,
      E2E_HOUSEHOLD.id,
    ]);
    return Number(rows[0].quantity);
  });

// Another dish already planned in a slot, which the Plan portions dialog
// must grey out.
async function planFreeformDinner(day: Date, name: string) {
  const id = suffix();
  const monday = mondayOf(day);
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
      [`e2e-prep-plan-${id}`, E2E_HOUSEHOLD.id, monday],
    );
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName")
       SELECT $1, plan.id, $2, 'DINNER', $3
       FROM "MealPlan" plan WHERE plan."householdId" = $4 AND plan."weekStartDate" = $5`,
      [`e2e-prep-entry-${id}`, day, name, E2E_HOUSEHOLD.id, monday],
    );
  });
}

// Records one dish of `recipeName` on the Prep tab, stepping its portions
// from the recipe's two servings up to `portions`.
async function recordPrep(page: Page, recipeName: string, portions: number, eatBy?: string) {
  await page.getByRole("button", { name: "Record prep" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record prep" });
  await dialog.getByRole("combobox", { name: "Recipe" }).click();
  await page.getByRole("option", { name: recipeName, exact: true }).click();
  const count = dialog.getByRole("group", { name: "Portions" }).getByRole("status", { name: "Portions" });
  await expect(count).toHaveText("2");
  for (let n = 2; n < portions; n++) await dialog.getByRole("button", { name: "One portion more" }).click();
  await expect(count).toHaveText(String(portions));
  if (eatBy) await dialog.getByLabel("Eat by (optional)").fill(eatBy);
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByText("Review and adjust the inventory these dishes used, then confirm.")).toBeVisible();
  await dialog.getByRole("button", { name: "Record prep" }).click();
  await expect(dialog).toHaveCount(0);
}

// A batch card on the Prep tab, by its (unique) recipe name.
const batchCard = (page: Page, recipeName: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: recipeName, exact: true }) });

// The meal's name on the planner; the Prepped badge sits in the same row
// (the button that opens the meal's sheet).
const plannedNames = (page: Page, recipeName: string) =>
  page.getByText(recipeName, { exact: true }).filter({ visible: true });
const preppedBadges = (names: Locator) => names.locator("xpath=ancestor::button[1]").getByText("Prepped", { exact: true });

test("record, plan, return and eat a prepped batch", async ({ page }, testInfo) => {
  // The whole GAP-49 journey in one test: about twenty steps, five server
  // actions and seven page loads, 17-20 s on an idle machine. That leaves
  // too little of the default 30 s under three loaded workers, where it
  // timed out at the last step (Discard) with that save still in flight. Each
  // assertion keeps its own 5 s wait; only the test's total budget grows.
  test.slow();
  const recipeName = unique("Prep curry");
  const { recipeId, itemId } = await seedRecipe(recipeName);
  const takeaway = `Takeaway ${suffix()}`;
  cleanup = () =>
    withClient(async (client) => {
      await client.query(
        `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
         WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1
           AND (entry."recipeId" = $2 OR entry."freeformName" = $3)`,
        [E2E_HOUSEHOLD.id, recipeId, takeaway],
      );
      await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
      await client.query(`DELETE FROM "InventoryItem" WHERE id = $1 AND "householdId" = $2`, [itemId, E2E_HOUSEHOLD.id]);
    });
  // The dialog opens on this week (the batch is cooked today), so the spec
  // pages forward a few weeks to plan where no other spec plans meals
  // (they stay on this week and next, or in fixed weeks years ahead).
  // Random, so the desktop and mobile runs, which share the household,
  // usually land in different weeks; the slots are picked from the ones
  // still free, so it works when they don't.
  const weeksAhead = 3 + Math.floor(Math.random() * 18);
  const targetWeek = weekAhead(weeksAhead);
  const takenDinnerDay = new Date(targetWeek.getTime() + 2 * DAY_MS);
  await planFreeformDinner(takenDinnerDay, takeaway);

  // The Prep tab renders cleanly.
  const errors = collectErrors(page);
  await expectRendersCleanly(page, { pattern: "/dashboard/meal-planning", path: "/dashboard/meal-planning?tab=prep" });
  await expect(page.getByRole("heading", { name: "Meal prep", exact: true })).toBeVisible();
  expect(errors).toEqual([]);

  // Record 4 portions; the ingredients come off inventory (2 × 100 g).
  await recordPrep(page, recipeName, 4);
  await expect(batchCard(page, recipeName)).toContainText("4 of 4 portions left");
  expect(await itemQuantity(itemId)).toBe(800);

  // The success toast's "Plan portions" opens the dialog for this batch.
  const toast = page.getByRole("listitem").filter({ hasText: "Recorded 1 dish · 4 portions" });
  await toast.getByRole("button", { name: "Plan portions" }).click();
  const dialog = page.getByRole("dialog", { name: `Plan portions of ${recipeName}` });
  await expect(dialog).toBeVisible();
  // UX-100: the dialog starts today. Earlier days of the week are hidden,
  // not greyed out, and Previous week has nowhere pickable to go.
  await expect(dialog.getByRole("group", { name: dayGroupName(utcDay(0)) })).toBeVisible();
  const monday = mondayOf(utcDay(0));
  for (let i = 0; monday.getTime() + i * DAY_MS < utcDay(0).getTime(); i++) {
    await expect(dialog.getByRole("group", { name: dayGroupName(new Date(monday.getTime() + i * DAY_MS)) })).toHaveCount(0);
  }
  await expect(dialog.getByRole("button", { name: "Previous week" })).toBeDisabled();
  // The first free slot is on screen without scrolling.
  await expect(dialog.getByRole("checkbox", { disabled: false }).first()).toBeInViewport();

  // Previous week is only locked on the first week: one step on, it works
  // and leads back to today's week.
  await dialog.getByRole("button", { name: "Next week" }).click();
  await expect(dialog.getByRole("button", { name: "Previous week" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Previous week" }).click();
  await expect(dialog.getByRole("group", { name: dayGroupName(utcDay(0)) })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Previous week" })).toBeDisabled();

  // On to the target week.
  for (let i = 0; i < weeksAhead; i++) await dialog.getByRole("button", { name: "Next week" }).click();
  await expect(dialog.getByRole("group", { name: dayGroupName(targetWeek) })).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(28);

  // The dinner with something else planned is greyed out, and says what.
  const takenDinner = dialog
    .getByRole("group", { name: dayGroupName(takenDinnerDay) })
    .getByRole("checkbox", { name: `Dinner ${takeaway}` });
  await expect(takenDinner).toBeDisabled();
  // ...and a visible "Taken" label, not only the greying (UX-100).
  await expect(
    dialog.getByRole("group", { name: dayGroupName(takenDinnerDay) }).getByText("Taken", { exact: true }),
  ).toBeVisible();

  // Two lunches, one of them stepped up to 3: the batch's 4 are all used.
  const freeLunches = dialog.getByRole("checkbox", { name: "Lunch", exact: true, disabled: false });
  await freeLunches.nth(0).check();
  await freeLunches.nth(1).check();
  await expect(dialog.getByText("2 of 4 left after this")).toBeVisible();
  const more = dialog.getByRole("button", { name: "One portion more" }).first();
  await more.click();
  await more.click();
  await expect(dialog.getByText("0 of 4 left after this")).toBeVisible();
  // The stepper stops at what's left.
  await expect(more).toBeDisabled();
  const save = dialog.getByRole("button", { name: "Plan portions", exact: true });
  await expect(save).toBeEnabled();

  // A third slot overdraws the batch: the footer says so and Save is off.
  await freeLunches.nth(2).check();
  await expect(dialog.getByText("1 portion too many — only 4 left")).toBeVisible();
  await expect(save).toBeDisabled();
  await freeLunches.nth(2).uncheck();
  await expect(dialog.getByText("0 of 4 left after this")).toBeVisible();

  // Back down to one portion each, and save.
  const fewer = dialog.getByRole("button", { name: "One portion fewer" }).first();
  await fewer.click();
  await fewer.click();
  await expect(dialog.getByText("2 of 4 left after this")).toBeVisible();
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Planned 2 portions")).toBeVisible();

  // Saved: after a reload the card has 2 left.
  await page.reload();
  await expect(batchCard(page, recipeName)).toContainText("2 of 4 portions left");

  // The planner's week shows both meals, each with the Prepped badge.
  await page.goto(`/dashboard/meal-planning?week=${key(targetWeek)}`);
  await expect(plannedNames(page, recipeName)).toHaveCount(2);
  await expect(preppedBadges(plannedNames(page, recipeName))).toHaveCount(2);

  // Removing one planned meal gives its portion back to the batch.
  await (await openRowSheet(page, recipeName)).getByRole("button", { name: "Remove meal" }).click();
  await page.getByRole("dialog", { name: `Remove ${recipeName}?` }).getByRole("button", { name: "Remove" }).click();
  await expect(plannedNames(page, recipeName)).toHaveCount(1);
  await page.goto("/dashboard/meal-planning?tab=prep");
  await expect(batchCard(page, recipeName)).toContainText("3 of 4 portions left");

  // Eating the other: the batch was cooked at prep time, so inventory stays.
  await page.goto(`/dashboard/meal-planning?week=${key(targetWeek)}`);
  await (await openRowSheet(page, recipeName)).getByRole("button", { name: "Mark as eaten" }).click();
  const eaten = page.getByRole("dialog", { name: "Mark as eaten" });
  const eatenSubmit = eaten.getByRole("button", { name: "Mark as eaten" });
  await expect(eatenSubmit).toBeVisible();
  await expect(eaten.getByText("This meal comes from your meal prep, so your inventory stays as it is.")).toBeVisible();
  await saveScreenshot(page, testInfo, "en", {
    pattern: "/dashboard/meal-planning/mark-as-eaten",
    path: `/dashboard/meal-planning?week=${key(targetWeek)}`,
  });
  await eatenSubmit.click();
  await expect(eaten).toHaveCount(0);
  await expect(page.getByText("Marked as eaten", { exact: true })).toBeVisible();
  // The row now says it's eaten, and its sheet no longer offers to eat it.
  await expect(plannedNames(page, recipeName).locator("xpath=ancestor::button[1]")).toContainText("Cooked");
  await expect(
    (await openRowSheet(page, recipeName)).getByRole("button", { name: "Mark as eaten" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await itemQuantity(itemId)).toBe(800);

  // Discard the rest: the card is gone, and stays gone after a reload.
  await page.goto("/dashboard/meal-planning?tab=prep");
  await batchCard(page, recipeName).getByRole("button", { name: "Discard" }).click();
  await page.getByRole("dialog", { name: `Discard ${recipeName}?` }).getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText(`Discarded ${recipeName}`)).toBeVisible();
  // The confirm dialog's history.back() can still be on its way here.
  await waitForDialogHistory(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Meal prep", exact: true })).toBeVisible();
  await expect(batchCard(page, recipeName)).toHaveCount(0);
});

test("a planner meal from meal prep, given back with Don't use prep, and the dashboard card", async ({ page }) => {
  const recipeName = unique("Prep dal");
  const { recipeId } = await seedRecipe(recipeName);
  // A week no other spec plans in, and unlike the first test's weeks; the
  // meal is added through the first free day's "Add meal", so its rows are
  // removed at the end to leave the week empty for the next run.
  const week = weekAhead(25 + Math.floor(Math.random() * 40));

  try {
    await page.goto("/dashboard/meal-planning?tab=prep");
    // Eat by tomorrow, so it leads the dashboard card (soonest first, top 3).
    await recordPrep(page, recipeName, 2, key(utcDay(1)));
    await expect(batchCard(page, recipeName)).toContainText("2 of 2 portions left");

    // The home dashboard's Meal prep card lists it and links to the Prep tab.
    await page.goto("/dashboard");
    await expect(page.getByRole("listitem").filter({ hasText: recipeName })).toContainText("2 of 2 portions left");
    // Exposed as a button, like the dashboard's other card links
    // (overview.spec.ts): Base UI's Button rendering a Link.
    await page.getByRole("button", { name: "View meal prep" }).click();
    await expect(page).toHaveURL(/\/dashboard\/meal-planning\?tab=prep$/);
    await expect(batchCard(page, recipeName)).toBeVisible();

    // Add a meal on the planner from the batch.
    await page.goto(`/dashboard/meal-planning?week=${key(week)}`);
    await page.getByRole("button", { name: /^Add meal, / }).filter({ visible: true }).first().click();
    const add = page.getByRole("dialog", { name: "Add a meal" });
    await add.getByRole("combobox", { name: "Recipe" }).click();
    await page.getByRole("option", { name: "From meal prep" }).click();
    await add.getByRole("combobox", { name: "Batch" }).click();
    await page.getByRole("option", { name: `${recipeName} · 2 left` }).click();
    await expect(add.getByText("Eaten from the batch, so nothing comes off your inventory.")).toBeVisible();
    await add.getByRole("button", { name: "Add", exact: true }).click();
    await expect(add).toHaveCount(0);

    await expect(plannedNames(page, recipeName)).toHaveCount(1);
    await expect(preppedBadges(plannedNames(page, recipeName))).toHaveCount(1);
    await page.goto("/dashboard/meal-planning?tab=prep");
    await expect(batchCard(page, recipeName)).toContainText("1 of 2 portions left");

    // Don't use prep: the meal stays planned, to cook fresh, without the
    // badge, and its portion is back in the batch.
    await page.goto(`/dashboard/meal-planning?week=${key(week)}`);
    await (await openRowSheet(page, recipeName)).getByRole("button", { name: "Don't use prep" }).click();
    await expect(page.getByText("Portions back in Meal prep — this meal cooks fresh")).toBeVisible();
    await expect(preppedBadges(plannedNames(page, recipeName))).toHaveCount(0);
    await page.reload();
    await expect(plannedNames(page, recipeName)).toHaveCount(1);
    await expect(preppedBadges(plannedNames(page, recipeName))).toHaveCount(0);
    await page.goto("/dashboard/meal-planning?tab=prep");
    await expect(batchCard(page, recipeName)).toContainText("2 of 2 portions left");
  } finally {
    // The meal and the batch (which cascades from the recipe), so neither
    // the week nor the dashboard card carries them into later tests.
    await withClient(async (client) => {
      await client.query(
        `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
         WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND entry."recipeId" = $2`,
        [E2E_HOUSEHOLD.id, recipeId],
      );
      await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
    });
  }
});

// Undo record prep is refused once a portion is planned, and then must leave
// the AUTO-8 "Next shop" row the prep added alone: the prep stays real, so
// the item is still low. The portion is planned straight in the database
// while the toast is up, since planning through the UI closes the toast.
// With every portion planned, the card's Plan portions is disabled.
test("a refused Undo record prep keeps what it put on Next shop", async ({ page }) => {
  const recipeName = unique("Prep stew");
  const { recipeId, itemId } = await seedRecipe(recipeName, 950);
  const day = weekAhead(70 + Math.floor(Math.random() * 40));
  const pendingRows = () =>
    withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM "ShoppingListItem" row
         JOIN "ShoppingList" list ON list.id = row."shoppingListId"
         WHERE list."householdId" = $1 AND row."inventoryItemId" = $2 AND NOT row.purchased`,
        [E2E_HOUSEHOLD.id, itemId],
      );
      return rows[0].n as number;
    });

  try {
    await page.goto("/dashboard/meal-planning?tab=prep");
    await recordPrep(page, recipeName, 2);
    const toast = page.getByRole("listitem").filter({ hasText: "Recorded 1 dish · 2 portions" });
    await expect(toast).toBeVisible();
    expect(await itemQuantity(itemId)).toBe(900);
    expect(await pendingRows()).toBe(1);

    // Someone plans both portions while the toast is still up.
    const id = suffix();
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
         ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
        [`e2e-prep-plan-${id}`, E2E_HOUSEHOLD.id, day],
      );
      const { rows } = await client.query(
        `UPDATE "PreparedBatch" SET "remainingPortions" = "remainingPortions" - 2
         WHERE "recipeId" = $1 AND "householdId" = $2 RETURNING id`,
        [recipeId, E2E_HOUSEHOLD.id],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", portions,
           "preparedBatchId", "preparedPortionsUsed")
         SELECT $1, plan.id, $2, 'DINNER', $3, 2, $4, 2
         FROM "MealPlan" plan WHERE plan."householdId" = $5 AND plan."weekStartDate" = $2`,
        [`e2e-prep-entry-${id}`, day, recipeId, rows[0].id, E2E_HOUSEHOLD.id],
      );
    });

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Some of these portions are already planned. Unplan them first.")).toBeVisible();

    // Nothing was undone: the batch, the deduction and the Next shop row stay.
    // The emptied batch stays on the tab while its meal is uneaten, but has
    // nothing left to plan.
    await page.reload();
    await expect(batchCard(page, recipeName)).toContainText("0 of 2 portions left");
    await expect(batchCard(page, recipeName).getByRole("button", { name: "Plan portions" })).toBeDisabled();
    expect(await itemQuantity(itemId)).toBe(900);
    expect(await pendingRows()).toBe(1);
  } finally {
    await withClient(async (client) => {
      await client.query(
        `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
         WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND entry."recipeId" = $2`,
        [E2E_HOUSEHOLD.id, recipeId],
      );
      await client.query(
        `DELETE FROM "ShoppingListItem" row USING "ShoppingList" list
         WHERE row."shoppingListId" = list.id AND list."householdId" = $1 AND row."inventoryItemId" = $2`,
        [E2E_HOUSEHOLD.id, itemId],
      );
      await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
    });
  }
});
