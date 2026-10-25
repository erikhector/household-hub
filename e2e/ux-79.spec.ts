import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-79: an unticked row on an active list is one 56-64 px line on a phone
// (name, then price and ⋯ on the same line), so a 15-item list shows at
// least six whole rows above the Next up dock instead of two or three.
// Lists are written straight to Postgres, named uniquely and removed again
// (only this worker's household's rows).
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

async function seedList(t: string, count: number) {
  const listId = `e2e-ux79-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Weekly shop ${t}`,
  ]);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `Thing ${String(i).padStart(2, "0")} ${t}`;
    names.push(name);
    const inventoryId = `e2e-ux79-inv-${t}-${i}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 'pcs', now())`,
      [inventoryId, E2E_HOUSEHOLD.id, name, `Aisle ${t}`],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased, "inventoryItemId")
       VALUES ($1, $2, $3, 'pcs', false, $4)`,
      [`e2e-ux79-item-${t}-${i}`, listId, name, inventoryId],
    );
  }
  return { path: `/dashboard/shopping-list/${listId}`, names };
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  for (const table of ["ShoppingList", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux79-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

test("an active 15-item list shows six whole rows above the dock, each 56-64 px", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 640, "the phone layout");
  const { path, names } = await seedList(tag(), 15);
  await page.goto(path);

  const rowOf = (name: string) =>
    page.getByRole("checkbox", { name: new RegExp(`^${name}`) }).locator("xpath=ancestor::*[@data-swipe-row][1]");

  // Scrolled the way a shopper is mid-shop: the first row just under the
  // sticky add bar. (On first load the page title and actions sit above the
  // list, which this item doesn't touch.) The page can still be settling
  // after hydration (the title collapsing as it scrolls away, the add bar
  // sticking), which moves the first row after a one-shot scroll was
  // measured (MAINT-46: the sixth row's bottom read 705 against a dock at
  // 531 on a loaded runner). So wait until the first row sits where it
  // should, and keeps sitting there across two frames, before measuring.
  const main = page.getByRole("main");
  const field = page.getByRole("combobox", { name: "Add to the list" });
  const gapToField = async () => {
    const f = (await field.boundingBox())!;
    const r = (await rowOf(names[0]).boundingBox())!;
    return r.y - (f.y + f.height + 16);
  };
  await expect(async () => {
    const before = await gapToField();
    if (Math.abs(before) > 1) await main.evaluate((el, by) => el.scrollBy(0, by), before);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(Math.abs(before), "the first row has stopped moving").toBeLessThanOrEqual(1);
    expect(Math.abs(await gapToField())).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 10_000 });

  const dock = (await page.getByRole("region", { name: "Next up" }).boundingBox())!;
  const rows = [];
  for (const name of names.slice(0, 6)) rows.push((await rowOf(name).boundingBox())!);
  for (const box of rows) {
    expect(box.height, "a row without a note").toBeGreaterThanOrEqual(56);
    expect(box.height, "a row without a note").toBeLessThanOrEqual(64);
  }
  expect(rows[5].y + rows[5].height, "sixth row clear of the dock").toBeLessThanOrEqual(dock.y);
  await expectNoHorizontalOverflow(page);
});

test("a row's price is added from the ⋯ on a phone, and the ⋯ stays a 44 px target", async ({ page }) => {
  const { path, names } = await seedList(tag(), 3);
  await page.goto(path);
  const name = names[0];

  if (page.viewportSize()!.width < 640) {
    // No "Add price" crowding the name's line; the ⋯ carries it.
    await expect(page.getByRole("button", { name: `Add an estimated price for ${name}` })).toBeHidden();
    const more = page.getByRole("button", { name: `More actions for ${name}` });
    const box = (await more.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await more.click();
    await page.getByRole("menuitem", { name: "Add price" }).click();
  } else {
    await page.getByRole("button", { name: `Add an estimated price for ${name}` }).click();
  }

  const input = page.getByRole("spinbutton", { name: `Estimated price for ${name}` });
  await expect(input).toBeFocused();
  await input.fill("24");
  await page.getByRole("button", { name: "Save price" }).click();

  // Saved (the editor closes only once the server has answered): the ≈
  // price stays on the row after a reload.
  await expect(input).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: `Edit estimated price for ${name}` })).toContainText("24");
});
