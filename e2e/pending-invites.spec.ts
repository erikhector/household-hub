import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, gotoRevealed } from "./ui";

// SEC-4: the Household page lists unused invites and a member can close one.
// The row is inserted directly (the invite dialog already has its own specs)
// and removed afterwards, only within this worker's household.
const INVITE_ID = `e2e-invite-sec4-w${E2E_WORKER}`;

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

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

test("a pending invite is listed and closing it stops the link working", async ({ page, request }) => {
  // Another spec renames the seeded user, so read the current name rather
  // than relying on the seeded one.
  const inviter = await withDb((c) => c.query(`SELECT "displayName" FROM "User" WHERE id = $1`, [E2E_USER.id]));
  const inviterName: string = inviter.rows[0].displayName;
  await gotoRevealed(page, "/dashboard/household");
  await expect(page.getByRole("heading", { name: "Pending invites" })).toBeVisible();

  const close = page.getByRole("button", { name: `Close invite created by ${inviterName}` }).first();
  await expectHydrated(close);
  await expectNoHorizontalOverflow(page);

  // The link works before it is closed.
  const before = await request.get(`/join/${INVITE_ID}-token`);
  expect(await before.text()).not.toContain("invalid or has expired");

  await close.click();
  await expect(page.getByText("Invite closed")).toBeVisible();

  await page.reload();
  const rows = await withDb((c) => c.query(`SELECT 1 FROM "Invitation" WHERE id = $1`, [INVITE_ID]));
  expect(rows.rowCount).toBe(0);

  const after = await request.get(`/join/${INVITE_ID}-token`);
  expect(await after.text()).toContain("invalid or has expired");
});
