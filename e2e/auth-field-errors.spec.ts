import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_USER } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-59: signup and login mistakes show next to the field, in the page's
// language, and keep what was typed.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("signup", () => {
  const t = en.auth.signup;

  test("shows the 8-character minimum before anything is submitted", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByText(t.passwordHint)).toBeVisible();
    await expect(page.getByLabel(t.password, { exact: true })).toHaveAccessibleDescription(t.passwordHint);
  });

  test("a mismatch keeps the first password and flags Confirm password", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(t.yourName).fill("Mismatch Person");
    await page.getByLabel(t.householdName).fill("Mismatch House");
    await page.getByLabel(t.email).fill(`mismatch-${Date.now()}@squirrel.test`);
    await page.getByLabel(t.password, { exact: true }).fill("a-long-password");
    await page.getByLabel(t.confirmPassword).fill("another-password");
    await page.getByRole("button", { name: t.submit }).click();

    const confirm = page.getByLabel(t.confirmPassword);
    await expect(page.getByText(t.passwordsDontMatch)).toBeVisible();
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAttribute("aria-invalid", "true");
    await expect(confirm).toHaveAccessibleDescription(t.passwordsDontMatch);
    await expect(page.getByLabel(t.password, { exact: true })).toHaveValue("a-long-password");
    await expect(page.getByLabel(t.yourName)).toHaveValue("Mismatch Person");
    await expectNoHorizontalOverflow(page);
  });

  test("a short password and a bad email are worded on the page", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(t.yourName).fill("Short Person");
    await page.getByLabel(t.householdName).fill("Short House");
    await page.getByLabel(t.email).fill("not-an-email");
    await page.getByLabel(t.password, { exact: true }).fill("short");
    await page.getByLabel(t.confirmPassword).fill("short");
    await page.getByRole("button", { name: t.submit }).click();

    await expect(page.getByText(t.emailInvalid)).toBeVisible();
    await expect(page.getByText(t.passwordTooShort)).toBeVisible();
    await expect(page.getByLabel(t.email)).toBeFocused();
    await expect(page.getByLabel(t.email)).toHaveAttribute("aria-invalid", "true");
  });

  test("a taken email links to Log in and Forgot password", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(t.yourName).fill("Taken Person");
    await page.getByLabel(t.householdName).fill("Taken House");
    await page.getByLabel(t.email).fill(E2E_USER.email);
    await page.getByLabel(t.password, { exact: true }).fill("a-long-password");
    await page.getByLabel(t.confirmPassword).fill("a-long-password");
    await page.getByRole("button", { name: t.submit }).click();

    await expect(page.getByText(t.emailTaken)).toBeVisible();
    await expect(page.getByLabel(t.email)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("link", { name: t.emailTakenLogIn, exact: true }).first()).toHaveAttribute(
      "href",
      /^\/login\?email=/,
    );
    await expect(page.getByRole("link", { name: t.emailTakenForgot })).toHaveAttribute("href", "/forgot-password");
  });
});

test.describe("login", () => {
  const t = en.auth.login;

  test("a wrong password is flagged on the password field, with the email kept", async ({ page }) => {
    const email = `nobody-${Date.now()}@squirrel.test`;
    await page.goto("/login");
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: t.submit }).click();

    const password = page.getByLabel(t.password, { exact: true });
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAccessibleDescription("Invalid email or password");
    await expect(password).toBeFocused();
    await expect(page.getByLabel(t.email)).toHaveValue(email);
  });

  test("a bad email is worded on the page, not in a browser bubble", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(t.email).fill("not-an-email");
    await page.getByLabel(t.password, { exact: true }).fill("whatever-password");
    await page.getByRole("button", { name: t.submit }).click();

    await expect(page.getByText(t.emailInvalid)).toBeVisible();
    await expect(page.getByLabel(t.email)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(t.password, { exact: true })).toHaveValue("whatever-password");
  });
});
