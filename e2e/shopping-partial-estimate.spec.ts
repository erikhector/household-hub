import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-87: a partial estimate must not pass for the trip's cost. The header
// says how many rows the amount covers, and completing a list whose bought
// rows are only partly priced asks what to log instead of silently booking
// the fraction. Lists are written straight to Postgres and named uniquely
// (the desktop and mobile runs share the worker's household).
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function seedList(name: string, items: { name: string; purchased: boolean; price: number | null }[]) {
  const listId = `e2e-ux87-${name}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    name,
  ]);
  for (const [i, item] of items.entries()) {
    // Bought rows are already put away, so "Done shopping" goes straight to
    // completing rather than through the put-away dialog.
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, quantity, unit, purchased, "estimatedPrice", "putAwayAt")
       VALUES ($1, $2, $3, 1, 'pcs', $4, $5, $6)`,
      [`${listId}-${i}`, listId, item.name, item.purchased, item.price, item.purchased ? new Date() : null],
    );
  }
  return listId;
}

const transactionsFor = (name: string) =>
  sql(`SELECT amount FROM "Transaction" WHERE "householdId" = $1 AND description LIKE $2`, [
    E2E_HOUSEHOLD.id,
    `%${name}%`,
  ]);

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "Transaction" WHERE "householdId" = $1 AND description LIKE '%ux87-%'`, [E2E_HOUSEHOLD.id]);
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux87-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

test("the header says how many of the rows still to buy the estimate covers", async ({ page }) => {
  const listId = await seedList(`ux87-${tag()}-header`, [
    { name: "Priced thing", purchased: false, price: 24.5 },
    { name: "Mystery one", purchased: false, price: null },
    { name: "Mystery two", purchased: false, price: null },
  ]);
  await page.goto(`/dashboard/shopping-list/${listId}`);
  await expect(page.getByText(/^≈ .*24[.,]50.* still to buy \(1 of 3 priced\)$/)).toBeVisible();
  await expect(page.getByText(/left to spend/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("completing with some bought items unpriced lets you correct the amount before it is logged", async ({ page }) => {
  const name = `ux87-${tag()}-edit`;
  const listId = await seedList(name, [
    { name: "Priced bought", purchased: true, price: 20 },
    { name: "Unpriced bought", purchased: true, price: null },
  ]);
  await page.goto(`/dashboard/shopping-list/${listId}`);
  await page.getByRole("button", { name: "Done shopping" }).click();

  await expect(page.getByRole("heading", { name: "Some bought items have no price" })).toBeVisible();
  await expect(page.getByText("Of 2 bought items, 1 has no price")).toBeVisible();
  // Nothing is logged until the user confirms.
  expect(await transactionsFor(name)).toHaveLength(0);
  await expectNoHorizontalOverflow(page);

  const amount = page.getByRole("spinbutton", { name: "Amount to log in your budget" });
  await expect(amount).toHaveValue("20");
  await amount.fill("55");
  await page.getByRole("button", { name: "Log amount" }).click();

  await expect(page.getByText("List completed")).toBeVisible();
  await expect.poll(async () => (await transactionsFor(name)).map((row) => row.amount)).toEqual([55]);
});

test("completing with some bought items unpriced can skip logging", async ({ page }) => {
  const name = `ux87-${tag()}-skip`;
  const listId = await seedList(name, [
    { name: "Priced bought", purchased: true, price: 20 },
    { name: "Unpriced bought", purchased: true, price: null },
  ]);
  await page.goto(`/dashboard/shopping-list/${listId}`);
  await page.getByRole("button", { name: "Done shopping" }).click();
  await page.getByRole("button", { name: "Don't log" }).click();

  await expect(page.getByText("List completed")).toBeVisible();
  expect(await transactionsFor(name)).toHaveLength(0);
});
