import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { hashToken } from "@/lib/token-hash";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, saveScreenshot, setLocaleCookie } from "./ui";

// UX-194: the invite sign-up form and the reset-password form check the
// password in the browser, as /signup does (UX-59). A password under 8
// characters or a confirmation that differs is worded under its field in
// the page's language, the field takes focus and aria-invalid, and the
// submit is blocked before any Server Action runs, so React never resets
// the form and both passwords stay as typed. Before this the mistake went to
// the server and came back with both fields emptied.
const DICTS = { en, sv } as const;

async function withDb(fn: (c: Client) => Promise<unknown>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

/** Counts the Server Action POSTs the page sends from here on. */
function countServerActions(page: Page) {
  let sent = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && "next-action" in request.headers()) sent++;
  });
  return () => sent;
}

/** The message is the field's own: announced, tied to the input, and laid
 * out below it rather than as a line further down the form. */
async function expectErrorUnder(field: Locator, alert: Locator) {
  await expect(alert).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAttribute("aria-describedby", new RegExp(`(^| )${await alert.getAttribute("id")}( |$)`));
  await expect(field).toBeFocused();
  const fieldBox = (await field.boundingBox())!;
  const alertBox = (await alert.boundingBox())!;
  expect(alertBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
  // Within a couple of lines of the input: the hint may sit between them.
  expect(alertBox.y - (fieldBox.y + fieldBox.height)).toBeLessThan(48);
}

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

for (const locale of ["en", "sv"] as const) {
  const t = DICTS[locale];

  test.describe(`invite sign-up password checks (${locale})`, () => {
    const j = t.auth.join;
    const token = `ux194-join-${E2E_WORKER}-${locale}-${Date.now().toString(36)}`;

    test.beforeAll(() =>
      withDb((c) =>
        c.query(
          `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt", "invitedById") VALUES ($1, $2, $3, now() + interval '1 day', $4)`,
          [`inv-${token}`, E2E_HOUSEHOLD.id, token, E2E_USER.id],
        ),
      ),
    );
    test.afterAll(() => withDb((c) => c.query(`DELETE FROM "Invitation" WHERE "token" = $1`, [token])));
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
    });

    async function open(page: Page) {
      await page.goto(`/join/${token}`);
      const name = page.getByLabel(j.yourName);
      await expectHydrated(name);
      const form = page.locator("form").filter({ has: name });
      return {
        form,
        name,
        email: form.getByLabel(j.email),
        password: form.getByLabel(j.password, { exact: true }),
        confirm: form.getByLabel(j.confirmPassword, { exact: true }),
        submit: form.getByRole("button", { name: j.submit }),
      };
    }

    test("the 8-character rule is under Password before any submit", async ({ page }, testInfo) => {
      const f = await open(page);
      await expect(f.form.getByText(j.passwordHint, { exact: true })).toBeVisible();
      await expect(f.password).toHaveAccessibleDescription(j.passwordHint);
      await expect(f.form.getByRole("alert")).toHaveCount(0);
      await saveScreenshot(page, testInfo, locale, { pattern: "/join/ux-194", path: `/join/${token}` });
    });

    test("a too-short password is flagged under Password and nothing is sent or wiped", async ({ page }, testInfo) => {
      const f = await open(page);
      const sent = countServerActions(page);
      await f.name.fill("Invited Person");
      await f.email.fill("ux194-invitee@squirrel.test");
      await f.password.fill("short");
      await f.confirm.fill("short");
      await f.submit.click();

      await expectErrorUnder(f.password, f.form.getByRole("alert").filter({ hasText: j.passwordTooShort }));
      await expect(f.form.getByRole("alert")).toHaveCount(1);
      await expect(f.password).toHaveValue("short");
      await expect(f.confirm).toHaveValue("short");
      await expect(f.email).toHaveValue("ux194-invitee@squirrel.test");
      expect(sent()).toBe(0);
      await saveScreenshot(page, testInfo, locale, { pattern: "/join/ux-194-error", path: `/join/${token}` });

      // Editing the field clears its message.
      await f.password.fill("long-enough-1");
      await expect(f.form.getByRole("alert")).toHaveCount(0);
    });

    test("a mismatched confirmation is flagged under Confirm password and nothing is sent or wiped", async ({ page }) => {
      const f = await open(page);
      const sent = countServerActions(page);
      await f.name.fill("Invited Person");
      await f.email.fill("ux194-invitee@squirrel.test");
      await f.password.fill("long-enough-1");
      await f.confirm.fill("long-enough-2");
      await f.submit.click();

      await expectErrorUnder(f.confirm, f.form.getByRole("alert").filter({ hasText: j.passwordsDontMatch }));
      await expect(f.form.getByRole("alert")).toHaveCount(1);
      await expect(f.password).toHaveValue("long-enough-1");
      await expect(f.confirm).toHaveValue("long-enough-2");
      expect(sent()).toBe(0);
    });

    test("a malformed email is flagged under Email and the passwords stay", async ({ page }) => {
      const f = await open(page);
      const sent = countServerActions(page);
      await f.name.fill("Invited Person");
      await f.email.fill("not-an-email");
      await f.password.fill("long-enough-1");
      await f.confirm.fill("long-enough-1");
      await f.submit.click();

      await expectErrorUnder(f.email, f.form.getByRole("alert").filter({ hasText: j.emailInvalid }));
      await expect(f.password).toHaveValue("long-enough-1");
      await expect(f.confirm).toHaveValue("long-enough-1");
      expect(sent()).toBe(0);
    });
  });

  // The reset page only renders its form for a live token, so one is
  // inserted for the worker's seeded user (and removed again). Every submit
  // here is blocked in the browser, so the user's password is never touched.
  test.describe(`reset-password checks (${locale})`, () => {
    const r = t.auth.resetPassword;
    const raw = `ux194-reset-${E2E_WORKER}-${locale}-${Date.now().toString(36)}`;

    test.beforeAll(() =>
      withDb((c) =>
        c.query(
          `INSERT INTO "PasswordResetToken" ("id", "userId", "token", "expiresAt")
           SELECT $1, "id", $2, now() + interval '1 day' FROM "User" WHERE "email" = $3`,
          [`PasswordResetToken-${raw}`, hashToken(raw), E2E_USER.email],
        ),
      ),
    );
    test.afterAll(() =>
      withDb((c) => c.query(`DELETE FROM "PasswordResetToken" WHERE "id" = $1`, [`PasswordResetToken-${raw}`])),
    );
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
    });

    async function open(page: Page) {
      await page.goto(`/reset-password/${raw}`);
      const password = page.getByLabel(r.newPassword, { exact: true });
      await expectHydrated(password);
      return {
        password,
        confirm: page.getByLabel(r.confirmPassword, { exact: true }),
        submit: page.getByRole("button", { name: r.submit }),
      };
    }

    test("a too-short password is flagged under New password and nothing is sent or wiped", async ({ page }, testInfo) => {
      const f = await open(page);
      await expect(f.password).toHaveAccessibleDescription(r.passwordHint);
      await saveScreenshot(page, testInfo, locale, { pattern: "/reset-password/ux-194", path: `/reset-password/${raw}` });
      const sent = countServerActions(page);
      await f.password.fill("short");
      await f.confirm.fill("short");
      await f.submit.click();

      const alert = page.getByRole("alert").filter({ hasText: r.passwordTooShort });
      await expectErrorUnder(f.password, alert);
      await expect(page.getByRole("alert").filter({ hasText: r.passwordsDontMatch })).toHaveCount(0);
      await expect(f.password).toHaveValue("short");
      await expect(f.confirm).toHaveValue("short");
      expect(sent()).toBe(0);
      await saveScreenshot(page, testInfo, locale, {
        pattern: "/reset-password/ux-194-error",
        path: `/reset-password/${raw}`,
      });

      // Editing the field clears its message.
      await f.password.fill("long-enough-1");
      await expect(alert).toHaveCount(0);
    });

    test("a mismatched confirmation is flagged under Confirm new password and nothing is sent or wiped", async ({ page }) => {
      const f = await open(page);
      const sent = countServerActions(page);
      await f.password.fill("long-enough-1");
      await f.confirm.fill("long-enough-2");
      await f.submit.click();

      await expectErrorUnder(f.confirm, page.getByRole("alert").filter({ hasText: r.passwordsDontMatch }));
      await expect(f.password).toHaveValue("long-enough-1");
      await expect(f.confirm).toHaveValue("long-enough-2");
      expect(sent()).toBe(0);
    });
  });
}
