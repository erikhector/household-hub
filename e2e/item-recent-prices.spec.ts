import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// GAP-47: "Recent prices" on the item page, read from PriceHistory. The
// item and its list are written straight to Postgres (named uniquely, since
// the desktop and mobile runs share the seeded household); the price itself
// is recorded the way a household does it, by putting a priced purchase away.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  for (const table of ["ShoppingList", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-gap47-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

async function seedItem(t: string, name: string) {
  const id = `e2e-gap47-inv-${t}`;
  await sql(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($1, $2, $3, 'Dairy', 0, 'l', now())`,
    [id, E2E_HOUSEHOLD.id, name],
  );
  return id;
}

test("an item with no price history shows no Recent prices", async ({ page }) => {
  const t = tag();
  const id = await seedItem(t, `Oat drink ${t}`);
  await page.goto(`/dashboard/inventory/items/${id}`);
  await expect(page.getByRole("heading", { name: `Oat drink ${t}`, level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByText("No learned names.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent prices" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("buying an item with a price lists it under Recent prices, newest first", async ({ page }) => {
  const t = tag();
  const name = `Milk ${t}`;
  const id = await seedItem(t, name);
  // An older purchase from a named store, so the list has two rows to order.
  await sql(
    `INSERT INTO "PriceHistory" (id, "inventoryItemId", price, quantity, unit, store, date)
     VALUES ($1, $2, 16, 1, 'l', 'ICA Maxi', now() - interval '30 days')`,
    [`e2e-gap47-ph-${t}`, id],
  );
  // 2 l for 30 kr, ticked and priced: put away to record it.
  const listId = `e2e-gap47-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [listId, E2E_HOUSEHOLD.id, `Shop ${t}`]);
  await sql(
    `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, quantity, unit, purchased, "estimatedPrice", "inventoryItemId")
     VALUES ($1, $2, $3, 2, 'l', true, 30, $4)`,
    [`e2e-gap47-item-${t}`, listId, name, id],
  );

  await page.goto(`/dashboard/shopping-list/${listId}`);
  await page.getByRole("button", { name: "Put things away" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Put away (all|1 item)/ }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/dashboard/inventory/items/${id}`);
  const section = page.getByRole("main").getByRole("region", { name: "Recent prices" });
  await expect(section).toBeVisible();
  const rows = section.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  // Newest first: today's 2 l for 30 kr, then the older one with its store.
  await expect(rows.nth(0)).toContainText("30.00");
  await expect(rows.nth(0)).toContainText("15.00");
  await expect(rows.nth(1)).toContainText("ICA Maxi");
  await expect(rows.nth(1)).toContainText("16.00");
  await expectNoHorizontalOverflow(page);
});
