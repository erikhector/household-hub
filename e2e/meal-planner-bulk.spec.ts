import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectTouchTargets,
  openRowSheet,
  waitForDialogHistory,
  waitForUndoableDelete,
} from "./ui";

// GAP-56: Select mode on the planner. Two seeded dinners and a cooked lunch
// live in a far-future week nobody else plans in. The cooked one can't be
// selected; the two are moved a day together, re-portioned, then removed.
const DAY_MS = 24 * 60 * 60 * 1000;
const key = (day: Date) => day.toISOString().slice(0, 10);
const mondayOf = (day: Date) => new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function withClient<T>(fn: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// A Wednesday years ahead, in a week of its own per test run.
function farWednesday() {
  const today = new Date();
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const monday = base - ((new Date(base).getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday + (7 * (300 + Math.floor(Math.random() * 3000)) + 2) * DAY_MS);
}

async function seed(names: { a: string; b: string; cooked: string }, wednesday: Date) {
  const suffix = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const monday = mondayOf(wednesday);
  const recipeIds: string[] = [];
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
      [`e2e-plan-bulk-${suffix}`, E2E_HOUSEHOLD.id, monday],
    );
    const rows = [
      { name: names.a, day: wednesday, type: "DINNER", cooked: false },
      { name: names.b, day: new Date(wednesday.getTime() + DAY_MS), type: "DINNER", cooked: false },
      { name: names.cooked, day: new Date(wednesday.getTime() + 2 * DAY_MS), type: "LUNCH", cooked: true },
    ];
    for (const [i, row] of rows.entries()) {
      const recipeId = `e2e-recipe-bulk-${suffix}-${i}`;
      recipeIds.push(recipeId);
      await client.query(
        `INSERT INTO "Recipe" (id, "householdId", name, servings) VALUES ($1, $2, $3, 2)`,
        [recipeId, E2E_HOUSEHOLD.id, row.name],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", portions, "consumedAt")
         SELECT $1, plan.id, $2, $3::"MealType", $4, 2, $5
         FROM "MealPlan" plan WHERE plan."householdId" = $6 AND plan."weekStartDate" = $7`,
        [
          `e2e-entry-bulk-${suffix}-${i}`,
          row.day,
          row.type,
          recipeId,
          row.cooked ? new Date() : null,
          E2E_HOUSEHOLD.id,
          monday,
        ],
      );
    }
  });
  return recipeIds;
}

async function cleanup(recipeIds: string[]) {
  await withClient(async (client) => {
    await client.query(
      `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
       WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND entry."recipeId" = ANY($2)`,
      [E2E_HOUSEHOLD.id, recipeIds],
    );
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id = ANY($2)`, [E2E_HOUSEHOLD.id, recipeIds]);
  });
}

// The menu trigger is server-rendered before it is interactive: under a loaded
// run goto() and page.reload() return before React has hydrated it, and a click
// that lands then opens no menu, so "Select meals" is never found and the
// planner stays out of Select mode (MAINT-61). Every call here follows a goto
// or a reload, so wait for hydration first.
async function startSelecting(page: Page) {
  const more = page.getByRole("button", { name: "More planner actions" });
  await expectHydrated(more);
  await more.click();
  await page.getByRole("menuitem", { name: "Select meals" }).click();
}

test("select several planned meals, move them a day, re-portion them, then remove them", async ({ page }, testInfo) => {
  const names = { a: unique("Bulk A"), b: unique("Bulk B"), cooked: unique("Bulk Cooked") };
  const wednesday = farWednesday();
  const week = key(mondayOf(wednesday));
  const recipeIds = await seed(names, wednesday);
  try {
    await page.goto(`/dashboard/meal-planning?week=${week}`);
    await startSelecting(page);

    // A cooked meal isn't selectable; the other two are.
    await expect(page.getByRole("checkbox", { name: new RegExp(names.cooked) })).toHaveCount(0);
    await expect(page.getByText("Cooked, can't be changed")).toHaveCount(1);
    const bar = page.getByRole("region", { name: "Edit selected meals" });
    await expect(bar.getByText("Tap meals to select them")).toBeVisible();
    await expect(bar.getByRole("button", { name: "Move to…" })).toBeDisabled();

    await page.getByRole("checkbox", { name: new RegExp(names.a) }).check();
    await page.getByRole("checkbox", { name: new RegExp(names.b) }).check();
    await expect(bar.getByText("2 meals selected")).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
      // The bar is docked on top of the bottom nav, in the thumb zone (M2),
      // whatever the scroll. As a sticky card iOS Safari left it floating
      // over the middle of the list.
      const nav = page.getByRole("navigation").filter({ visible: true }).last();
      const box = await bar.boundingBox();
      const navBox = await nav.boundingBox();
      expect(box!.y).toBeGreaterThan(page.viewportSize()!.height / 2);
      expect(Math.abs(box!.y + box!.height - navBox!.y)).toBeLessThanOrEqual(2);
      await page.locator("main").evaluate((main) => main.scrollTo(0, 0));
      expect((await bar.boundingBox())!.y).toBe(box!.y);
    }

    // Move to…: the earliest (Wed) goes to Thu, the other keeps its distance (Fri).
    await bar.getByRole("button", { name: "Move to…" }).click();
    const move = page.getByRole("dialog", { name: "Move selected meals" });
    await move.getByLabel("Date").fill(key(new Date(wednesday.getTime() + DAY_MS)));
    await move.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Moved 2 meals")).toBeVisible();
    await expect(bar).toHaveCount(0);
    await waitForDialogHistory(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "More planner actions" })).toBeVisible();
    const sheetA = await openRowSheet(page, names.a);
    await expect(sheetA.getByText(/^Dinner · Thu \d+ · 2 portions$/)).toBeVisible();
    await page.keyboard.press("Escape");
    await waitForDialogHistory(page);
    const sheetB = await openRowSheet(page, names.b);
    await expect(sheetB.getByText(/^Dinner · Fri \d+ · 2 portions$/)).toBeVisible();
    await page.keyboard.press("Escape");
    await waitForDialogHistory(page);

    // Portions…: halve both.
    await startSelecting(page);
    await page.getByRole("checkbox", { name: new RegExp(names.a) }).check();
    await page.getByRole("checkbox", { name: new RegExp(names.b) }).check();
    await bar.getByRole("button", { name: "Portions…" }).click();
    const portions = page.getByRole("dialog", { name: "Change portions" });
    await portions.getByRole("button", { name: "One portion fewer" }).click();
    await portions.getByRole("button", { name: "Set portions" }).click();
    await expect(page.getByText("Changed portions for 2 meals")).toBeVisible();
    await waitForDialogHistory(page);
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`^Dinner ${names.a} · 1 portion`) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^Dinner ${names.b} · 1 portion`) })).toBeVisible();

    // Remove: gone at once, with an Undo toast; the delete follows it.
    await startSelecting(page);
    await page.getByRole("checkbox", { name: new RegExp(names.a) }).check();
    await page.getByRole("checkbox", { name: new RegExp(names.b) }).check();
    await bar.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("button", { name: new RegExp(names.a) })).toHaveCount(0);
    await waitForUndoableDelete(page, "Removed 2 meals");
    await page.reload();
    await expect(page.getByRole("button", { name: "More planner actions" })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(names.a) })).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(names.b) })).toHaveCount(0);
    // The cooked meal is untouched.
    await expect(page.getByRole("button", { name: new RegExp(names.cooked) })).toBeVisible();
  } finally {
    await cleanup(recipeIds);
  }
});

test("Undo on a bulk move puts the meals back", async ({ page }) => {
  const names = { a: unique("Restore A"), b: unique("Restore B"), cooked: unique("Restore Cooked") };
  const wednesday = farWednesday();
  const recipeIds = await seed(names, wednesday);
  try {
    await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(wednesday))}`);
    await startSelecting(page);
    await page.getByRole("checkbox", { name: new RegExp(names.a) }).check();
    await page.getByRole("region", { name: "Edit selected meals" }).getByRole("button", { name: "Move to…" }).click();
    const move = page.getByRole("dialog", { name: "Move selected meals" });
    await move.getByLabel("Date").fill(key(new Date(wednesday.getTime() + 2 * DAY_MS)));
    await move.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Moved 1 meal")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Changes undone")).toBeVisible();
    await waitForDialogHistory(page);
    await page.reload();
    const sheet = await openRowSheet(page, names.a);
    await expect(sheet.getByText(/^Dinner · Wed \d+ · 2 portions$/)).toBeVisible();
  } finally {
    await cleanup(recipeIds);
  }
});

// Two lunches eating from one prepped batch and a dinner that cooks fresh, in
// a far week of their own. Mark eaten takes the two prepped ones together
// (they were cooked at prep time) and leaves the fresh dinner, which takes
// its ingredients off inventory through its own review.
async function seedPrepped(names: { prepped: string; fresh: string }, wednesday: Date) {
  const suffix = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const monday = mondayOf(wednesday);
  const preppedRecipe = `e2e-recipe-bulk-eat-${suffix}-p`;
  const freshRecipe = `e2e-recipe-bulk-eat-${suffix}-f`;
  const batchId = `e2e-batch-bulk-eat-${suffix}`;
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
      [`e2e-plan-bulk-eat-${suffix}`, E2E_HOUSEHOLD.id, monday],
    );
    for (const [id, name] of [
      [preppedRecipe, names.prepped],
      [freshRecipe, names.fresh],
    ]) {
      await client.query(`INSERT INTO "Recipe" (id, "householdId", name, servings) VALUES ($1, $2, $3, 2)`, [
        id,
        E2E_HOUSEHOLD.id,
        name,
      ]);
    }
    await client.query(
      `INSERT INTO "PreparedBatch" (id, "householdId", "recipeId", "totalPortions", "remainingPortions", "updatedAt")
       VALUES ($1, $2, $3, 4, 2, now())`,
      [batchId, E2E_HOUSEHOLD.id, preppedRecipe],
    );
    const rows = [
      { day: wednesday, type: "LUNCH", recipeId: preppedRecipe, batch: batchId },
      { day: new Date(wednesday.getTime() + DAY_MS), type: "LUNCH", recipeId: preppedRecipe, batch: batchId },
      { day: wednesday, type: "DINNER", recipeId: freshRecipe, batch: null },
    ];
    for (const [i, row] of rows.entries()) {
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", portions, "preparedBatchId", "preparedPortionsUsed")
         SELECT $1, plan.id, $2, $3::"MealType", $4, 1, $5, $6
         FROM "MealPlan" plan WHERE plan."householdId" = $7 AND plan."weekStartDate" = $8`,
        [`e2e-entry-bulk-eat-${suffix}-${i}`, row.day, row.type, row.recipeId, row.batch, row.batch ? 1 : 0, E2E_HOUSEHOLD.id, monday],
      );
    }
  });
  return [preppedRecipe, freshRecipe];
}

test("mark several prepped meals eaten at once", async ({ page }) => {
  const names = { prepped: unique("Bulk prep"), fresh: unique("Bulk fresh") };
  const wednesday = farWednesday();
  const recipeIds = await seedPrepped(names, wednesday);
  const lunches = () => page.getByRole("button", { name: new RegExp(`^Lunch ${names.prepped}`) });
  try {
    await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(wednesday))}`);
    await startSelecting(page);
    const bar = page.getByRole("region", { name: "Edit selected meals" });
    const markEaten = bar.getByRole("button", { name: "Mark eaten" });
    await expect(markEaten).toBeDisabled();

    // Only the fresh dinner ticked: nothing from meal prep, so it stays off.
    await page.getByRole("checkbox", { name: new RegExp(names.fresh) }).check();
    await expect(markEaten).toBeDisabled();
    for (const checkbox of await page.getByRole("checkbox", { name: new RegExp(names.prepped) }).all()) {
      await checkbox.check();
    }
    await expect(bar.getByText("3 meals selected")).toBeVisible();
    await markEaten.click();
    await expect(page.getByText("Marked 2 meals eaten")).toBeVisible();
    await expect(page.getByText("1 isn't from meal prep: mark it cooked on its own")).toBeVisible();
    await expect(bar).toHaveCount(0);

    // Saved: both lunches say Eaten (not Cooked), the dinner says neither.
    await page.reload();
    await expect(lunches()).toHaveCount(2);
    for (const lunch of await lunches().all()) await expect(lunch).toContainText("Eaten");
    await expect(page.getByRole("button", { name: new RegExp(`^Dinner ${names.fresh}`) })).not.toContainText(
      /Eaten|Cooked/,
    );

    // Eaten meals aren't selectable any more, and say why in words.
    await startSelecting(page);
    await expect(page.getByText("Eaten, can't be changed")).toHaveCount(2);
  } finally {
    await cleanup(recipeIds);
  }
});

test("Undo on a bulk Mark eaten puts the meals back uneaten", async ({ page }) => {
  const names = { prepped: unique("Revert prep"), fresh: unique("Revert fresh") };
  const wednesday = farWednesday();
  const recipeIds = await seedPrepped(names, wednesday);
  try {
    await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(wednesday))}`);
    await startSelecting(page);
    for (const checkbox of await page.getByRole("checkbox", { name: new RegExp(names.prepped) }).all()) {
      await checkbox.check();
    }
    await page.getByRole("region", { name: "Edit selected meals" }).getByRole("button", { name: "Mark eaten" }).click();
    await expect(page.getByText("Marked 2 meals eaten")).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByText("Changes undone")).toBeVisible();
    await page.reload();
    const lunches = page.getByRole("button", { name: new RegExp(`^Lunch ${names.prepped}`) });
    await expect(lunches).toHaveCount(2);
    for (const lunch of await lunches.all()) await expect(lunch).not.toContainText("Eaten");
  } finally {
    await cleanup(recipeIds);
  }
});
