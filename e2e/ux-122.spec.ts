import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice } from "./ui";

// UX-122: "Add to shopping list" on a row and in the bulk bar puts the item
// on the list without touching its stock, rows already on a list say so, and
// with auto-add on the menu offers only one mark-empty entry. Items are
// written straight to Postgres (like freeze-item.spec.ts).
const suffix = () => `t${Math.random().toString(36).slice(2, 10)}`;
const isMobile = () => test.info().project.name === "mobile";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// The worker's household is shared with every spec it runs: remove the rows
// these tests made and put auto-add back to its default (only this household).
test.afterEach(async () => {
  await withClient(async (client) => {
    await client.query(`DELETE FROM "ShoppingListItem" WHERE "inventoryItemId" LIKE 'e2e-ux122-%'`);
    await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE 'e2e-ux122-%'`, [
      E2E_HOUSEHOLD.id,
    ]);
    await client.query(`UPDATE "Household" SET "autoAddLowStockToList" = true WHERE id = $1`, [E2E_HOUSEHOLD.id]);
  });
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

async function seedItem(name: string, id: string) {
  await withClient((client) =>
    client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
       VALUES ($1, $2, $3, 'Pantry', 3, 'pcs', 1, now())`,
      [id, E2E_HOUSEHOLD.id, name],
    ),
  );
}

const setAutoAdd = (on: boolean) =>
  withClient((client) =>
    client.query(`UPDATE "Household" SET "autoAddLowStockToList" = $2 WHERE id = $1`, [E2E_HOUSEHOLD.id, on]),
  );

const storedQuantity = (id: string) =>
  withClient(async (client) => {
    const { rows } = await client.query(`SELECT quantity FROM "InventoryItem" WHERE id = $1`, [id]);
    return rows[0].quantity as number;
  });

const pendingRows = (id: string) =>
  withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "ShoppingListItem" WHERE "inventoryItemId" = $1 AND purchased = false`,
      [id],
    );
    return rows[0].n as number;
  });

async function searchInventory(page: Page, query: string) {
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(query);
}

async function openMoreActions(page: Page) {
  await page.getByRole("button", { name: "More actions", exact: true }).filter({ visible: true }).click();
}

test("Add to shopping list from the row keeps the stock and tags the row On list", async ({ page }) => {
  const tag = suffix();
  const name = `Spaghetti ${tag}`;
  const id = `e2e-ux122-${tag}`;
  await seedItem(name, id);

  await searchInventory(page, name);
  await expect(page.getByText("On list", { exact: true }).filter({ visible: true })).toHaveCount(0);

  if (isMobile()) {
    await openMoreActions(page);
    await page.getByRole("menuitem", { name: "Add to shopping list", exact: true }).click();
  } else {
    await page.getByRole("button", { name: `Add ${name} to shopping list`, exact: true }).filter({ visible: true }).click();
  }
  await expect(page.getByText(/Added 1 item to/)).toBeVisible();
  await expect(page.getByText("On list", { exact: true }).filter({ visible: true })).toBeVisible();

  expect(await storedQuantity(id)).toBe(3);
  expect(await pendingRows(id)).toBe(1);

  await page.reload();
  await searchInventory(page, name);
  await expect(page.getByText("On list", { exact: true }).filter({ visible: true })).toBeVisible();
});

test("the bulk bar adds the selected items to the list without changing stock", async ({ page }) => {
  const tag = suffix();
  const names = [`Rice ${tag}`, `Lentils ${tag}`];
  const ids = [`e2e-ux122-a-${tag}`, `e2e-ux122-b-${tag}`];
  await seedItem(names[0], ids[0]);
  await seedItem(names[1], ids[1]);

  await searchInventory(page, tag);
  for (const name of names) {
    await page.getByRole("checkbox", { name: `Select ${name}` }).filter({ visible: true }).check();
  }
  await page.getByRole("button", { name: "Add to shopping list", exact: true }).click();
  await expect(page.getByText(/Added 2 items to/)).toBeVisible();

  for (const id of ids) {
    expect(await storedQuantity(id)).toBe(3);
    expect(await pendingRows(id)).toBe(1);
  }
});

test("adding an item that is already on the list says so instead of adding it twice", async ({ page }) => {
  const tag = suffix();
  const name = `Flour ${tag}`;
  const id = `e2e-ux122-${tag}`;
  await seedItem(name, id);

  await searchInventory(page, tag);
  await page.getByRole("checkbox", { name: `Select ${name}` }).filter({ visible: true }).check();
  await page.getByRole("button", { name: "Add to shopping list", exact: true }).click();
  await expect(page.getByText(/Added 1 item to/)).toBeVisible();

  await page.getByRole("checkbox", { name: `Select ${name}` }).filter({ visible: true }).check();
  await page.getByRole("button", { name: "Add to shopping list", exact: true }).click();
  await expect(page.getByText(/Already on/)).toBeVisible();
  expect(await pendingRows(id)).toBe(1);
});

async function openMarkEmptyMenu(page: Page) {
  if (isMobile()) {
    await openMoreActions(page);
  } else {
    await page.getByRole("button", { name: "Mark as empty", exact: true }).filter({ visible: true }).click();
  }
}

test("with auto-add on the menu offers one mark-empty entry; with it off, both", async ({ page }) => {
  const tag = suffix();
  const name = `Oats ${tag}`;
  await seedItem(name, `e2e-ux122-${tag}`);

  await setAutoAdd(true);
  await searchInventory(page, name);
  await openMarkEmptyMenu(page);
  await expect(page.getByRole("menuitem", { name: "Mark as empty", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark as empty & add to shopping list" })).toHaveCount(0);

  await setAutoAdd(false);
  await page.keyboard.press("Escape");
  await searchInventory(page, name);
  await openMarkEmptyMenu(page);
  await expect(page.getByRole("menuitem", { name: "Mark as empty", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark as empty & add to shopping list" })).toBeVisible();
});
