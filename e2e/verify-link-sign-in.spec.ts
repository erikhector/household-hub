import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { format } from "@/lib/i18n/format";
import { hashToken } from "@/lib/token-hash";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-135: the link in the verification mail signs a new user straight in and
// greets them on the dashboard; the same link a second time does not.
test.use({ storageState: { cookies: [], origins: [] } });

const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`;
const email = `ux135-${stamp}@squirrel.test`;
const SENT_TITLE = new RegExp(`${en.auth.signup.checkInboxTitle}|${en.auth.signup.accountCreatedTitle}`);

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

test("the verification link signs a new user in with a welcome, and a second visit does not", async ({
  page,
  browser,
  baseURL,
}) => {
  const t = en.auth.signup;
  await page.goto("/signup");
  await page.getByLabel(t.yourName).fill("Verify Linker");
  await page.getByLabel(t.householdName).fill(`Ux135 ${stamp}`);
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByRole("heading", { name: SENT_TITLE })).toBeVisible();

  // The mail's raw token isn't recoverable from the database (only its
  // hash is stored, SEC-8), so insert a token we know for the new account.
  const raw = `ux135-${stamp}`;
  await withDb((c) =>
    c.query(
      `INSERT INTO "EmailVerificationToken" ("id", "userId", "token", "expiresAt")
       SELECT $1, "id", $2, now() + interval '1 day' FROM "User" WHERE "email" = $3`,
      [`EmailVerificationToken-${raw}`, hashToken(raw), email],
    ),
  );

  await page.goto(`/verify-email/${raw}`);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(format(en.dashboard.welcome, { name: "Verify" }))).toBeVisible();
  // The flag is dropped so a reload doesn't greet them again.
  await expect(page).not.toHaveURL(/welcome/);
  await page.reload();
  await expect(page.getByText(format(en.dashboard.welcome, { name: "Verify" }))).toHaveCount(0);

  // A second visitor with the same (now spent) link is not signed in.
  const context = await browser.newContext({ baseURL });
  await dismissCookieNotice(context, baseURL!);
  const second = await context.newPage();
  await second.goto(`/verify-email/${raw}`);
  await expect(second.getByRole("heading", { name: en.auth.verifyEmail.verifiedTitle })).toBeVisible();
  await expect(second.getByRole("link", { name: en.auth.verifyEmail.logIn })).toBeVisible();
  await second.goto("/dashboard");
  await expect(second).toHaveURL(/\/login/);
  await context.close();
});

test("an unknown link keeps today's behaviour: Link expired, not signed in", async ({ page }) => {
  await page.goto("/verify-email/ux135-no-such-token");
  await expect(page.getByRole("heading", { name: en.auth.verifyEmail.invalidTitle })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
