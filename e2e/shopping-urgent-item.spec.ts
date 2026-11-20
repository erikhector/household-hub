import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { format } from "@/lib/i18n/format";
import { unique, uniqueId, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectRouterPatched, waitForDialogHistory } from "./ui";

// GAP-86: a row can be flagged "Urgent" from its ⋯ menu or its edit dialog.
// An unticked urgent row carries the badge and leads its aisle on the list
// and in the Next up dock; ticking it clears the flag for good. Each test
// gets its own list holding just its two items, so the dock and the aisle
// show only those. The rows are written straight to Postgres, unlinked, so
// both sit in the same aisle ("Other"): typed into the add line, a random
// name tag can read as a category ("…vin" went to Drinks) and split them.
const t = en.shoppingList;
const PREFIX = "e2e-gap86";

async function seedList(page: Page, items: string[]) {
  const listId = uniqueId(`${PREFIX}-list`);
  await withDb(async (client) => {
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      listId,
      E2E_HOUSEHOLD.id,
      unique("Urgent shop"),
    ]);
    // One second apart, so list order (createdAt) is the order given.
    for (const [i, name] of items.entries()) {
      await client.query(
        `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, "createdAt")
         VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
        [uniqueId(`${PREFIX}-item`), listId, name, i],
      );
    }
  });
  await page.goto(`/dashboard/shopping-list/${listId}`);
  for (const name of items) await expect(rowOf(page, name)).toBeVisible();
  await expectRouterPatched(page);
  return listId;
}

const rowOf = (page: Page, item: string) => page.getByRole("checkbox", { name: new RegExp(`^${item}\\b`) });

/** What the server holds for the row, to wait for a save before a reload. */
async function stored(listId: string, name: string) {
  return withDb(async (client) => {
    const { rows } = await client.query<{ purchased: boolean; urgent: boolean }>(
      `SELECT i.purchased, i.urgent FROM "ShoppingListItem" i JOIN "ShoppingList" l ON l.id = i."shoppingListId"
       WHERE i."shoppingListId" = $1 AND l."householdId" = $2 AND i.name = $3`,
      [listId, E2E_HOUSEHOLD.id, name],
    );
    return rows[0] ?? null;
  });
}

async function openRowMenu(page: Page, item: string) {
  const more = page.getByRole("button", { name: format(t.rowActionsAriaLabel, { name: item }), exact: true });
  await expectHydrated(more);
  await more.click();
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Lists cascade to their rows. Only this worker's household, and only this
// worker's ids (uniqueId puts E2E_WORKER in them).
test.afterAll(async () => {
  await withDb(async (client) => {
    await client.query(`DELETE FROM "ShoppingList" WHERE id LIKE $1 AND "householdId" = $2`, [
      `${PREFIX}-list-w${E2E_WORKER}-%`,
      E2E_HOUSEHOLD.id,
    ]);
  });
});

test("an item marked urgent leads its aisle and the dock until it's ticked", async ({ page }) => {
  const first = unique("Thingamajig");
  const second = unique("Whatsit");
  const listId = await seedList(page, [first, second]);
  const ours = page.getByRole("checkbox", { name: new RegExp(`^(${first}|${second})\\b`) });
  // Insertion order before anything is urgent.
  await expect(ours.first()).toHaveAccessibleName(new RegExp(`^${first}\\b`));

  // The ⋯ shows at every width once it has "Mark urgent" to offer.
  await openRowMenu(page, second);
  await page.getByRole("menuitem", { name: t.markUrgent, exact: true }).click();
  await expect(rowOf(page, second)).toHaveAccessibleName(new RegExp(`^${second}\\b.*${t.urgentBadge}`));
  await expect.poll(async () => (await stored(listId, second))?.urgent).toBe(true);

  await page.reload();
  // On the list: first in the aisle, badge in its label (a word, not colour).
  await expect(ours.first()).toHaveAccessibleName(new RegExp(`^${second}\\b.*${t.urgentBadge}`));
  await expect(rowOf(page, first)).not.toHaveAccessibleName(new RegExp(t.urgentBadge));
  // In shopping mode's dock: first too, with the badge, and said to a screen reader.
  const dock = page.getByRole("region", { name: t.shoppingMode.nextUp });
  const firstDockRow = dock.getByRole("listitem").first();
  await expect(firstDockRow).toContainText(second);
  await expect(firstDockRow).toContainText(t.urgentBadge);
  await expect(
    dock.getByRole("button", { name: format(t.shoppingMode.tickUrgentAriaLabel, { item: second }), exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The menu now offers the way back.
  await openRowMenu(page, second);
  await expect(page.getByRole("menuitem", { name: t.unmarkUrgent, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // Ticking clears the flag: the badge goes, and stays gone after an un-tick.
  const urgentBox = rowOf(page, second);
  await expectHydrated(urgentBox);
  await urgentBox.click();
  await expect.poll(async () => await stored(listId, second)).toEqual({ purchased: true, urgent: false });
  const cart = page.getByRole("button", { name: /^In the cart/ });
  await cart.click();
  await expect(rowOf(page, second)).toBeChecked();
  await expect(rowOf(page, second)).not.toHaveAccessibleName(new RegExp(t.urgentBadge));

  await rowOf(page, second).click();
  await expect.poll(async () => (await stored(listId, second))?.purchased).toBe(false);
  await page.reload();
  await expect(rowOf(page, second)).not.toBeChecked();
  await expect(rowOf(page, second)).not.toHaveAccessibleName(new RegExp(t.urgentBadge));
  // Back in plain list order, after the item added before it.
  await expect(ours.first()).toHaveAccessibleName(new RegExp(`^${first}\\b`));
});

test("the edit dialog's Urgent box sets and clears the flag", async ({ page }) => {
  const first = unique("Doodad");
  const second = unique("Gizmo");
  const listId = await seedList(page, [first, second]);
  const ours = page.getByRole("checkbox", { name: new RegExp(`^(${first}|${second})\\b`) });

  await openRowMenu(page, second);
  await page.getByRole("menuitem", { name: t.swipe.edit, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: format(t.editItem.title, { name: second }) });
  const urgentBox = dialog.getByRole("checkbox", { name: t.editItem.urgentLabel });
  await expect(urgentBox).not.toBeChecked();
  await urgentBox.check();
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole("button", { name: t.editItem.save, exact: true }).click();
  await waitForDialogHistory(page);
  await expect.poll(async () => (await stored(listId, second))?.urgent).toBe(true);

  await page.reload();
  await expect(ours.first()).toHaveAccessibleName(new RegExp(`^${second}\\b.*${t.urgentBadge}`));

  await openRowMenu(page, second);
  await page.getByRole("menuitem", { name: t.swipe.edit, exact: true }).click();
  await expect(urgentBox).toBeChecked();
  await urgentBox.uncheck();
  await dialog.getByRole("button", { name: t.editItem.save, exact: true }).click();
  await waitForDialogHistory(page);
  await expect.poll(async () => (await stored(listId, second))?.urgent).toBe(false);
  await expect(rowOf(page, second)).not.toHaveAccessibleName(new RegExp(t.urgentBadge));
});
