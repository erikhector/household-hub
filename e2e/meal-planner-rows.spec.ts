import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets, openRowSheet } from "./ui";

// The planner's meals and the Recipes tab's recipes are one tappable row
// each, opening a sheet of labelled actions with delete set apart (DESIGN.md
// M2, M6), instead of a strip of unlabelled icon buttons on every row. Each
// test seeds its own recipe (and a meal in a far-future week nobody else
// plans in) and removes them again.
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const key = (day: Date) => day.toISOString().slice(0, 10);
const mondayOf = (day: Date) => new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);

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

// A recipe with steps and two ingredients (plus `extraIngredients` more),
// and (when `day` is given) a dinner of it planned that day. Returns the
// recipe id for cleanup.
async function seed(recipeName: string, day?: Date, extraIngredients = 0) {
  const suffix = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const recipeId = `e2e-recipe-rows-${suffix}`;
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO "Recipe" (id, "householdId", name, instructions, servings, tags) VALUES ($1, $2, $3, $4, 2, $5)`,
      [recipeId, E2E_HOUSEHOLD.id, recipeName, "Chop\nSimmer", ["vegan"]],
    );
    await client.query(
      `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit) VALUES ($1, $2, 'Lentils', 250, 'g'), ($3, $2, 'Carrots', 2, 'pcs')`,
      [`${recipeId}-a`, recipeId, `${recipeId}-b`],
    );
    for (let i = 0; i < extraIngredients; i++) {
      await client.query(
        `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit) VALUES ($1, $2, $3, 1, 'tbsp')`,
        [`${recipeId}-x${i}`, recipeId, `Spice ${i + 1}`],
      );
    }
    if (extraIngredients > 0) {
      await client.query(
        `UPDATE "Recipe" SET "caloriesPerServing" = 420, "proteinGramsPerServing" = 21 WHERE id = $1`,
        [recipeId],
      );
    }
    if (day) {
      const monday = mondayOf(day);
      await client.query(
        `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
         ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
        [`e2e-plan-rows-${suffix}`, E2E_HOUSEHOLD.id, monday],
      );
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", portions)
         SELECT $1, plan.id, $2, 'DINNER', $3, 2
         FROM "MealPlan" plan WHERE plan."householdId" = $4 AND plan."weekStartDate" = $5`,
        [`e2e-entry-rows-${suffix}`, day, recipeId, E2E_HOUSEHOLD.id, monday],
      );
    }
  });
  return recipeId;
}

async function cleanup(recipeId: string) {
  await withClient(async (client) => {
    await client.query(
      `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
       WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND entry."recipeId" = $2`,
      [E2E_HOUSEHOLD.id, recipeId],
    );
    await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
  });
}

// A Wednesday years ahead, in a week of its own per test run.
function farDay() {
  const today = new Date();
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const monday = base - ((new Date(base).getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday + (7 * (300 + Math.floor(Math.random() * 3000)) + 2) * DAY_MS);
}

test("a planned meal is one row whose sheet holds its labelled actions, delete set apart", async ({ page }, testInfo) => {
  const recipeName = unique("Dal");
  const day = farDay();
  const recipeId = await seed(recipeName, day);
  try {
    await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(day))}`);
    const row = page.getByRole("button", { name: new RegExp(`^Dinner ${recipeName} · 2 portions`) });
    await expect(row).toBeVisible();
    // No action buttons on the row itself any more.
    await expect(page.getByRole("main").getByRole("button", { name: "Mark as cooked" })).toHaveCount(0);

    const sheet = await openRowSheet(page, recipeName);
    await expect(sheet.getByText(/^Dinner · Wed \d+ · 2 portions$/)).toBeVisible();
    const markCooked = sheet.getByRole("button", { name: "Mark as cooked" });
    const remove = sheet.getByRole("button", { name: "Remove meal" });
    for (const name of ["Mark as cooked", "Cook", "Edit meal", "Move meal"]) {
      await expect(sheet.getByRole("button", { name, exact: true })).toBeVisible();
    }
    // M2: delete is the last action, under a rule, not beside the primary.
    const cookedBox = await markCooked.boundingBox();
    const removeBox = await remove.boundingBox();
    expect(removeBox!.y - (cookedBox!.y + cookedBox!.height)).toBeGreaterThan(100);
    if (testInfo.project.name === "mobile") await expectTouchTargets(page);

    // An action hands over to its own dialog, and the phone's back closes
    // that and lands on the planner, not on a sheet left behind it.
    await sheet.getByRole("button", { name: "Move meal", exact: true }).click();
    const move = page.getByRole("dialog", { name: `Move ${recipeName}` });
    await expect(move).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`week=${key(mondayOf(day))}`));

    // Removing it from the sheet, then confirming, takes it off the plan.
    await (await openRowSheet(page, recipeName)).getByRole("button", { name: "Remove meal" }).click();
    await page.getByRole("dialog", { name: `Remove ${recipeName}?` }).getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Previous week" })).toBeVisible();
    await expect(row).toHaveCount(0);
  } finally {
    await cleanup(recipeId);
  }
});

test("adding a meal starts on the picker, not on typing a name", async ({ page }) => {
  const recipeName = unique("Chili");
  const day = farDay();
  const recipeId = await seed(recipeName);
  try {
    await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(day))}`);
    await page.getByRole("button", { name: /^Add meal, / }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a meal" });
    const picker = dialog.getByRole("combobox", { name: "Recipe" });
    // Nothing chosen and no name field: there's something to pick (M4).
    await expect(picker).toHaveText(/Choose a meal/);
    await expect(dialog.getByRole("textbox", { name: "Meal name" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByText("Choose a recipe or enter a meal name")).toBeVisible();

    await picker.click();
    await page.getByRole("option", { name: recipeName }).click();
    await expect(dialog.getByRole("spinbutton", { name: "Portions" })).toHaveValue("2");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`^Dinner ${recipeName}`) })).toBeVisible();
  } finally {
    await cleanup(recipeId);
  }
});

test("the week bar stays on screen down a phone-length week", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "only the phone's main scrolls under a sticky bar");
  await page.goto("/dashboard/meal-planning?week=2031-02-03");
  await page.getByRole("main").evaluate((main) => main.scrollTo(0, main.scrollHeight));
  await expect(page.getByRole("button", { name: "Previous week" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "More planner actions" })).toBeInViewport();
});

test("a recipe is one row whose sheet has its ingredients and actions, delete set apart", async ({
  page,
}, testInfo) => {
  const recipeName = unique("Lentil soup");
  const recipeId = await seed(recipeName);
  try {
    await page.goto("/dashboard/meal-planning?tab=recipes");
    await page.getByRole("searchbox", { name: /Search recipes/ }).fill(recipeName);
    // Name, then one meta line: tags and servings.
    const row = page.getByRole("button", { name: new RegExp(`^${recipeName} Vegan · 2 servings`) });
    await expect(row).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "Edit recipe" })).toHaveCount(0);
    if (testInfo.project.name === "mobile") {
      // The tab's primary action floats in the thumb zone (M2).
      const add = await page.getByRole("button", { name: "New recipe" }).boundingBox();
      expect(add!.y).toBeGreaterThan(page.viewportSize()!.height / 2);
      await expectNoHorizontalOverflow(page);
    }

    const sheet = await openRowSheet(page, recipeName);
    await expect(sheet.getByRole("listitem").filter({ hasText: "Lentils" })).toHaveText("250 g Lentils");
    for (const name of ["Cook", "Edit recipe", "Review ingredient matches", "Copy as text", "Delete recipe"]) {
      await expect(sheet.getByRole("button", { name, exact: true })).toBeVisible();
    }
    if (testInfo.project.name === "mobile") await expectTouchTargets(page);

    await sheet.getByRole("button", { name: "Delete recipe" }).click();
    await page.getByRole("dialog", { name: `Delete ${recipeName}?` }).getByRole("button", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await page.getByRole("searchbox", { name: /Search recipes/ }).fill(recipeName);
    await expect(page.getByText("No recipes match your search.")).toBeVisible();
  } finally {
    await cleanup(recipeId);
  }
});

test("a long recipe's Cook stays on screen in its sheet, above the scrolling ingredients", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "only the phone's bottom sheet is shorter than a long recipe");
  const recipeName = unique("Curry");
  const recipeId = await seed(recipeName, undefined, 25);
  try {
    await page.goto("/dashboard/meal-planning?tab=recipes");
    await page.getByRole("searchbox", { name: /Search recipes/ }).fill(recipeName);
    // A finger's tap, not a click: a tap leaves the sheet scrolled to the
    // top, as on a phone (a click would focus a button and scroll to it).
    await page.getByRole("main").getByText(recipeName, { exact: true }).tap();
    const sheet = page.getByRole("dialog", { name: recipeName, exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("listitem").first()).toBeInViewport();
    // The point of the test: the sheet's body is taller than the sheet.
    const body = sheet.locator('[data-slot="dialog-body"]');
    expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
    const cook = sheet.getByRole("button", { name: "Cook", exact: true });
    // M2: the primary action is in the sheet's sticky footer, in reach
    // without scrolling, though the ingredient list runs past the screen.
    await expect(cook).toBeInViewport();
    await expect(sheet.getByRole("button", { name: "Edit recipe" })).toBeInViewport();
    const remove = sheet.getByRole("button", { name: "Delete recipe" });
    await expect(remove).not.toBeInViewport();

    // Scrolled to the end, Delete comes into view and Cook is still there.
    await remove.scrollIntoViewIfNeeded();
    await expect(remove).toBeInViewport();
    await expect(cook).toBeInViewport();
    const cookBox = await cook.boundingBox();
    const removeBox = await remove.boundingBox();
    expect(Math.abs(cookBox!.y - (removeBox!.y + removeBox!.height))).toBeGreaterThanOrEqual(8);

    // Opened with a click (a mouse or keyboard), it starts at the top too:
    // focus goes to the title, not to a button down past the ingredients.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    const clicked = await openRowSheet(page, recipeName);
    await expect(clicked.getByRole("listitem").first()).toBeInViewport();
    await expect(clicked.getByRole("heading", { name: recipeName })).toBeFocused();
  } finally {
    await cleanup(recipeId);
  }
});
