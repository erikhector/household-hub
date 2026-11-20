import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { withDb } from "./db";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { format } from "@/lib/i18n/format";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectTouchTargets, LOCALES, setLocaleCookie } from "./ui";

// UX-195: the "account created" view after /signup and after /join/<token>.
// Its stand-alone "Log in" is a 44 px target that carries the email to
// /login (the invite version linked to a bare /login), and once "Resend
// verification email" has answered, the "couldn't send" warning and its red
// icon are gone, so the view never shows two messages that disagree.
//
// The e2e server has no RESEND_API_KEY (playwright.config.ts passes none),
// so the first email always fails to send here and every run lands on the
// send-failed view, which is the one the item is about.
test.use({ storageState: { cookies: [], origins: [] } });

const dicts = { en, sv };
const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`.toLowerCase();

// The warning icon is decorative (no role or name), so the icon's own class
// is the only handle on it.
const warningIcon = (page: Page) => page.getByRole("main").locator("svg.lucide-triangle-alert");

async function expectTargets(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name !== "desktop") await expectTouchTargets(page);
}

// From the send-failed view: resend, then only the resend's answer is left.
async function resendAndExpectOneMessage(
  page: Page,
  testInfo: TestInfo,
  t: { failed: string; resend: string; resent: string },
) {
  await expect(page.getByRole("main").getByText(t.failed)).toBeVisible();
  await expect(warningIcon(page)).toBeVisible();
  await expectTargets(page, testInfo);

  await page.getByRole("button", { name: t.resend }).click();
  await expect(page.getByRole("main").getByText(t.resent)).toBeVisible();
  await expect(page.getByRole("main").getByText(t.failed)).toHaveCount(0);
  await expect(warningIcon(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.resend })).toHaveCount(0);
  await expectTargets(page, testInfo);
}

for (const locale of LOCALES) {
  const dict = dicts[locale];

  test.describe(`account created view (${locale})`, () => {
    const email = `ux195-${locale}-${stamp}@squirrel.test`;
    const token = `ux195-${locale}-${stamp}`;

    async function cleanup() {
      await withDb(async (c) => {
        await c.query(`DELETE FROM "User" WHERE "email" = $1`, [email]);
        await c.query(`DELETE FROM "Invitation" WHERE "token" = $1`, [token]);
      });
    }

    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await setLocaleCookie(context, baseURL!, locale);
      await cleanup();
    });
    test.afterEach(cleanup);

    test("after signup: a 44 px Log in with the email, and one message after a resend", async ({ page }, testInfo) => {
      const t = dict.auth.signup;
      await page.goto("/signup");
      const submit = page.getByRole("button", { name: t.submit });
      await expectHydrated(submit);
      await page.getByLabel(t.yourName).fill("Ux Onenintyfive");
      await page.getByLabel(t.householdName).fill(`Ux195 ${stamp}`);
      await page.getByLabel(t.email).fill(email);
      await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
      await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
      await submit.click();

      await expect(page.getByRole("heading", { name: t.accountCreatedTitle })).toBeVisible();
      await resendAndExpectOneMessage(page, testInfo, {
        failed: t.verificationSendFailedDescription,
        resend: t.resend,
        resent: dict.errors.verificationResent,
      });

      await page.getByRole("main").getByRole("link", { name: t.logIn, exact: true }).click();
      await expect(page).toHaveURL(/\/login\?/);
      await expect(page.getByLabel(dict.auth.login.email)).toHaveValue(email);
    });

    test("after joining by invite: a 44 px Log in with the email, and one message after a resend", async ({
      page,
    }, testInfo) => {
      const t = dict.auth.join;
      await withDb((c) =>
        c.query(
          `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt") VALUES ($1, $2, $3, now() + interval '1 day')`,
          [`inv-${token}`, E2E_HOUSEHOLD.id, token],
        ),
      );
      await page.goto(`/join/${token}`);
      const submit = page.getByRole("button", { name: t.submit });
      await expectHydrated(submit);
      await page.getByLabel(t.yourName).fill("Invited Onenintyfive");
      await page.getByLabel(t.email).fill(email);
      await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
      await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
      await submit.click();

      await resendAndExpectOneMessage(page, testInfo, {
        failed: format(t.verificationSendFailedDescription, { household: E2E_HOUSEHOLD.name }),
        resend: t.resend,
        resent: dict.errors.verificationResent,
      });

      // The invite version used to link to a bare /login.
      await page.getByRole("main").getByRole("link", { name: t.logIn, exact: true }).click();
      await expect(page).toHaveURL(/\/login\?/);
      await expect(page.getByLabel(dict.auth.login.email)).toHaveValue(email);
    });
  });
}
