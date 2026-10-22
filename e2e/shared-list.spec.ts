import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-63: the shared-list page is as good as the member view for the person in
// the shop: brand and sharer, aisles in store order, "n of m" progress, an
// All done state, a neutral banner, long names readable in full and a footer
// that links home. Rows are written straight to Postgres under the worker's
// household and removed again afterwards.
const tag = `ux63-${Date.now().toString(36)}-w${E2E_WORKER}`;
const listId = `e2e-${tag}-list`;
const token = `e2e-${tag}-token`;
const longName = `Extra virgin cold pressed organic olive oil from the sunny hills of southern Tuscany ${tag}`;

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await sql(`DELETE FROM "ShoppingListShareLink" WHERE token = $1`, [token]);
  await sql(`DELETE FROM "ShoppingList" WHERE id = $1 AND "householdId" = $2`, [listId, E2E_HOUSEHOLD.id]);
  await sql(`DELETE FROM "InventoryItem" WHERE id LIKE $1 AND "householdId" = $2`, [`e2e-${tag}-inv-%`, E2E_HOUSEHOLD.id]);
}

test.beforeAll(async () => {
  await cleanup();
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Shared ${tag}`,
  ]);
  // Milk is added first, but Produce comes first in the default store order.
  const rows = [
    { key: "milk", name: `Milk ${tag}`, category: "Dairy & eggs" },
    { key: "pear", name: `Pears ${tag}`, category: "Produce" },
    { key: "oil", name: longName, category: "Pantry basics" },
  ];
  for (const [i, row] of rows.entries()) {
    const invId = `e2e-${tag}-inv-${row.key}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, $4, 1, 'pcs', now())`,
      [invId, E2E_HOUSEHOLD.id, row.name, row.category],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", "inventoryItemId", name, "createdAt") VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')`,
      [`e2e-${tag}-item-${row.key}`, listId, invId, row.name, i],
    );
  }
  await sql(`INSERT INTO "ShoppingListShareLink" (id, "shoppingListId", token) VALUES ($1, $2, $3)`, [
    `e2e-${tag}-link`,
    listId,
    token,
  ]);
});
test.afterAll(cleanup);

test("the share page shows who shared it, aisles in order, progress and All done", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto(`/share/shopping-list/${token}`);

  await expect(page.getByRole("heading", { level: 1, name: `Shared ${tag}` })).toBeVisible();
  await expect(page.getByText(`Shared by ${E2E_HOUSEHOLD.name}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Squirrel" }).first()).toHaveAttribute("href", "/");
  // The neutral one-line banner, without the old "inventory" jargon.
  await expect(page.getByText("Ticking an item here updates the list for everyone who shares it.")).toBeVisible();
  await expect(page.getByText(/inventory/i)).toHaveCount(0);

  // Aisles in store order, not insertion order.
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.map((h) => h.toLowerCase())).toEqual(["produce", "dairy & eggs", "pantry basics"]);

  // The long name is on screen in full (wrapped), not clamped.
  const oil = page.getByText(longName);
  await expect(oil).toBeVisible();
  const box = await oil.boundingBox();
  const lineHeight = await oil.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(box!.height).toBeGreaterThan(lineHeight * 1.5);
  await expectNoHorizontalOverflow(page);

  const progress = page.getByRole("progressbar", { name: "Shopping progress" });
  await expect(progress).toHaveAttribute("aria-valuetext", "0 of 3");

  await page.getByRole("checkbox", { name: new RegExp(`^Pears ${tag}`) }).click();
  await expect(progress).toHaveAttribute("aria-valuetext", "1 of 3");
  // An aisle with nothing left to buy drops its header.
  await expect(page.getByRole("heading", { level: 2, name: "Produce" })).toHaveCount(0);
  await expect(page.getByText("All done")).toHaveCount(0);

  await page.getByRole("checkbox", { name: new RegExp(`^Milk ${tag}`) }).click();
  await page.getByRole("checkbox", { name: new RegExp(`^Extra virgin`) }).click();
  await expect(progress).toHaveAttribute("aria-valuetext", "3 of 3");
  await expect(page.getByText("All done")).toBeVisible();

  // The footer note and its link home.
  await expect(page.getByText("Shared from a Squirrel household.")).toBeVisible();
  await expect(page.getByRole("link", { name: "About Squirrel" })).toHaveAttribute("href", "/");
});
