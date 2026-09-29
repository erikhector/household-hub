import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";

// UX-3: a household with no notifications yet must be told what would
// produce one, so the empty page doesn't look broken. Other specs in the
// shared household can raise real notifications (an item running out), so
// clear them first. The suite runs with a single worker, so nothing races
// this delete.
test("empty notification history names what generates a notification", async ({ page }) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Notification" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  } finally {
    await client.end();
  }

  await page.goto("/dashboard/notifications");
  await expect(page.getByText("No notifications yet.")).toBeVisible();
  await expect(page.getByText(/runs out of stock or is about to expire/)).toBeVisible();
});
