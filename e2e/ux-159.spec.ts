import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, gotoRevealed } from "./ui";

// UX-159: the trip ends in the thumb zone. Once every row is ticked the dock
// stays and its primary, "Finish trip", completes the list; the ⋯ menu leads
// with "This trip", keeps the list's own settings behind a submenu and Delete
// alone at the bottom.
const t = en.shoppingList;
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

async function seedList(names: string[]) {
  const listId = `e2e-ux159-${tag()}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    listId,
  ]);
  for (const [i, name] of names.entries()) {
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, quantity, unit, purchased) VALUES ($1, $2, $3, 1, 'pcs', false)`,
      [`${listId}-${i}`, listId, name],
    );
  }
  return listId;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux159-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

test("ticking every row leaves a Finish trip primary in the dock that completes the list", async ({ page }) => {
  const stamp = tag();
  const first = `Oats ${stamp}`;
  const second = `Pears ${stamp}`;
  const listId = await seedList([first, second]);
  await gotoRevealed(page, `/dashboard/shopping-list/${listId}`);

  const dock = page.getByRole("region", { name: t.shoppingMode.nextUp });
  await expectHydrated(dock);
  await expect(dock.getByRole("button", { name: t.shoppingMode.finishTrip })).toHaveCount(0);

  // A ticked dock row is disabled while it settles; clicking waits for the
  // next one to become enabled.
  await dock.getByRole("button", { name: new RegExp(`${first}.*into the cart`) }).click();
  await dock.getByRole("button", { name: new RegExp(`${second}.*into the cart`) }).click();

  const finish = dock.getByRole("button", { name: t.shoppingMode.finishTrip });
  await expect(finish).toBeEnabled();
  // Ticked rows wait to be put away, so the card's "Put everything away" is
  // the one primary and the dock's button is outline; dismissing the card
  // hands the primary back to the dock.
  await expect(page.getByRole("button", { name: t.putAway.everything })).toBeVisible();
  await expect(finish).not.toHaveClass(/bg-primary/);
  await page.getByRole("button", { name: t.clearedDismissAriaLabel }).click();
  await expect(page.getByRole("button", { name: t.putAway.everything })).toHaveCount(0);
  await expect(finish).toHaveClass(/bg-primary/);
  // The scout's screenshot of the finish state (off unless E2E_SCREENSHOT_DIR is set).
  const shots = process.env.E2E_SCREENSHOT_DIR;
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-ux159-finish-dock.png` });
  await finish.click();
  // Ticked rows still wait to be put away, so the finish path offers that
  // first, exactly like the menu's Complete list.
  await page
    .getByRole("dialog", { name: t.putAway.finishTitle })
    .getByRole("button", { name: t.putAway.finishLater })
    .click();

  await expect(page.getByText(t.completedToast).first()).toBeVisible();
  await expect(page.getByText(t.statusCompleted, { exact: true }).first()).toBeVisible();
  await expect
    .poll(async () => (await sql(`SELECT status FROM "ShoppingList" WHERE id = $1`, [listId]))[0]?.status)
    .toBe("COMPLETED");
});

test("the more-actions menu leads with This trip, tucks settings away and ends with Delete", async ({ page }) => {
  const listId = await seedList([`Rye ${tag()}`]);
  await gotoRevealed(page, `/dashboard/shopping-list/${listId}`);
  const more = page.getByRole("button", { name: t.moreActions });
  await expectHydrated(more);
  await more.click();

  const menu = page.getByRole("menu");
  await expect(menu.getByText(t.menuThisTrip, { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: t.completeList })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: t.shareLink.button })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: t.renameList.menuItem })).toHaveCount(0);

  const items = menu.getByRole("menuitem");
  await expect(items.last()).toHaveText(t.delete);
  await expect(items.nth(-2)).toHaveText(t.menuListSettings);

  await menu.getByRole("menuitem", { name: t.menuListSettings }).click();
  await expect(page.getByRole("menuitem", { name: t.renameList.menuItem })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: t.archive, exact: true })).toBeVisible();
});
