import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "../src/lib/i18n/dictionaries/en";
import { format } from "../src/lib/i18n/format";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_ITEM, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-189: the bell's panel (More → Notifications on a phone, the sidebar's
// bell on desktop). Each row is a link plus a ✕ that clears the alert in
// place. On a phone the ✕ was 26 px wide and 4 px from the link, so a slip
// opened the alert's page instead; and the count badge covered the bell.
const t = en.notifications;
const IDS = [`ux189-expiring-w${E2E_WORKER}`, `ux189-out-w${E2E_WORKER}`];
const EXPIRING = format(t.expiringSoon, { name: E2E_ITEM.name });

async function sql(text: string, values: unknown[]) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  // Exactly two unread alerts: other specs can leave their own in this
  // worker's household, and the count is asserted below.
  await sql(`DELETE FROM "Notification" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  await sql(
    `INSERT INTO "Notification" (id, "householdId", kind, "inventoryItemId")
     VALUES ($1, $3, 'EXPIRING_SOON', $4), ($2, $3, 'OUT_OF_STOCK', $4)`,
    [...IDS, E2E_HOUSEHOLD.id, E2E_ITEM.id],
  );
});

test.afterEach(async () => {
  // An unread row puts a count on the nav ("1 More"), which would break
  // specs that look the nav up by its label.
  await sql(`DELETE FROM "Notification" WHERE id = ANY($1) AND "householdId" = $2`, [IDS, E2E_HOUSEHOLD.id]);
});

// Opens the bell's panel and returns the control that opened it.
async function openBell(page: Page, isMobile: boolean) {
  await page.goto("/dashboard/inventory");
  if (!isMobile) {
    const bell = page.getByRole("complementary").getByRole("button", { name: new RegExp(t.title) });
    await expectHydrated(bell);
    await bell.click();
    return bell;
  }
  const more = page.getByRole("navigation").getByRole("button", { name: new RegExp(`${en.nav.more}$`) });
  await expectHydrated(more);
  await more.click();
  const trigger = page.getByRole("menuitem", { name: new RegExp(`^${t.title}`) });
  await trigger.click();
  return trigger;
}

test("the bell's Dismiss clears an alert in place, with a phone-sized target", async ({ page, isMobile }) => {
  const opener = await openBell(page, isMobile);
  const dismiss = page.getByRole("menuitem", { name: t.dismiss, exact: true });
  await expect(dismiss).toHaveCount(2);
  await expect(opener).toContainText("2");

  // DESIGN.md M3 is the phone rule; the sidebar's mouse-sized rows are
  // denser on purpose, so only the phone layout is measured.
  if (isMobile) {
    for (const button of await dismiss.all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      const link = (await button.locator("xpath=..").getByRole("menuitem").first().boundingBox())!;
      expect(box.x - (link.x + link.width)).toBeGreaterThanOrEqual(7.5);
      // The label still has most of the row.
      expect(link.width).toBeGreaterThan(box.width * 3);
    }

    // The count sits clear of the bell instead of on top of it.
    const bell = (await opener.locator("svg").first().boundingBox())!;
    const badge = (await opener.getByText("2", { exact: true }).boundingBox())!;
    expect(bell.width).toBeGreaterThanOrEqual(16);
    const overlaps =
      badge.x < bell.x + bell.width &&
      bell.x < badge.x + badge.width &&
      badge.y < bell.y + bell.height &&
      bell.y < badge.y + badge.height;
    expect(overlaps).toBe(false);
  }

  // Both rows were inserted together, so find the expiring one by its label
  // rather than by position.
  const row = page.getByRole("menuitem", { name: EXPIRING }).locator("xpath=..");
  await row.getByRole("menuitem", { name: t.dismiss, exact: true }).click();

  await expect(page.getByRole("menuitem", { name: EXPIRING })).toHaveCount(0);
  // The panel stayed open with the other alert, and nothing navigated.
  await expect(dismiss).toHaveCount(1);
  await expect(opener).toContainText("1");
  await expect(page).toHaveURL(/\/dashboard\/inventory$/);
});
