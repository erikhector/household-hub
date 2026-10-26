import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { withCurrentWeekMeal } from "./current-week-meal";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { expectHydrated } from "./ui";

// GAP-57: the opt-in morning "what's on the menu" nudge. The user turns it
// on from the Notifications section of the profile (default off), the
// scheduled sync then files one household entry for a day that has an
// uncooked planned meal, and it shows up in the notification centre. The
// sync runs through /api/cron/sync-notifications, authenticated with the
// CRON_SECRET playwright.config.ts gives the server.
const CRON_SECRET = process.env.CRON_SECRET || "e2e-cron-secret";

test("turning on the morning menu reminder files an entry for a planned day", async ({ page, request }) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const runCron = async () => {
    const response = await request.get("/api/cron/sync-notifications", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(response.status()).toBe(200);
  };
  const countNudges = async () =>
    (
      await client.query(`SELECT 1 FROM "Notification" WHERE "householdId" = $1 AND kind = 'TONIGHTS_DINNER'`, [
        E2E_HOUSEHOLD.id,
      ])
    ).rowCount;
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
      await runCron();
      expect(await countNudges()).toBe(0);

      await page.goto("/dashboard/profile");
      const label = "Remind me each morning what's on the menu";
      const toggle = page.getByRole("checkbox", { name: label });
      await expectHydrated(toggle);
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect(page.getByText("You'll get a morning menu reminder").first()).toBeVisible();

      await page.reload();
      await expect(page.getByRole("checkbox", { name: label })).toBeChecked();

      await runCron();
      // A second run the same day adds nothing.
      await runCron();
      expect(await countNudges()).toBe(1);

      await page.goto("/dashboard/notifications");
      const entry = page.getByRole("main").getByText(/On the menu today:.*Planned for today/);
      await expect(entry).toHaveCount(1);
    });
  } finally {
    await reset();
    await client.end();
  }
});
