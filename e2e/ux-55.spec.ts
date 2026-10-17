import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-55: joining by invite used to end on "Invalid invite". The action set
// the active-household cookie, which re-rendered /join/<token> after the
// invite was already used. A new member must see the verification-sent
// panel naming the household instead.
test.use({ storageState: { cookies: [], origins: [] } });

const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`;
const token = `ux55-${stamp}`;
const email = `ux55-${stamp}@example.com`.toLowerCase();

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await withDb(async (c) => {
    await c.query(`DELETE FROM "User" WHERE "email" = $1`, [email]);
    await c.query(`DELETE FROM "Invitation" WHERE "token" = $1`, [token]);
  });
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await cleanup();
  await withDb((c) =>
    c.query(
      `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt") VALUES ($1, $2, $3, now() + interval '1 day')`,
      [`inv-${token}`, E2E_HOUSEHOLD.id, token],
    ),
  );
});
test.afterEach(cleanup);

test("creating an account from an invite shows the verification panel, not 'Invalid invite'", async ({ page }) => {
  await page.goto(`/join/${token}`);
  await page.getByLabel("Your name").fill("Invited Member");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("supersecret1");
  await page.getByLabel("Confirm password").fill("supersecret1");
  await page.getByRole("button", { name: "Create account & join" }).click();

  await expect(page.getByText(`You've joined ${E2E_HOUSEHOLD.name}`)).toBeVisible();
  await expect(page.getByText("Invalid invite")).toHaveCount(0);

  // It stays that way once the page has settled.
  await page.waitForTimeout(500);
  await expect(page.getByText("Invalid invite")).toHaveCount(0);
});
