import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_USER } from "./seed";
import { dismissCookieNotice } from "./ui";

// UX-13: React 19 resets an uncontrolled form once its action settles, even
// when the action came back with an error. The forms remember what was
// submitted (src/components/shared/use-kept-form-values.ts) so the user
// only has to fix the field that was wrong — passwords still clear.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("signup with an email that's taken keeps the name, household and email", async ({ page }) => {
  const t = en.auth.signup;
  await page.goto("/signup");
  await page.getByLabel(t.yourName).fill("Kept Name");
  await page.getByLabel(t.householdName).fill("Kept Household");
  // The seeded user, so signupAction answers "already exists".
  await page.getByLabel(t.email).fill(E2E_USER.email);
  await page.getByLabel(t.password, { exact: true }).fill("a-long-password");
  await page.getByLabel(t.confirmPassword).fill("a-long-password");
  await page.getByRole("button", { name: t.submit }).click();

  await expect(page.getByText("An account with that email already exists")).toBeVisible();
  await expect(page.getByLabel(t.yourName)).toHaveValue("Kept Name");
  await expect(page.getByLabel(t.householdName)).toHaveValue("Kept Household");
  await expect(page.getByLabel(t.email)).toHaveValue(E2E_USER.email);
  await expect(page.getByLabel(t.password, { exact: true })).toHaveValue("");
});

test("a failed login keeps the email", async ({ page }) => {
  const t = en.auth.login;
  // Not a real account, so this never counts against the seeded user's
  // login throttle that the other specs sign in with.
  const email = `nobody-${Date.now()}@squirrel.test`;
  await page.goto("/login");
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: t.submit }).click();

  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page.getByLabel(t.email)).toHaveValue(email);
});
