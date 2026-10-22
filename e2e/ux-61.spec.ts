import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { hashToken } from "@/lib/token-hash";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-61: the steps from signup to the first login. The card after signup is
// no longer titled "Create your household", a good verify link ends on
// "Email verified" with a primary "Log in", and both that and a password
// reset land on a login form with the email already filled in.
test.use({ storageState: { cookies: [], origins: [] } });

const SENT_TITLE = new RegExp(`${en.auth.signup.checkInboxTitle}|${en.auth.signup.accountCreatedTitle}`);
const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`;
const email = `ux61-${stamp}@squirrel.test`;

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
  await page.getByLabel(t.yourName).fill("Ux Sixtyone");
  await page.getByLabel(t.householdName).fill(`Ux61 ${stamp}`);
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
}

async function insertToken(table: "EmailVerificationToken" | "PasswordResetToken", raw: string) {
  await withDb((c) =>
    c.query(
      `INSERT INTO "${table}" ("id", "userId", "token", "expiresAt")
       SELECT $1, "id", $2, now() + interval '1 day' FROM "User" WHERE "email" = $3`,
      [`${table}-${raw}`, hashToken(raw), email],
    ),
  );
}

test("after signup the card stops saying 'Create your household'", async ({ page }) => {
  await signUp(page);
  // Whether the mail went out depends on the environment (no Resend key in
  // e2e), so either outcome title is fine; the old one is not.
  await expect(
    page.getByRole("heading", {
      name: SENT_TITLE,
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: en.auth.signup.pageTitle })).toHaveCount(0);
  await expect(page.getByRole("link", { name: en.auth.signup.logIn })).toHaveAttribute(
    "href",
    new RegExp(`email=${encodeURIComponent(email).replace(/\./g, "\\.")}`),
  );
});

test("a good verify link says 'Email verified' and Log in pre-fills the email", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("heading", { name: SENT_TITLE })).toBeVisible();
  const raw = `ux61-verify-${stamp}`;
  await insertToken("EmailVerificationToken", raw);

  await page.goto(`/verify-email/${raw}`);
  await expect(page.getByRole("heading", { name: en.auth.verifyEmail.verifiedTitle })).toBeVisible();
  await page.getByRole("link", { name: en.auth.verifyEmail.logIn }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel(en.auth.login.email)).toHaveValue(email);
});

test("after a password reset the login email is pre-filled", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("heading", { name: SENT_TITLE })).toBeVisible();
  const raw = `ux61-reset-${stamp}`;
  await insertToken("PasswordResetToken", raw);

  await page.goto(`/reset-password/${raw}`);
  // UX-67: a hidden username lets password managers update the right login.
  await expect(page.locator('input[autocomplete="username"]')).toHaveValue(email);
  await page.getByLabel(en.auth.resetPassword.newPassword, { exact: true }).fill("a-new-password-1");
  await page.getByLabel(en.auth.resetPassword.confirmPassword).fill("a-new-password-1");
  await page.getByRole("button", { name: en.auth.resetPassword.submit }).click();
  await expect(page).toHaveURL(/\/login\?reset=success/);
  await expect(page.getByText(en.auth.login.passwordResetSuccess)).toBeVisible();
  await expect(page.getByLabel(en.auth.login.email)).toHaveValue(email);
});
