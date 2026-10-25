import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { withCurrentWeekMeal } from "./current-week-meal";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { expectHydrated } from "./ui";
import { syncTonightsDinnerNudge } from "@/lib/notifications";

// GAP-57: the opt-in morning "what's on the menu" nudge. The user turns it
// on from the Notifications section of the profile (default off), the
// scheduled sync then files one household entry for a day that has an
// uncooked planned meal, and it shows up in the notification centre. The
// sync is called directly rather than through /api/cron/sync-notifications:
// that route walks every household in the database, which would raise
// unrelated alerts in other workers' households mid-test.
test("turning on the morning menu reminder files an entry for a planned day", async ({ page }) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const reset = async () => {
    await client.query(`DELETE FROM "Notification" WHERE "householdId" = $1 AND kind = 'TONIGHTS_DINNER'`, [
      E2E_HOUSEHOLD.id,
    ]);
    await client.query(`UPDATE "User" SET "tonightsDinnerNudge" = false WHERE email = $1`, [E2E_USER.email]);
  };

  try {
    await reset();

    await withCurrentWeekMeal("nudge", async () => {
      // Off by default: even with a meal planned today, nothing is filed.
      await syncTonightsDinnerNudge(E2E_HOUSEHOLD.id);
      const before = await client.query(
        `SELECT 1 FROM "Notification" WHERE "householdId" = $1 AND kind = 'TONIGHTS_DINNER'`,
        [E2E_HOUSEHOLD.id],
      );
      expect(before.rowCount).toBe(0);

      await page.goto("/dashboard/profile");
      const toggle = page.getByRole("checkbox", { name: "Remind me each morning what's on the menu" });
      await expectHydrated(toggle);
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect(page.getByText("You'll get a morning menu reminder").first()).toBeVisible();

      await page.reload();
      await expect(page.getByRole("checkbox", { name: "Remind me each morning what's on the menu" })).toBeChecked();

      await syncTonightsDinnerNudge(E2E_HOUSEHOLD.id);
      // A second run the same day adds nothing.
      await syncTonightsDinnerNudge(E2E_HOUSEHOLD.id);

      await page.goto("/dashboard/notifications");
      const entry = page.getByRole("main").getByText(/On the menu today:.*Planned for today/);
      await expect(entry).toHaveCount(1);
    });
  } finally {
    await reset();
    await client.end();
  }
});
