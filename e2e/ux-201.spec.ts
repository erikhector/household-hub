import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, gotoRevealed, waitForDialogHistory } from "./ui";

// UX-201: revoking a share link can't be undone and cuts off whoever is
// shopping from it, so Revoke asks first (an alertdialog); and a failed
// create's error doesn't linger beside the working link on the next open.
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

async function insertList(listId: string) {
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    listId,
  ]);
}

async function openShareDialog(page: Page) {
  const more = page.getByRole("button", { name: t.moreActions });
  await expectHydrated(more);
  await expectRouterPatched(page);
  await more.click();
  await page.getByRole("menu").getByRole("menuitem", { name: t.shareLink.button }).click();
  return page.getByRole("dialog", { name: t.shareLink.dialogTitle });
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux201-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

test("Revoke asks first: Cancel keeps the link, confirming revokes it", async ({ page }) => {
  const listId = `e2e-ux201-${tag()}`;
  await insertList(listId);
  // A page to go back to, so the back step after revoking can be checked.
  await page.goto("/dashboard/shopping-list");
  await gotoRevealed(page, `/dashboard/shopping-list/${listId}`);

  const share = await openShareDialog(page);
  const linkField = share.getByRole("textbox", { name: t.shareLink.linkAriaLabel });
  await expect(linkField).toBeVisible();
  const url = await linkField.inputValue();

  await share.getByRole("button", { name: t.shareLink.revoke }).click();
  const confirm = page.getByRole("alertdialog", { name: t.shareLink.revokeConfirmTitle });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(t.shareLink.revokeConfirmDescription)).toBeVisible();
  // The scout's screenshot of the confirmation (off unless E2E_SCREENSHOT_DIR is set).
  const shots = process.env.E2E_SCREENSHOT_DIR;
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-ux201-revoke-confirm.png` });

  // Cancel: nothing revoked, the link is still there.
  await confirm.getByRole("button", { name: t.shareLink.revokeConfirmCancel }).click();
  await expect(confirm).toHaveCount(0);
  await expect(linkField).toBeVisible();
  expect(
    (await sql(`SELECT "revokedAt" FROM "ShoppingListShareLink" WHERE "shoppingListId" = $1`, [listId]))[0]
      ?.revokedAt,
  ).toBeNull();

  // Confirm: the revoked toast, and the share page now reads as revoked.
  await share.getByRole("button", { name: t.shareLink.revoke }).click();
  await page
    .getByRole("alertdialog", { name: t.shareLink.revokeConfirmTitle })
    .getByRole("button", { name: t.shareLink.revoke })
    .click();
  await expect(page.getByText(t.shareLink.revokedToast).first()).toBeVisible();
  await waitForDialogHistory(page);

  // Confirming closes the confirm and the Share dialog together. Both
  // entries they pushed (dialog-history.ts) must be gone, so one back
  // (the phone's back gesture, M7) leaves the list page rather than
  // stepping onto a dead same-URL entry.
  await expect(page).toHaveURL(new RegExp(`/dashboard/shopping-list/${listId}$`));
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list$/);

  await page.goto(new URL(url).pathname);
  await expect(page.getByRole("heading", { name: en.sharedShoppingList.notFoundTitle })).toBeVisible();
  await expect(page.getByText(en.sharedShoppingList.notFoundDescription)).toBeVisible();
});

test("a failed create's error is gone when the next open gets a link", async ({ page }) => {
  const listId = `e2e-ux201-${tag()}`;
  await insertList(listId);
  await gotoRevealed(page, `/dashboard/shopping-list/${listId}`);

  // Remove the list behind the open page so the first create fails.
  await sql(`DELETE FROM "ShoppingList" WHERE id = $1 AND "householdId" = $2`, [listId, E2E_HOUSEHOLD.id]);
  let share = await openShareDialog(page);
  await expect(share.getByText(en.errors.shoppingListNotFound)).toBeVisible();
  await page.keyboard.press("Escape");
  await waitForDialogHistory(page);

  // Put it back: the next open creates a link and shows no stale error.
  await insertList(listId);
  share = await openShareDialog(page);
  await expect(share.getByRole("textbox", { name: t.shareLink.linkAriaLabel })).toBeVisible();
  await expect(share.getByText(en.errors.shoppingListNotFound)).toHaveCount(0);
});
