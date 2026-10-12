import { expect, test as setup } from "@playwright/test";
import { e2eWorkerData } from "./seed-data";

// Log in once through the real form and reuse the session cookie in every
// other spec, so each test starts on an authenticated page without paying
// for a login (and without tripping the login rate limiter). The Swedish
// user gets its own session for the sv runs of smoke.spec.ts. Both log in
// through the English form: the form's language comes from the cookie,
// which a fresh context doesn't have. Every worker has its own pair of
// users (e2e/seed-data.ts); the count isn't known until the config is
// resolved, so one test per language logs in all of them rather than a
// test per user.
for (const locale of ["en", "sv"] as const) {
  setup(`log in every worker's ${locale} user`, async ({ browser, baseURL }, testInfo) => {
    for (let worker = 0; worker < testInfo.config.workers; worker++) {
      const data = e2eWorkerData(worker);
      const [user, path] = locale === "en" ? [data.user, data.storageState] : [data.userSv, data.storageStateSv];
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill(user.password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await context.storageState({ path });
      await context.close();
    }
  });
}
