import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-130: a row with an expiry date has a fourth icon (Freeze), and the table
// used to grow wider than its column so "Delete item" sat off screen at
// 1280 px. The row below has everything that widens the table: a long name,
// category and location, an expiry badge and an opened-pack window (Mark as
// opened), so every icon shows.
const id = `e2e-ux130-${E2E_WORKER}`;
const name = `Wide row ${E2E_WORKER}${Math.random().toString(36).slice(2, 7)} with a really long item name`;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  await withClient((client) =>
    client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, location, quantity, unit, "expiresAt", "useWithinDaysOpened", "updatedAt")
       VALUES ($1, $2, $3, 'Dairy and refrigerated goods', 'Refrigerator, top shelf', 3, 'pcs', now() + interval '5 days', 3, now() - interval '3 days')`,
      [id, E2E_HOUSEHOLD.id, name],
    ),
  );
});

// Only this household's row: a cleanup by id alone could hit another worker's.
test.afterAll(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, id]),
  );
});

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("every row action is on screen in the desktop table at 1280 px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/inventory");
  await page.getByPlaceholder("Search by name…").filter({ visible: true }).fill(name);
  const row = page.getByRole("main").getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();

  const deleteButton = row.getByRole("button", { name: "Delete item" });
  await expect(row.getByRole("button", { name: `Freeze ${name}` })).toBeVisible();
  await expect(deleteButton).toBeVisible();

  const box = await deleteButton.boundingBox();
  expect(box!.x + box!.width, "Delete item ends inside the viewport").toBeLessThanOrEqual(1280);

  // The table's own scroller (the wrapper with overflow-x-auto) has nothing
  // to scroll, and neither does the page.
  const sizes = await row.evaluate((tr) => {
    const wrapper = tr.closest("table")!.parentElement!;
    return { scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth };
  });
  expect(sizes.scrollWidth, "table wider than its column").toBeLessThanOrEqual(sizes.clientWidth);
  await expectNoHorizontalOverflow(page);
});
