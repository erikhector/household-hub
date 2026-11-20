import { expect, test } from "@playwright/test";
import { withDb } from "./db";
import { E2E_HOUSEHOLD, E2E_USER, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  gotoRevealed,
  holdServerActions,
  waitForDialogHistory,
} from "./ui";

// SEC-4: the Household page lists unused invites and a member can close one.
// The row is inserted directly (the invite dialog already has its own specs)
// and removed afterwards, only within this worker's household.
const INVITE_ID = `e2e-invite-sec4-w${E2E_WORKER}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await withDb((c) =>
    c.query(
      `INSERT INTO "Invitation" (id, "householdId", token, "expiresAt", "invitedById")
       VALUES ($1, $2, $3, now() + interval '7 days', $4)
       ON CONFLICT (id) DO NOTHING`,
      [INVITE_ID, E2E_HOUSEHOLD.id, `${INVITE_ID}-token`, E2E_USER.id],
    ),
  );
});

test.afterEach(async () => {
  await withDb((c) => c.query(`DELETE FROM "Invitation" WHERE id = $1 AND "householdId" = $2`, [INVITE_ID, E2E_HOUSEHOLD.id]));
});

test("a pending invite is listed and closing it stops the link working", async ({ page }) => {
  // Another spec renames the seeded user, so read the current name rather
  // than relying on the seeded one.
  const inviter = await withDb((c) => c.query(`SELECT "displayName" FROM "User" WHERE id = $1`, [E2E_USER.id]));
  const inviterName: string = inviter.rows[0].displayName;
  await gotoRevealed(page, "/dashboard/household");
  await expect(page.getByRole("heading", { name: "Pending invites" })).toBeVisible();

  // Other specs in this worker can leave invites by the same member, so the
  // rows are checked by count. Ours is the newest, so it's listed first.
  const closeButtons = page.getByRole("button", { name: `Close invite created by ${inviterName}` });
  const close = closeButtons.first();
  await expectHydrated(close);
  await expectNoHorizontalOverflow(page);

  // The link works before it is closed.
  // Asserted on visible text, not the raw HTML: the page's payload carries
  // the whole dictionary, including the "invalid" message, either way.
  await page.goto(`/join/${INVITE_ID}-token`);
  await expect(page.getByText(/invalid or has expired/)).toHaveCount(0);
  await gotoRevealed(page, "/dashboard/household");
  await expectHydrated(close);
  await expectRouterPatched(page);

  const listed = await closeButtons.count();

  // UX-206: the tap asks first, naming the invite, and Cancel keeps it.
  const dialog = page.getByRole("alertdialog", { name: "Close this invite?" });
  await close.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`created by ${inviterName}`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(closeButtons).toHaveCount(listed);
  // Let the closed dialog's history entry settle before reopening it.
  await waitForDialogHistory(page);

  // Confirm shows the pending label while the action is held, then the row
  // goes and stays gone after a reload.
  await close.click();
  await expect(dialog).toBeVisible();
  const held = await holdServerActions(page, "/dashboard/household");
  await dialog.getByRole("button", { name: "Close invite" }).click();
  await expect(dialog.getByRole("button", { name: "Closing…" })).toBeDisabled();
  held.release();
  await expect(page.getByText("Invite closed")).toBeVisible();
  await expect(closeButtons).toHaveCount(listed - 1);

  await waitForDialogHistory(page);
  // A fresh load, revealed in full, so a missing row isn't just one still
  // streaming in.
  await gotoRevealed(page, "/dashboard/household");
  await expect(closeButtons).toHaveCount(listed - 1);
  const rows = await withDb((c) => c.query(`SELECT 1 FROM "Invitation" WHERE id = $1`, [INVITE_ID]));
  expect(rows.rowCount).toBe(0);

  await page.goto(`/join/${INVITE_ID}-token`);
  await expect(page.getByText(/invalid or has expired/)).toBeVisible();
});

// UX-206 in Swedish: the confirm dialog's title, description, Cancel and
// pending label come from sv.ts, so a key missing or left in English there
// fails here. The page's language follows the signed-in user, not only the
// cookie, so this runs as the worker's Swedish member.
test.describe("sv", () => {
  test.use({ storageState: STORAGE_STATE_SV });

  test("closing a pending invite asks first, in Swedish", async ({ page }) => {
    const inviter = await withDb((c) => c.query(`SELECT "displayName" FROM "User" WHERE id = $1`, [E2E_USER.id]));
    const inviterName: string = inviter.rows[0].displayName;
    await gotoRevealed(page, "/dashboard/household");
    await expect(page.getByRole("heading", { name: "Väntande inbjudningar" })).toBeVisible();

    const closeButtons = page.getByRole("button", { name: `Stäng inbjudan skapad av ${inviterName}` });
    const close = closeButtons.first();
    await expectHydrated(close);
    await expectRouterPatched(page);
    const listed = await closeButtons.count();

    const dialog = page.getByRole("alertdialog", { name: "Stänga inbjudan?" });
    await close.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Inbjudan skapad av ${inviterName}`);
    await expect(dialog).toContainText("slutar fungera för den som har länken");
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole("button", { name: "Avbryt" }).click();
    await expect(dialog).toBeHidden();
    await expect(closeButtons).toHaveCount(listed);
    await waitForDialogHistory(page);

    await close.click();
    await expect(dialog).toBeVisible();
    const held = await holdServerActions(page, "/dashboard/household");
    await dialog.getByRole("button", { name: "Stäng inbjudan" }).click();
    await expect(dialog.getByRole("button", { name: "Stänger…" })).toBeDisabled();
    held.release();
    await expect(page.getByText("Inbjudan stängd")).toBeVisible();
    await expect(closeButtons).toHaveCount(listed - 1);

    await waitForDialogHistory(page);
    await gotoRevealed(page, "/dashboard/household");
    await expect(closeButtons).toHaveCount(listed - 1);
    const rows = await withDb((c) => c.query(`SELECT 1 FROM "Invitation" WHERE id = $1`, [INVITE_ID]));
    expect(rows.rowCount).toBe(0);
  });
});
