import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { hashToken } from "@/lib/token-hash";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-135: the emailed verification link signs the new user in and lands on
// the dashboard with a welcome. Opening the same link again does not sign in,
// and an expired link keeps the old behaviour.
test.use({ storageState: { cookies: [], origins: [] } });

const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`;
const email = `ux135-${stamp}@squirrel.test`;
const NAME = "Ux Onethirtyfive";

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
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
});
test.afterEach(() => withDb((c) => c.query(`DELETE FROM "User" WHERE "email" = $1`, [email])));

async function signUp(page: import("@playwright/test").Page) {
  const t = en.auth.signup;
  await page.goto("/signup");
  await page.getByLabel(t.yourName).fill(NAME);
  await page.getByLabel(t.householdName).fill(`Ux135 ${stamp}`);
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`${t.checkInboxTitle}|${t.accountCreatedTitle}`),
    }),
  ).toBeVisible();
}

// The raw token only exists in the email (not sent in e2e), so insert a known
// one for the new user, stored hashed like the real thing.
async function insertToken(raw: string, interval: string) {
  await withDb((c) =>
    c.query(
      `INSERT INTO "EmailVerificationToken" ("id", "userId", "token", "expiresAt")
       SELECT $1, "id", $2, now() + $4::interval FROM "User" WHERE "email" = $3`,
      [`EmailVerificationToken-${raw}`, hashToken(raw), email, interval],
    ),
  );
}

test("the verification link signs the new user in and welcomes them; a second open does not", async ({
  page,
  browser,
  baseURL,
}) => {
  await signUp(page);
  const raw = `ux135-link-${stamp}`;
  await insertToken(raw, "1 day");

  await page.goto(`/verify-email/${raw}`);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(
    page.getByRole("heading", { name: `Welcome to Squirrel, ${NAME.split(" ")[0]}` }),
  ).toBeVisible();
  // The one-off query is dropped, so a reload shows the ordinary greeting.
  await expect(page).not.toHaveURL(/welcome/);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Welcome to Squirrel/ })).toHaveCount(0);

  // Same link in a fresh browser (the signed-in page could re-set its
  // session cookie after a clearCookies): verified, but not signed in.
  const fresh = await browser.newContext({ baseURL: baseURL! });
  try {
    await dismissCookieNotice(fresh, baseURL!);
    const other = await fresh.newPage();
    await other.goto(`/verify-email/${raw}`);
    await expect(other.getByRole("heading", { name: en.auth.verifyEmail.verifiedTitle })).toBeVisible();
    await expect(other).toHaveURL(/\/verify-email\//);
    await other.goto("/dashboard");
    await expect(other).toHaveURL(/\/login/);
  } finally {
    await fresh.close();
  }
});

test("an expired verification link keeps today's behaviour and signs nobody in", async ({ page }) => {
  await signUp(page);
  const raw = `ux135-expired-${stamp}`;
  await insertToken(raw, "-1 hour");

  await page.goto(`/verify-email/${raw}`);
  await expect(page.getByRole("heading", { name: en.auth.verifyEmail.invalidTitle })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
