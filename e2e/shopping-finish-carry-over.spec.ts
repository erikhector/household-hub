import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-80: "Put away & finish" completes in one step, and the rows nobody
// bought move to the next active list (on by default) instead of staying
// stranded on the completed one. Lists are written straight to Postgres,
// named uniquely, and only this worker's household is touched.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql<T = never>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

async function seedList(t: string, items: { name: string; purchased: boolean }[]) {
  const listId = `e2e-ux80-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Shop ${t}`,
  ]);
  for (const [i, item] of items.entries()) {
    const inventoryId = `e2e-ux80-inv-${t}-${i}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, 'Uncategorized', 0, 'pcs', now())`,
      [inventoryId, E2E_HOUSEHOLD.id, item.name],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased, "inventoryItemId")
       VALUES ($1, $2, $3, 'pcs', $4, $5)`,
      [`e2e-ux80-item-${t}-${i}`, listId, item.name, item.purchased, inventoryId],
    );
  }
  return { listId, path: `/dashboard/shopping-list/${listId}` };
}

// Off unless E2E_SCREENSHOT_DIR is set (same switch as ui.ts's saveScreenshot).
async function shot(page: Page, project: string, name: string) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${project}-en-${name}.png`) });
}

const listOf = async (name: string) =>
  (await sql<{ shoppingListId: string }>(`SELECT "shoppingListId" FROM "ShoppingListItem" WHERE name = $1`, [name]))[0]
    ?.shoppingListId;

// With a row still unticked there's no "All done" button, so the finish
// sheet opens from the menu's "Complete list".
async function openFinishSheet(page: Page) {
  await page.getByRole("button", { name: en.shoppingList.moreActions }).click();
  await page.getByRole("menuitem", { name: en.shoppingList.completeList }).click();
  return page.getByRole("dialog", { name: en.shoppingList.putAway.finishTitle });
}

async function markNotBought(page: Page, notBought: string) {
  const sheet = await openFinishSheet(page);
  await sheet
    .getByRole("radiogroup", { name: `What to do with ${notBought}` })
    .getByRole("radio", { name: en.shoppingList.putAway.options.notBought })
    .click();
  return sheet;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  // Rows carried to the household's default list live on a list this spec
  // doesn't own, so they're removed by id.
  await sql(
    `DELETE FROM "ShoppingListItem" WHERE id LIKE 'e2e-ux80-%' AND "shoppingListId" IN
       (SELECT id FROM "ShoppingList" WHERE "householdId" = $1)`,
    [E2E_HOUSEHOLD.id],
  );
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux80-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  await sql(`DELETE FROM "InventoryItem" WHERE id LIKE 'e2e-ux80-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

test("Put away & finish completes in one step and moves the unbought rows to the next list", async ({ page }, testInfo) => {
  const t = tag();
  const { listId, path } = await seedList(t, [
    { name: `Rice ${t}`, purchased: true },
    { name: `Beans ${t}`, purchased: true },
    { name: `Milk ${t}`, purchased: false },
  ]);
  await page.goto(path);

  const sheet = await markNotBought(page, `Beans ${t}`);
  // Beans (just marked "didn't get it") and Milk (still pending) can move.
  const carry = sheet.getByRole("checkbox", { name: /Move 2 unbought items to / });
  await expect(carry).toBeChecked();
  await shot(page, testInfo.project.name, "put-away-finish-sheet");
  await sheet.getByRole("button", { name: en.shoppingList.putAway.finishConfirm }).click();

  // One step: no second "Complete this list?" sheet, the list is done.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: en.shoppingList.confirmCompleteList.title })).toHaveCount(0);
  await expect(page.getByText(en.shoppingList.completedToast).first()).toBeVisible();
  await expect(page.getByText(/2 items moved to /).first()).toBeVisible();

  // Both rows now sit, pending, on another active list.
  await expect.poll(() => listOf(`Milk ${t}`)).not.toBe(listId);
  const target = (await listOf(`Milk ${t}`))!;
  expect(await listOf(`Beans ${t}`)).toBe(target);
  expect(await listOf(`Rice ${t}`)).toBe(listId);
  await page.goto(`/dashboard/shopping-list/${target}`);
  // The print-only copy of the list renders the name too, hidden.
  await expect(page.getByText(`Milk ${t}`).locator("visible=true").first()).toBeVisible();
  // The print-only copy of the list renders the name too, hidden.
  await expect(page.getByText(`Beans ${t}`).locator("visible=true").first()).toBeVisible();
});

test("unchecking the carry-over leaves the unbought row on the completed list", async ({ page }) => {
  const t = tag();
  const { listId, path } = await seedList(t, [
    { name: `Rice ${t}`, purchased: true },
    { name: `Milk ${t}`, purchased: false },
  ]);
  await page.goto(path);

  const sheet = await openFinishSheet(page);
  await sheet.getByRole("checkbox", { name: /Move 1 unbought item to / }).uncheck();
  await sheet.getByRole("button", { name: en.shoppingList.putAway.finishConfirm }).click();

  await expect(page.getByText(en.shoppingList.completedToast).first()).toBeVisible();
  await expect(page.getByText(/moved to /)).toHaveCount(0);
  expect(await listOf(`Milk ${t}`)).toBe(listId);
});

test("the Complete list confirm names the pending count and has no Archive advice", async ({ page }, testInfo) => {
  const t = tag();
  const { listId, path } = await seedList(t, [
    { name: `Rice ${t}`, purchased: true },
    { name: `Milk ${t}`, purchased: false },
  ]);
  await sql(`UPDATE "ShoppingListItem" SET "putAwayAt" = now() WHERE "shoppingListId" = $1 AND purchased`, [listId]);
  await page.goto(path);

  await page.getByRole("button", { name: en.shoppingList.moreActions }).click();
  await page.getByRole("menuitem", { name: en.shoppingList.completeList }).click();
  const confirm = page.getByRole("dialog", { name: en.shoppingList.confirmCompleteList.title });
  await expect(confirm).toContainText("1 item isn't ticked off yet");
  await expect(confirm).not.toContainText("Archive");
  await expect(confirm).not.toContainText("Unarchive");
  await expect(confirm.getByRole("checkbox", { name: /Move 1 unbought item to / })).toBeChecked();
  await shot(page, testInfo.project.name, "complete-confirm");

  await confirm.getByRole("button", { name: en.shoppingList.confirmCompleteList.confirm, exact: true }).click();
  await expect(page.getByText(/1 item moved to /).first()).toBeVisible();
  await expect.poll(() => listOf(`Milk ${t}`)).not.toBe(listId);
});
