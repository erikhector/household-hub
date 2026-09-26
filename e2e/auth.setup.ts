import { expect, test as setup } from "@playwright/test";
import { E2E_USER, STORAGE_STATE } from "./seed";


// Log in once through the real form and reuse the session cookie in every
// other spec, so each test starts on an authenticated page without paying
// for a login (and without tripping the login rate limiter).
setup("log in as the seeded user", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_USER.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.context().storageState({ path: STORAGE_STATE });
});
