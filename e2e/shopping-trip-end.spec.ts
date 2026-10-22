import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-81: a short, rewarding end to a shop. "All done" shows the trip in one
// line and one primary "Put everything away" that accepts the defaults; the
// per-row details stay collapsed; no "Not put away" badge while the list is
// active; and a finished trip offers "Back to lists" and "Start next list".
// Rows are written straight to Postgres (ticked, priced, 18 minutes apart)
// and removed again afterwards (only this worker's household's rows).
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

// Three ticked rows, each linked to its own inventory item, priced 10 +
// 20.50 + 5, ticked 18, 10 and 0 minutes ago.
async function seedTrip(t: string) {
  const listId = `e2e-ux81-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Trip ${t}`,
  ]);
  const rows = [
    { name: `Rice ${t}`, price: 10, ago: 18 },
    { name: `Beans ${t}`, price: 20.5, ago: 10 },
    { name: `Salt ${t}`, price: 5, ago: 0 },
  ];
  for (const [i, row] of rows.entries()) {
    const inventoryId = `e2e-ux81-inv-${t}-${i}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, 'Uncategorized', 0, 'pcs', now())`,
      [inventoryId, E2E_HOUSEHOLD.id, row.name],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased, "estimatedPrice", "checkedOffAt", "inventoryItemId")
       VALUES ($1, $2, $3, 'pcs', true, $4, now() - ($5 || ' minutes')::interval, $6)`,
      [`e2e-ux81-item-${t}-${i}`, listId, row.name, row.price, String(row.ago), inventoryId],
    );
  }
  return { path: `/dashboard/shopping-list/${listId}`, names: rows.map((row) => row.name) };
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  for (const table of ["ShoppingList", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux81-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

test("All done shows the trip in one line and a single primary that puts everything away and finishes", async ({ page }) => {
  const { path, names } = await seedTrip(tag());
  await page.goto(path);
  const main = page.getByRole("main");

  await expect(main.getByText("All done", { exact: true })).toBeVisible();
  await expect(main.getByText(/^3 items · ≈ .*35[.,]50.* · 18 min$/)).toBeVisible();
  // One button for the put-away, not two; and no per-row badge mid-shop.
  await expect(main.getByRole("button", { name: "Put everything away" })).toBeVisible();
  await expect(main.getByRole("button", { name: /^Put away \(/ })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Put things away" })).toHaveCount(0);
  await expect(main.getByText("Not put away")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await main.getByRole("button", { name: "Put everything away" }).click();

  // The trip is over: the two ways on, and the list is a record.
  await expect(main.getByText("Trip complete")).toBeVisible();
  await expect(main.getByRole("button", { name: "Start next list" }).or(main.getByRole("link", { name: "Start next list" }))).toBeVisible();
  await expect(main.getByText("Not put away")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // It saved: reload still shows the finished trip, and the stock is in.
  await page.reload();
  await expect(main.getByText("Trip complete")).toBeVisible();
  await expect(main.getByText(names[0]).first()).toBeVisible();

  await main.getByRole("link", { name: "Back to lists" }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list$/);
});

test("Review first opens the sheet with each row collapsed until Edit", async ({ page }) => {
  const { path, names } = await seedTrip(tag());
  await page.goto(path);

  await page.getByRole("button", { name: "Review first" }).click();
  const sheet = page.getByRole("dialog", { name: "Put away before you finish?" });
  await expect(sheet.getByText(names[0])).toBeVisible();
  // Defaults only: no choice, quantity, best-before or location fields yet.
  await expect(sheet.getByText("Best before")).toHaveCount(0);
  await expect(sheet.getByRole("radiogroup")).toHaveCount(0);

  await sheet.getByRole("button", { name: `Edit ${names[0]}` }).click();
  await expect(sheet.getByText("Best before")).toHaveCount(1);
  await expect(sheet.getByRole("radiogroup", { name: `What to do with ${names[0]}` })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a ticked row carries no Not put away badge while the list is active, only once it is completed", async ({ page }) => {
  const t = tag();
  const { path, names } = await seedTrip(t);
  // A fourth, unticked row keeps the list from being "All done".
  const listId = `e2e-ux81-list-${t}`;
  await sql(`INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit) VALUES ($1, $2, $3, 'pcs')`, [
    `e2e-ux81-item-${t}-pending`,
    listId,
    `Milk ${t}`,
  ]);
  await page.goto(path);
  await expect(page.getByText(names[0]).first()).toBeVisible();
  await expect(page.getByText("Not put away")).toHaveCount(0);

  await sql(`UPDATE "ShoppingList" SET status = 'COMPLETED' WHERE id = $1`, [listId]);
  await page.reload();
  await expect(page.getByText("Not put away").first()).toBeVisible();
});
