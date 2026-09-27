import { expect, test as setup } from "@playwright/test";
import { E2E_USER, E2E_USER_SV, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";


// Log in once through the real form and reuse the session cookie in every
// other spec, so each test starts on an authenticated page without paying
// for a login (and without tripping the login rate limiter). The Swedish
// user gets its own session for the sv runs of smoke.spec.ts. Both log in
// through the English form: the form's language comes from the cookie,
// which a fresh context doesn't have.
for (const [user, path] of [
  [E2E_USER, STORAGE_STATE],
  [E2E_USER_SV, STORAGE_STATE_SV],
] as const) {
  setup(`log in as ${user.email}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.context().storageState({ path });
  });
}
