import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { unique, withDb } from "./db";
import { E2E_USER } from "./seed";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-210: submitting a signed-out form while the connection is down used to
// reject the Server Action, and the root error boundary replaced the page
// ("Something went wrong"), wiping what was typed. Now the form stays, says
// to check the connection in its own error line, and keeps the typed values;
// back online, the same form goes through.
test.use({ storageState: { cookies: [], origins: [] } });

const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`;
const signupEmail = `ux210-${stamp}@squirrel.test`;
const householdName = unique("Offline house");

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});
test.afterEach(async ({ context }) => {
  await context.setOffline(false);
});
test.afterAll(() =>
  withDb(async (c) => {
    await c.query(`DELETE FROM "User" WHERE "email" = $1`, [signupEmail]);
    await c.query(`DELETE FROM "Household" WHERE "name" = $1`, [householdName]);
  }),
);

// The root boundary's heading, in either language.
const crashHeading = (page: Page) => page.getByRole("heading", { name: /something went wrong|något gick fel/i });

test("a login sent offline says to check the connection and keeps the email", async ({ page, context }) => {
  const t = en.auth.login;
  await page.goto("/login");
  const email = page.getByLabel(t.email);
  const password = page.getByLabel(t.password, { exact: true });
  const submit = page.getByRole("button", { name: t.submit });
  // Before hydration the browser would post the form itself.
  await expectHydrated(submit);

  await email.fill(E2E_USER.email);
  await password.fill(E2E_PASSWORD);
  await context.setOffline(true);
  await submit.click();

  await expect(page.getByRole("alert").filter({ hasText: en.errors.requestFailed })).toBeVisible();
  await expect(crashHeading(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login/);
  await expect(email).toHaveValue(E2E_USER.email);
  // The password wasn't wrong, so it isn't flagged as if it were.
  await expect(password).not.toHaveAttribute("aria-invalid", "true");

  await context.setOffline(false);
  await password.fill(E2E_PASSWORD);
  await submit.click();
  await page.waitForURL("**/dashboard**");
});

test("a signup sent offline says to check the connection and keeps the name and email", async ({
  page,
  context,
}) => {
  const t = en.auth.signup;
  await page.goto("/signup");
  const submit = page.getByRole("button", { name: t.submit });
  await expectHydrated(submit);

  const name = page.getByLabel(t.yourName);
  const household = page.getByLabel(t.householdName);
  const email = page.getByLabel(t.email);
  const password = page.getByLabel(t.password, { exact: true });
  const confirm = page.getByLabel(t.confirmPassword);
  await name.fill("Ux Twoten");
  await household.fill(householdName);
  await email.fill(signupEmail);
  await password.fill(E2E_PASSWORD);
  await confirm.fill(E2E_PASSWORD);
  await context.setOffline(true);
  await submit.click();

  await expect(page.getByRole("alert").filter({ hasText: en.errors.requestFailed })).toBeVisible();
  await expect(crashHeading(page)).toHaveCount(0);
  await expect(name).toHaveValue("Ux Twoten");
  await expect(household).toHaveValue(householdName);
  await expect(email).toHaveValue(signupEmail);

  // Back online, only the passwords need typing again.
  await context.setOffline(false);
  await password.fill(E2E_PASSWORD);
  await confirm.fill(E2E_PASSWORD);
  await submit.click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`${t.checkInboxTitle}|${t.accountCreatedTitle}`) }),
  ).toBeVisible();
});

test("a reset link requested offline says to check the connection and keeps the email", async ({
  page,
  context,
}) => {
  const t = en.auth.forgotPassword;
  await page.goto("/forgot-password");
  const submit = page.getByRole("button", { name: t.submit });
  await expectHydrated(submit);

  const email = page.getByLabel(t.email);
  await email.fill(E2E_USER.email);
  await context.setOffline(true);
  await submit.click();

  await expect(page.getByText(en.errors.requestFailed)).toBeVisible();
  await expect(crashHeading(page)).toHaveCount(0);
  await expect(email).toHaveValue(E2E_USER.email);
});
