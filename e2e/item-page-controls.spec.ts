import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import {
  clickRowAction,
  dismissCookieNotice,
  expectNoHorizontalOverflow,
  waitForDialogHistory,
  waitForUndoableDelete,
} from "./ui";

// UX-124: the item page has the controls the inventory list gives a row:
// status badge, expiry, opened and frozen tags, a stepper, Edit and Delete,
// and its "Also on" links look like links. Items are written straight to
// Postgres (like item-page.spec.ts), one per test.
const suffix = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;
const PREFIX = "e2e-item-controls-";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Only this household's rows: the other workers' households hold theirs.
test.afterEach(async () => {
  await withClient(async (client) => {
    await client.query(`DELETE FROM "ShoppingList" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${PREFIX}%`]);
    await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${PREFIX}%`]);
  });
});

async function seedItem(extra: { quantity?: number; expires?: boolean; opened?: boolean; frozen?: boolean } = {}) {
  const tag = suffix();
  const item = { id: `${PREFIX}${tag}`, name: `Yoghurt ${tag}`, tag };
  await withClient((client) =>
    client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "expiresAt", "openedAt", "frozenAt", "updatedAt")
       VALUES ($1, $2, $3, 'Dairy', $4, 'pcs', 0.5,
         CASE WHEN $5::boolean THEN now() + interval '2 days' ELSE NULL END,
         CASE WHEN $6::boolean THEN now() ELSE NULL END,
         CASE WHEN $7::boolean THEN now() ELSE NULL END,
         now())`,
      [item.id, E2E_HOUSEHOLD.id, item.name, extra.quantity ?? 2, extra.expires ?? false, extra.opened ?? false, extra.frozen ?? false],
    ),
  );
  return item;
}

test("the item page shows the stock status, expiry, opened and frozen tags", async ({ page }) => {
  const item = await seedItem({ expires: true, opened: true, frozen: true });
  await page.goto(`/dashboard/inventory/items/${item.id}`);
  const main = page.getByRole("main");

  await expect(main.getByRole("heading", { name: item.name, level: 1 })).toBeVisible();
  await expect(main.getByText("In stock", { exact: true })).toBeVisible();
  await expect(main.getByText("Expiring soon", { exact: true })).toBeVisible();
  await expect(main.getByText("Opened", { exact: true })).toBeVisible();
  await expect(main.getByText("Frozen", { exact: true })).toBeVisible();
  await expect(main.getByText(/^Best before \S+/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the stepper changes the stock and the badge follows, saved after a reload", async ({ page }) => {
  const item = await seedItem({ quantity: 1 });
  await page.goto(`/dashboard/inventory/items/${item.id}`);
  const main = page.getByRole("main");
  await expect(main.getByText("In stock", { exact: true })).toBeVisible();

  await main.getByRole("button", { name: `Decrease ${item.name}` }).click();
  await expect(main.getByText("Out of stock", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: `Adjust ${item.name} (0 pcs)` })).toBeVisible();

  await page.reload();
  await expect(main.getByText("Out of stock", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: `Increase ${item.name}` }).click();
  await expect(main.getByRole("button", { name: `Adjust ${item.name} (1 pcs)` })).toBeVisible();
  await expect(main.getByText("Out of stock", { exact: true })).toHaveCount(0);
});

test("Edit renames the item and Delete removes it and leaves the page", async ({ page }) => {
  const item = await seedItem();
  await page.goto(`/dashboard/inventory/items/${item.id}`);
  const renamed = `Skyr ${item.tag}`;

  await clickRowAction(page, { button: "Edit item", menu: "More actions", item: "Edit" });
  const dialog = page.getByRole("dialog", { name: "Edit inventory item" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(renamed);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await waitForDialogHistory(page);
  await expect(page.getByRole("heading", { name: renamed, level: 1 })).toBeVisible();

  await clickRowAction(page, { button: "Delete item", menu: "More actions", item: "Delete" });
  // UX-49: no confirm; it leaves the page at once and the toast offers Undo.
  await expect(page).toHaveURL(/\/dashboard\/inventory$/);
  await waitForUndoableDelete(page, `Deleted "${renamed}"`);
  await page.reload();
  await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);
});

test("the shopping lists an item is on are links that look like links", async ({ page }) => {
  const item = await seedItem();
  const listId = `${PREFIX}list-${item.tag}`;
  const listName = `Weekend ${item.tag}`;
  await withClient(async (client) => {
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name, status) VALUES ($1, $2, $3, 'ACTIVE')`, [
      listId,
      E2E_HOUSEHOLD.id,
      listName,
    ]);
    await client.query(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", "inventoryItemId", name, quantity, unit, purchased)
       VALUES ($1, $2, $3, $4, 1, 'pcs', false)`,
      [`${listId}-row`, listId, item.id, item.name],
    );
  });
  await page.goto(`/dashboard/inventory/items/${item.id}`);

  const link = page.getByRole("main").getByRole("link", { name: listName });
  await expect(link).toBeVisible();
  await expect(link).toHaveCSS("text-decoration-line", "underline");
});
