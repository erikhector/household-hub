import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-48: a toast must never cover a bottom sheet's footer buttons or a row of
// the shopping "Next up" dock. On phones toasts sit at the top; on desktop
// they sit in the bottom-right corner, away from a centred dialog's footer.
// Either way the boxes must not intersect. Lists are written straight to
// Postgres, named uniquely, and only this worker's household is cleaned up.
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

async function seedList(t: string, items: { name: string; purchased: boolean }[]) {
  const listId = `e2e-ux48-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Shop ${t}`,
  ]);
  for (const [i, item] of items.entries()) {
    const inventoryId = `e2e-ux48-inv-${t}-${i}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, 'Uncategorized', 0, 'pcs', now())`,
      [inventoryId, E2E_HOUSEHOLD.id, item.name],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased, "inventoryItemId")
       VALUES ($1, $2, $3, 'pcs', $4, $5)`,
      [`e2e-ux48-item-${t}-${i}`, listId, item.name, item.purchased, inventoryId],
    );
  }
  return `/dashboard/shopping-list/${listId}`;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
});

test.afterAll(async () => {
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux48-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  await sql(`DELETE FROM "InventoryItem" WHERE id LIKE 'e2e-ux48-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

// No toast box may intersect `target`. Polled: toasts slide in over ~400 ms,
// so the check has to hold once they have settled.
async function expectToastsClear(page: Page, target: Locator) {
  const toasts = page.locator("[data-sonner-toast]");
  await expect(toasts.first()).toBeVisible();
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      if (!box) return "target has no box";
      for (const toast of await toasts.all()) {
        const t = await toast.boundingBox();
        if (!t) continue;
        const overlaps =
          t.x < box.x + box.width && box.x < t.x + t.width && t.y < box.y + box.height && box.y < t.y + t.height;
        if (overlaps) return "overlap";
      }
      return "clear";
    })
    .toBe("clear");
}

test("finishing a list with a Didn't get it row leaves Complete list visible and tappable", async ({ page }) => {
  const t = tag();
  const path = await seedList(t, [
    { name: `Rice ${t}`, purchased: true },
    { name: `Beans ${t}`, purchased: true },
  ]);
  await page.goto(path);

  await page.getByRole("button", { name: "Put things away" }).click();
  const putAway = page.getByRole("dialog", { name: "Put away before you finish?" });
  await putAway
    .getByRole("radiogroup", { name: `What to do with Beans ${t}` })
    .getByRole("radio", { name: en.shoppingList.putAway.options.notBought })
    .click();
  await putAway.getByRole("button", { name: "Put away & finish" }).click();

  const confirm = page.getByRole("dialog", { name: en.shoppingList.confirmCompleteList.title });
  const complete = confirm.getByRole("button", { name: en.shoppingList.confirmCompleteList.confirm, exact: true });
  await expect(complete).toBeVisible();
  // Both the "put away" and the "didn't get it" toasts are showing.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(2);
  await expectToastsClear(page, complete);
  await expectToastsClear(page, confirm.getByRole("button", { name: en.shoppingList.confirmCompleteList.cancel }));

  // Tappable: a real click lands on the button (a toast over it would
  // intercept the pointer and Playwright would time out waiting).
  await complete.click();
  await expect(confirm).toHaveCount(0);
});

test("a toast does not cover the Next up dock rows", async ({ page }) => {
  const t = tag();
  const path = await seedList(t, [
    { name: `Milk ${t}`, purchased: false },
    { name: `Eggs ${t}`, purchased: false },
  ]);
  await page.goto(path);

  const dock = page.getByRole("region", { name: en.shoppingList.shoppingMode.nextUp });
  await expect(dock).toBeVisible();
  await page.getByRole("button", { name: en.shoppingList.moreActions }).click();
  await page.getByRole("menuitem", { name: en.shoppingList.copyText }).click();
  await expect(page.getByText(en.shoppingList.copyTextToast).first()).toBeVisible();
  await expectToastsClear(page, dock);
});
