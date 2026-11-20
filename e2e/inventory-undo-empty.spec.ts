import { expect, test, type Page } from "@playwright/test";
import { uniqueTag, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, waitForDialogHistory } from "./ui";

// UX-197: emptying an item ("Mark as empty" in the row's menu, or "All" in
// the quantity sheet) shows one toast naming the item, and its Undo puts the
// old amount back and takes off the list row the emptying's auto-add put on
// "Next shop". Items are written straight to Postgres (like ux-122.spec.ts)
// with 6 pcs and a threshold of 1, so emptying crosses into low stock and the
// household's auto-add (on by default) adds a row.
const idPrefix = `e2e-ux197-${E2E_WORKER}-`;
const isMobile = () => test.info().project.name === "mobile";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Only this household's rows: the list rows first, since deleting the item
// would just unlink them.
test.afterEach(async () => {
  await withDb(async (client) => {
    await client.query(`DELETE FROM "ShoppingListItem" WHERE "inventoryItemId" LIKE $1`, [`${idPrefix}%`]);
    await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `${idPrefix}%`,
    ]);
  });
});

async function seedItem(name: string, id: string) {
  await withDb(async (client) => {
    await client.query(`UPDATE "Household" SET "autoAddLowStockToList" = true WHERE id = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
       VALUES ($1, $2, $3, 'Pantry', 6, 'pcs', 1, now())`,
      [id, E2E_HOUSEHOLD.id, name],
    );
  });
}

// Rows for the item still waiting on the household's default list.
const pendingOnDefaultList = (id: string) =>
  withDb(async (client) => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "ShoppingListItem" i JOIN "ShoppingList" l ON l.id = i."shoppingListId"
       WHERE i."inventoryItemId" = $1 AND i.purchased = false AND l."isDefault" AND l."householdId" = $2`,
      [id, E2E_HOUSEHOLD.id],
    );
    return rows[0].n as number;
  });

async function searchInventory(page: Page, query: string) {
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(query);
}

// The visible quantity button of the item (the table on desktop, the card on a phone).
function quantityButton(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^Adjust ${name} `) }).filter({ visible: true });
}

// One toast naming the item, with the auto-add folded into it rather than a
// second "Added … to" toast, and one Undo. Taps it and waits for the answer.
async function undoTheEmptying(page: Page, name: string) {
  await expect(page.getByText(new RegExp(`^Marked ${name} as empty and added it to `))).toBeVisible();
  await expect(page.getByText(new RegExp(`^Added ${name} to `))).toHaveCount(0);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toHaveCount(1);
  await undo.click();
  await expect(page.getByText(`${name} is back to its old amount`)).toBeVisible();
}

test("Undo on the mark-as-empty toast puts the amount back and takes the item off the list", async ({ page }) => {
  const tag = uniqueTag();
  const name = `Olive oil ${tag}`;
  const id = `${idPrefix}${tag}`;
  await seedItem(name, id);

  await searchInventory(page, name);
  await expect(quantityButton(page, name)).toHaveText("6 pcs");
  const trigger = page
    .getByRole("button", { name: isMobile() ? "More actions" : "Mark as empty", exact: true })
    .filter({ visible: true });
  await expectHydrated(trigger);
  await trigger.click();
  await page.getByRole("menuitem", { name: "Mark as empty", exact: true }).click();
  await expect(quantityButton(page, name)).toHaveText("0 pcs");

  await undoTheEmptying(page, name);

  // A fresh load: what the server saved, not the optimistic row.
  await searchInventory(page, name);
  await expect(quantityButton(page, name)).toHaveText("6 pcs");
  expect(await pendingOnDefaultList(id)).toBe(0);
});

test("Undo after the quantity sheet's All puts the amount back and takes the item off the list", async ({ page }) => {
  const tag = uniqueTag();
  const name = `Lentils ${tag}`;
  const id = `${idPrefix}${tag}`;
  await seedItem(name, id);

  await searchInventory(page, name);
  const quantity = quantityButton(page, name);
  await expect(quantity).toHaveText("6 pcs");
  await expectHydrated(quantity);
  await quantity.click();
  const sheet = page.getByRole("dialog", { name });
  await sheet.getByRole("button", { name: "All", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(quantity).toHaveText("0 pcs");

  await undoTheEmptying(page, name);

  await waitForDialogHistory(page);
  await searchInventory(page, name);
  await expect(quantityButton(page, name)).toHaveText("6 pcs");
  expect(await pendingOnDefaultList(id)).toBe(0);
});
