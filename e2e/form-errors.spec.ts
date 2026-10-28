import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_USER } from "./seed";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-13: React 19 resets an uncontrolled form once its action settles, even
// when the action came back with an error. The forms remember what was
// submitted (src/components/shared/use-kept-form-values.ts) so the user
// only has to fix the field that was wrong — passwords still clear.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.describe("logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

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
});

// The other side of keeping values: after a *successful* "Save & add
// another", only quantity and threshold carry into the next item. The
// previous item's expiry and use-within must not (a carried-over date
// would also stop AUTO-7 estimating the next item's expiry).
test("save & add another keeps quantity and threshold but clears expiry and use-within", async ({ page }) => {
  const t = en.inventory;
  await page.goto("/dashboard/inventory");
  // The dialog's chunk loads on first use (PERF-26): wait for the button to be
  // hydrated, or the click lands on server HTML and does nothing.
  const add = page.getByRole("button", { name: t.addItem }).first();
  await expectHydrated(add);
  await add.click();
  const dialog = page.getByRole("dialog", { name: t.addDialogTitle });

  await dialog.getByLabel(t.nameLabel, { exact: true }).fill(`Kept values ${Date.now().toString(36)}`);
  await dialog.getByLabel(t.quantityLabel).fill("3");
  await dialog.getByLabel(t.runningLowBelowLabel).fill("5");
  await dialog.getByLabel(t.expiresAtLabel).fill("2030-01-15");
  await dialog.getByLabel(t.useWithinDaysOpenedLabel).fill("5");
  await dialog.getByRole("button", { name: t.saveAndAddAnother }).click();

  await expect(dialog.getByText("1 item added this session")).toBeVisible();
  await expect(dialog.getByLabel(t.nameLabel, { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel(t.quantityLabel)).toHaveValue("3");
  await expect(dialog.getByLabel(t.runningLowBelowLabel)).toHaveValue("5");
  await expect(dialog.getByLabel(t.expiresAtLabel)).toHaveValue("");
  await expect(dialog.getByLabel(t.useWithinDaysOpenedLabel)).toHaveValue("");
});
