import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { expectHydrated, gotoRevealed } from "./ui";

// UX-3, UX-191: a household with no notifications yet must be told what
// would produce one, so the empty page doesn't look broken, and the copy
// must name today's always-on triggers, not just stock and expiry. Other
// specs in this worker's household can raise real notifications (an item
// running out), so clear them first. Each worker has its own household and
// runs its specs one at a time, so nothing races this delete.
for (const [locale, dict, storageState] of [
  ["en", en, STORAGE_STATE],
  ["sv", sv, STORAGE_STATE_SV],
] as const) {
  test.describe(locale, () => {
    test.use({ storageState });

    test(`empty notification history names what generates a notification (${locale})`, async ({ page }) => {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query(`DELETE FROM "Notification" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
      } finally {
        await client.end();
      }

      await gotoRevealed(page, "/dashboard/notifications");
      // Scoped to <main>: on the phone layout the same text also turns up
      // outside it (a hidden duplicate), which trips getByText's strict mode.
      const empty = page.getByRole("main").getByText(dict.notifications.history.empty);
      await expect(empty).toBeVisible();
      // The old copy promised stock and expiry only (UX-191).
      await expect(empty).toContainText(locale === "en" ? "a price jumps" : "ett pris stiger");
    });
  });
}

// UX-191: the setting belongs where the annoyance is. The link lands on
// Profile with its Notifications section heading on screen, which on a
// phone means `main` (the only scroller) scrolled to it.
test("the notification centre links to the notification settings", async ({ page }) => {
  await page.goto("/dashboard/notifications");
  const link = page.getByRole("main").getByRole("link", { name: en.notifications.history.settingsLink });
  await expectHydrated(link);
  const box = await link.boundingBox();
  expect(box).not.toBeNull();
  if (test.info().project.name !== "desktop") expect(box!.height).toBeGreaterThanOrEqual(44);

  // Hold Profile back so the click commits its loading skeleton first, as on
  // a slow phone. Next's own hash scroll then finds no heading, and only
  // ScrollToHash brings it into view once the page streams in.
  await page.route(/\/dashboard\/profile/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await link.click();
  await expect(page).toHaveURL(/\/dashboard\/profile#profile-notifications$/);
  await expect(
    page.getByRole("heading", { level: 2, name: en.profile.sections.notifications, exact: true }),
  ).toBeInViewport();
});
