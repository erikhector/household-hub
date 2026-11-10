import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { hashToken } from "@/lib/token-hash";
import { E2E_USER, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, setLocaleCookie } from "./ui";

// UX-183b: the profile forms (display name, email, password) and the
// forgot / reset password forms word a missing field under it, in the page's
// language (role="alert"), instead of the browser's own bubble. Focus moves to
// the first empty field, it gets aria-invalid, the message clears as the field
// is edited, and what was typed elsewhere stays.
const DICTS = { en, sv } as const;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

for (const locale of ["en", "sv"] as const) {
  const t = DICTS[locale];

  test.describe(`profile form field errors (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });

    test("an empty display name is flagged under the field", async ({ page }) => {
      await page.goto("/dashboard/profile");
      const name = page.getByLabel(t.profile.displayNameForm.label);
      await expectHydrated(name);
      await name.fill("   ");
      await page.getByRole("button", { name: t.profile.displayNameForm.save, exact: true }).click();

      const alert = page.getByRole("alert").filter({ hasText: t.profile.displayNameForm.nameRequired });
      await expect(alert).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();

      await name.fill("A name");
      await expect(alert).toHaveCount(0);
    });

    test("an empty new email and password are flagged, keeping what was typed", async ({ page }) => {
      await page.goto("/dashboard/profile");
      const newEmail = page.getByLabel(t.profile.emailForm.newEmailLabel);
      await expectHydrated(newEmail);
      const form = page.locator("form").filter({ has: newEmail });

      await form.getByRole("button", { name: t.profile.emailForm.save, exact: true }).click();
      await expect(form.getByRole("alert").filter({ hasText: t.profile.emailForm.newEmailRequired })).toBeVisible();
      await expect(form.getByRole("alert").filter({ hasText: t.profile.emailForm.currentPasswordRequired })).toBeVisible();
      await expect(newEmail).toHaveAttribute("aria-invalid", "true");
      await expect(newEmail).toBeFocused();

      await newEmail.fill("kept@squirrel.test");
      await expect(form.getByRole("alert").filter({ hasText: t.profile.emailForm.newEmailRequired })).toHaveCount(0);
      await form.getByRole("button", { name: t.profile.emailForm.save, exact: true }).click();
      const password = form.getByLabel(t.profile.emailForm.currentPasswordLabel);
      await expect(password).toBeFocused();
      await expect(password).toHaveAttribute("aria-invalid", "true");
      await expect(newEmail).toHaveValue("kept@squirrel.test");
    });

    test("an empty current, new and confirmed password are flagged", async ({ page }) => {
      await page.goto("/dashboard/profile");
      const newPassword = page.getByLabel(t.profile.passwordForm.newPasswordLabel, { exact: true });
      await expectHydrated(newPassword);
      const form = page.locator("form").filter({ has: newPassword });
      const current = form.getByLabel(t.profile.passwordForm.currentPasswordLabel);

      await form.getByRole("button", { name: t.profile.passwordForm.save, exact: true }).click();
      await expect(form.getByRole("alert").filter({ hasText: t.profile.passwordForm.currentPasswordRequired })).toBeVisible();
      await expect(form.getByRole("alert").filter({ hasText: t.profile.passwordForm.newPasswordRequired })).toBeVisible();
      await expect(form.getByRole("alert").filter({ hasText: t.profile.passwordForm.confirmPasswordRequired })).toBeVisible();
      await expect(current).toHaveAttribute("aria-invalid", "true");
      await expect(current).toBeFocused();

      await current.fill("something-typed");
      await expect(form.getByRole("alert").filter({ hasText: t.profile.passwordForm.currentPasswordRequired })).toHaveCount(0);
      await expect(form.getByRole("alert").filter({ hasText: t.profile.passwordForm.newPasswordRequired })).toBeVisible();
      await form.getByRole("button", { name: t.profile.passwordForm.save, exact: true }).click();
      await expect(newPassword).toBeFocused();
      await expect(current).toHaveValue("something-typed");
    });
  });

  test.describe(`auth form field errors (${locale})`, () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
    });

    test("an empty email on Forgot password is flagged under the field", async ({ page }) => {
      await page.goto("/forgot-password");
      const email = page.getByLabel(t.auth.forgotPassword.email);
      await expectHydrated(email);
      await page.getByRole("button", { name: t.auth.forgotPassword.submit }).click();

      const alert = page.getByRole("alert").filter({ hasText: t.auth.forgotPassword.emailRequired });
      await expect(alert).toBeVisible();
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expect(email).toBeFocused();

      await email.fill("someone@squirrel.test");
      await expect(alert).toHaveCount(0);
    });

    // The reset page only renders its form for a live token, so one is
    // inserted for the worker's seeded user (and removed again). Nothing is
    // submitted, so the user's password is never touched.
    test("empty passwords on Reset password are flagged under their fields", async ({ page }) => {
      const raw = `fe-reset-${E2E_WORKER}-${locale}-${Date.now().toString(36)}`;
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO "PasswordResetToken" ("id", "userId", "token", "expiresAt")
           SELECT $1, "id", $2, now() + interval '1 day' FROM "User" WHERE "email" = $3`,
          [`PasswordResetToken-${raw}`, hashToken(raw), E2E_USER.email],
        );

        await page.goto(`/reset-password/${raw}`);
        const newPassword = page.getByLabel(t.auth.resetPassword.newPassword, { exact: true });
        await expectHydrated(newPassword);
        await page.getByRole("button", { name: t.auth.resetPassword.submit }).click();

        await expect(page.getByRole("alert").filter({ hasText: t.auth.resetPassword.newPasswordRequired })).toBeVisible();
        await expect(page.getByRole("alert").filter({ hasText: t.auth.resetPassword.confirmPasswordRequired })).toBeVisible();
        await expect(newPassword).toHaveAttribute("aria-invalid", "true");
        await expect(newPassword).toBeFocused();

        await newPassword.fill("a-new-password-1");
        await expect(page.getByRole("alert").filter({ hasText: t.auth.resetPassword.newPasswordRequired })).toHaveCount(0);
        await expect(page.getByLabel(t.auth.resetPassword.confirmPassword)).toHaveAttribute("aria-invalid", "true");
        await expect(newPassword).toHaveValue("a-new-password-1");
      } finally {
        await client.query(`DELETE FROM "PasswordResetToken" WHERE "id" = $1`, [`PasswordResetToken-${raw}`]);
        await client.end();
      }
    });
  });
}
