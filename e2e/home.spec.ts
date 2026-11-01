import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow } from "./ui";

// The Home redesign (UX-HOME-1..4): the overview renamed Home, with three
// cards (Today, Shopping & pantry, Safe to spend) and no primary action:
// "Add to list" is a quiet button on the Shopping & pantry card. What each card shows depends on the household's data, and
// other specs fill the seeded household as they run, so every test here
// gets its own account and household (straight to Postgres, logged in
// through the real form, like overview.spec.ts).

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "e2e-password-123";

async function createHousehold(client: Client, prefix: string, tag: string) {
  const ids = {
    user: `e2e-${prefix}-user-${tag}`,
    household: `e2e-${prefix}-household-${tag}`,
    member: `e2e-${prefix}-member-${tag}`,
    email: `e2e-${prefix}-${tag}@squirrel.test`,
  };
  await client.query(
    `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
     VALUES ($1, $2, $3, 'Home', now(), 'en')`,
    [ids.user, ids.email, await bcrypt.hash(PASSWORD, 10)],
  );
  await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Home household')`, [ids.household]);
  await client.query(
    `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
    [ids.member, ids.household, ids.user],
  );
  return ids;
}

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function cleanUp(client: Client, ids: { household: string; user: string }) {
  // Household first: its members, items, lists, recipes and plans cascade.
  await client.query(`DELETE FROM "Household" WHERE id = $1`, [ids.household]);
  await client.query(`DELETE FROM "User" WHERE id = $1`, [ids.user]);
  await client.end();
}

const card = (page: Page, title: string) =>
  page
    .getByRole("main")
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("the tab is called Home, with today's date under the greeting", async ({ page }, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const ids = await createHousehold(client, "hn", tag);
  try {
    await logIn(page, ids.email);
    // The sidebar on desktop, the bottom bar on a phone: one visible "Home".
    const home = page.getByRole("link", { name: "Home", exact: true }).filter({ visible: true });
    await expect(home).toHaveCount(1);
    await expect(home).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
    // The weekday is in the subtitle (the browser and the server agree on
    // the day for all but a few minutes around midnight, so accept either
    // side of it).
    const main = page.getByRole("main");
    const weekday = (offset: number) =>
      new Date(Date.now() + offset).toLocaleDateString("en", { weekday: "long" });
    await expect(main.getByText(new RegExp(`^(${weekday(-DAY_MS)}|${weekday(0)}|${weekday(DAY_MS)}),`))).toBeVisible();
    // No primary action: Home is a summary, so nothing floats in the thumb
    // zone and no button or link in it takes the solid primary fill.
    await expect(main.locator("[data-primary-action]")).toHaveCount(0);
    const primaryCount = await main
      .locator("button, a")
      .evaluateAll((els) => els.filter((el) => /(^|\s)bg-primary(\s|$)/.test(el.className)).length);
    expect(primaryCount).toBe(0);
    // With no active list there's nothing to add to: the card's "Start a
    // list" row is the next step, so "Add to list" isn't shown.
    await expect(main.getByRole("button", { name: "Add to list" })).toHaveCount(0);
  } finally {
    await cleanUp(client, ids);
  }
});

test("Shopping & pantry: the list row, the out/low warning with Add N, and Use soon chips", async ({
  page,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const ids = await createHousehold(client, "hp", tag);
  const listId = `e2e-hp-list-${tag}`;
  try {
    await logIn(page, ids.email);
    const pantry = card(page, "Shopping & pantry");

    // Nothing yet: a way to start a list, and no warning about a pantry
    // that's empty (a bare "0" or "All stocked up" would mean nothing).
    await expect(pantry.getByRole("link", { name: /Start a list/ })).toBeVisible();
    await expect(pantry.getByText("All stocked up")).toHaveCount(0);
    // No budget yet: Safe to spend is just the way to set one up.
    const money = card(page, "Safe to spend");
    await expect(money.getByRole("link", { name: "Set up your personal budget" })).toBeVisible();
    await expect(money.getByRole("link", { name: /^Household/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // One low item (already on the list), one out, one expiring tomorrow,
    // and one list.
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "expiresAt", "updatedAt")
       VALUES ($1, $2, 'Flour', 'Pantry', 1, 'kg', 2, NULL, now()),
              ($3, $2, 'Salt', 'Pantry', 0, 'kg', 1, NULL, now()),
              ($4, $2, 'Milk', 'Dairy', 2, 'l', 1, now() + interval '1 day', now())`,
      [`e2e-hp-flour-${tag}`, ids.household, `e2e-hp-salt-${tag}`, `e2e-hp-milk-${tag}`],
    );
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, 'Weekly')`, [
      listId,
      ids.household,
    ]);
    await client.query(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", "inventoryItemId", name)
       VALUES ($1, $2, $3, 'Flour')`,
      [`e2e-hp-row-${tag}`, listId, `e2e-hp-flour-${tag}`],
    );
    await page.reload();

    // The problem in words, never a bare 0.
    await expect(pantry.getByText("1 out of stock, 1 running low")).toBeVisible();
    await expect(pantry.getByText("1 is already on the list")).toBeVisible();
    await expect(pantry.getByText("Milk", { exact: true })).toBeVisible();
    const milk = pantry.getByRole("link", { name: /Milk\s*· tomorrow/ });
    await expect(milk).toBeVisible();
    await expect(milk).toHaveAttribute("href", `/dashboard/inventory/items/e2e-hp-milk-${tag}`);
    await expectNoHorizontalOverflow(page);

    // Add N reuses the list's add-low-stock action: Salt goes on, Flour
    // (already there) doesn't.
    const add = pantry.getByRole("button", { name: "Add 1 low-stock item to Weekly" });
    await expectHydrated(add);
    await add.click();
    await expect(page.getByText("Added 1 low-stock item to the list")).toBeVisible();
    await expect
      .poll(async () => {
        const { rows } = await client.query(
          `SELECT name FROM "ShoppingListItem" WHERE "shoppingListId" = $1 ORDER BY name`,
          [listId],
        );
        return rows.map((row) => row.name);
      })
      .toEqual(["Flour", "Salt"]);
    await page.reload();
    await expect(pantry.getByText("2 are already on the list")).toBeVisible();
    await expect(pantry.getByRole("button", { name: /low-stock item/ })).toHaveCount(0);

    // The warning leads to the filtered inventory (UX-71).
    await pantry.getByRole("link", { name: /1 out of stock, 1 running low/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/inventory\?status=low/);

    // One active list: the row opens it, not the index.
    await page.goto("/dashboard");
    await pantry.getByRole("link", { name: /^2\s*Weekly\s*items to buy/ }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/shopping-list/${listId}$`));

    // Only out-of-stock left: the warning goes to the "out" filter instead.
    await client.query(`UPDATE "InventoryItem" SET quantity = 5 WHERE id = $1`, [`e2e-hp-flour-${tag}`]);
    // Several active lists: the row counts them and opens the lists page.
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, 'Party')`, [
      `e2e-hp-list2-${tag}`,
      ids.household,
    ]);
    await page.goto("/dashboard");
    const out = pantry.getByRole("link", { name: /^1 out of stock/ });
    await expect(out).toHaveAttribute("href", "/dashboard/inventory?status=out");
    await expect(pantry.getByText(/running low/)).toHaveCount(0);
    await pantry.getByRole("link", { name: /^2\s*2 active lists\s*items to buy/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/shopping-list$/);
  } finally {
    await cleanUp(client, ids);
  }
});

test("Today: dinner leads with cook mode and missing ingredients, leftovers, and Add to list adds in place", async ({
  page,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const ids = await createHousehold(client, "ht", tag);
  const listId = `e2e-ht-list-${tag}`;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
  const listRows = async () => {
    const { rows } = await client.query(
      `SELECT name FROM "ShoppingListItem" WHERE "shoppingListId" = $1 ORDER BY name`,
      [listId],
    );
    return rows.map((row) => row.name);
  };
  try {
    await client.query(
      `INSERT INTO "Recipe" (id, "householdId", name, instructions, servings)
       VALUES ($1, $3, 'Chicken tacos', 'Warm the tortillas. Fill and serve.', 4),
              ($2, $3, 'Lentil chili', NULL, 4)`,
      [`e2e-ht-tacos-${tag}`, `e2e-ht-chili-${tag}`, ids.household],
    );
    await client.query(
      `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit)
       VALUES ($1, $3, 'Lime', 1, 'pcs'), ($2, $3, 'Coriander', 1, 'pcs')`,
      [`e2e-ht-lime-${tag}`, `e2e-ht-cori-${tag}`, `e2e-ht-tacos-${tag}`],
    );
    await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)`, [
      `e2e-ht-plan-${tag}`,
      ids.household,
      monday,
    ]);
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId", portions)
       VALUES ($1, $2, $3, 'DINNER', $4, 4)`,
      [`e2e-ht-meal-${tag}`, `e2e-ht-plan-${tag}`, today, `e2e-ht-tacos-${tag}`],
    );
    await client.query(
      `INSERT INTO "PreparedBatch" (id, "householdId", "recipeId", "totalPortions", "remainingPortions", "updatedAt")
       VALUES ($1, $2, $3, 4, 3, now())`,
      [`e2e-ht-batch-${tag}`, ids.household, `e2e-ht-chili-${tag}`],
    );
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, 'Weekly')`, [
      listId,
      ids.household,
    ]);

    await logIn(page, ids.email);
    const today_ = card(page, "Today");

    // Dinner is the hero line, with its portions and what's missing (in
    // name order, like the planner's review list).
    await expect(today_.getByText("Chicken tacos", { exact: true })).toBeVisible();
    await expect(today_.getByText("4 portions", { exact: true })).toBeVisible();
    await expect(today_.getByText("Missing Coriander and Lime")).toBeVisible();
    // The prep batch with portions left is tonight's other option.
    await expect(today_.getByRole("link", { name: /Lentil chili\s*3 of 4 portions left/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "View meal prep" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Add 2 puts both on the list Home adds to, and the line goes.
    const addMissing = today_.getByRole("button", { name: "Add 2 missing ingredients to the shopping list" });
    await expectHydrated(addMissing);
    await addMissing.click();
    await expect(page.getByText('Added 2 items to "Weekly"')).toBeVisible();
    await expect.poll(listRows).toEqual(["Coriander", "Lime"]);
    await expect(today_.getByText("Missing Coriander and Lime")).toHaveCount(0);

    // "Add to list", on the Shopping & pantry card beside the list it fills,
    // opens the list's quick-add dialog in place.
    const addToList = card(page, "Shopping & pantry").getByRole("button", { name: "Add to list" });
    await expect(addToList).not.toHaveClass(/(^|\s)bg-primary(\s|$)/);
    await expect(page.getByRole("main").locator("[data-primary-action]")).toHaveCount(0);
    await expectHydrated(addToList);
    await addToList.click();
    const dialog = page.getByRole("dialog", { name: "Add an item" });
    await expect(dialog).toBeVisible();
    // Enter submits, as on the list page (the open suggestions popup would
    // cover the Add button).
    const name = dialog.getByRole("combobox", { name: "Name" });
    await name.fill("Tortillas");
    await name.press("Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(listRows).toEqual(["Coriander", "Lime", "Tortillas"]);
    // The list row behind it counts the new row.
    await expect(card(page, "Shopping & pantry").getByRole("link", { name: /^3\s*Weekly/ })).toBeVisible();

    // Start cooking opens the recipe's cook mode, not just the recipe list.
    await today_.getByRole("link", { name: "Start cooking" }).click();
    await expect(page).toHaveURL(/\/dashboard\/meal-planning\?tab=recipes/);
    await expect(page.getByRole("dialog", { name: /Chicken tacos/ })).toBeVisible();
    // The param is spent, so a reload doesn't reopen it.
    await expect(page).not.toHaveURL(/cook=1/);
  } finally {
    await cleanUp(client, ids);
  }
});
