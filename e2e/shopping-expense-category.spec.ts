import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// Household.shoppingExpenseCategory: the Household page picks which budget
// category a completed shopping list logs its total to, and completing a
// priced list then lands the expense there (and names it in the toast).
// The category and the list are written straight to Postgres, like
// personal-budget-income.spec.ts does, and named uniquely since the desktop
// and mobile runs share the seeded household. Playwright runs one worker, so
// the two runs never race on the household-wide setting; each resets it to
// the automatic default when done so no other spec sees its pick.
const suffix = () => Date.now().toString(36);

function db() {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

async function seedCategoryAndTrip() {
  const tag = suffix();
  const category = { id: `e2e-shop-cat-${tag}`, name: `Food ${tag}` };
  const listId = `e2e-shop-list-${tag}`;
  const client = db();
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, $3, 'EXPENSE')`,
      [category.id, E2E_HOUSEHOLD.id, category.name],
    );
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      listId,
      E2E_HOUSEHOLD.id,
      `Trip ${tag}`,
    ]);
    // Already ticked, priced and put away, so "Finish trip" completes the
    // list straight away rather than routing through the put-away dialog.
    await client.query(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, quantity, unit, purchased, "estimatedPrice", "putAwayAt")
       VALUES ($1, $2, 'Bread', 1, 'pcs', true, 123, now())`,
      [`e2e-shop-item-${tag}`, listId],
    );
  } finally {
    await client.end();
  }
  return { category, listId };
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterEach(async () => {
  const client = db();
  await client.connect();
  try {
    await client.query(`UPDATE "Household" SET "shoppingExpenseCategoryId" = NULL WHERE id = $1`, [
      E2E_HOUSEHOLD.id,
    ]);
  } finally {
    await client.end();
  }
});

test("a completed shopping list logs its total to the category picked on the Household page", async ({ page }) => {
  const { category, listId } = await seedCategoryAndTrip();

  await page.goto("/dashboard/household");
  const select = page.getByRole("combobox", { name: "Log shopping to" });
  await select.click();
  await page.getByRole("option", { name: category.name }).click();
  await expect(select).toContainText(category.name);
  // The select flips optimistically; the toast means the save finished.
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // Still picked after a reload, so it reached the database.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Log shopping to" })).toContainText(category.name);

  await page.goto(`/dashboard/shopping-list/${listId}`);
  await page.getByRole("button", { name: "Finish trip" }).click();
  await expect(page.getByText(new RegExp(`to ${category.name} in your budget`))).toBeVisible();

  const client = db();
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT amount FROM "Transaction" WHERE "categoryId" = $1`, [category.id]);
    expect(rows).toEqual([{ amount: 123 }]);
  } finally {
    await client.end();
  }
});
