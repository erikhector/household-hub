import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_USER } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-59: signup and login errors appear next to the field they're about,
// in the page's language, and keep what was typed.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.use({ storageState: { cookies: [], origins: [] } });

const t = en.auth.signup;

test("signup shows the password minimum before submitting", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText(t.passwordHint)).toBeVisible();
  await expect(page.getByLabel(t.password, { exact: true })).toHaveAccessibleDescription(t.passwordHint);
});

test("a password mismatch keeps the first password and flags Confirm password", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(t.yourName).fill("Mismatch Mia");
  await page.getByLabel(t.householdName).fill("Mismatch House");
  await page.getByLabel(t.email).fill("mismatch@squirrel.test");
  await page.getByLabel(t.password, { exact: true }).fill("a-long-password");
  await page.getByLabel(t.confirmPassword).fill("another-password");
  await page.getByRole("button", { name: t.submit }).click();

  const confirm = page.getByLabel(t.confirmPassword);
  await expect(confirm).toBeFocused();
  await expect(confirm).toHaveAttribute("aria-invalid", "true");
  await expect(confirm).toHaveAccessibleDescription(t.passwordMismatch);
  await expect(page.getByText(t.passwordMismatch)).toBeVisible();
  await expect(page.getByLabel(t.password, { exact: true })).toHaveValue("a-long-password");
  await expect(page.getByLabel(t.yourName)).toHaveValue("Mismatch Mia");
  await expectNoHorizontalOverflow(page);

  // Editing the field clears its error.
  await confirm.fill("a-long-password");
  await expect(page.getByText(t.passwordMismatch)).toBeHidden();
});

test("a short password and a bad email get our own message under the field", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(t.yourName).fill("Short Sam");
  await page.getByLabel(t.householdName).fill("Short House");
  await page.getByLabel(t.email).fill("not-an-email");
  await page.getByLabel(t.password, { exact: true }).fill("short");
  await page.getByLabel(t.confirmPassword).fill("short");
  await page.getByRole("button", { name: t.submit }).click();

  await expect(page.getByLabel(t.email)).toBeFocused();
  await expect(page.getByText(t.emailInvalid)).toBeVisible();

  await page.getByLabel(t.email).fill("short@squirrel.test");
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByLabel(t.password, { exact: true })).toBeFocused();
  await expect(page.getByText(t.passwordTooShort)).toBeVisible();
});

test("an email that's taken links to Log in and Forgot password", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(t.yourName).fill("Taken Tess");
  await page.getByLabel(t.householdName).fill("Taken House");
  await page.getByLabel(t.email).fill(E2E_USER.email);
  await page.getByLabel(t.password, { exact: true }).fill("a-long-password");
  await page.getByLabel(t.confirmPassword).fill("a-long-password");
  await page.getByRole("button", { name: t.submit }).click();

  const email = page.getByLabel(t.email);
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toBeFocused();
  await expect(page.locator("#email-error").getByRole("link", { name: t.emailTakenLogIn })).toBeVisible();
  await expect(page.locator("#email-error").getByRole("link", { name: t.emailTakenForgot })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});

test("a failed login shows the error under the password and focuses it", async ({ page }) => {
  const l = en.auth.login;
  await page.goto("/login");
  await page.getByLabel(l.email).fill(`nobody-${Date.now()}@squirrel.test`);
  await page.getByLabel(l.password, { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: l.submit }).click();

  const password = page.getByLabel(l.password, { exact: true });
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toBeFocused();
  await expect(password).toHaveAccessibleDescription("Invalid email or password");
});
