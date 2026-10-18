import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice } from "./ui";

// UX-123: the bulk-edit bar stays on screen, docked above the bottom bar on
// phones (the Add-item button steps aside), however far down the list the
// ticked row is, and it can select every item. Rows are written straight
// to Postgres.
const tag = `t${Math.random().toString(36).slice(2, 10)}`;
const COUNT = 25;
const name = (i: number) => `Bulk ${tag} ${String(i).padStart(2, "0")}`;

async function withClient(run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await withClient(async (client) => {
    for (let i = 0; i < COUNT; i++) {
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
         VALUES ($1, $2, $3, 'Pantry', 3, 'pcs', 1, now())`,
        [`e2e-ux123-${tag}-${i}`, E2E_HOUSEHOLD.id, name(i)],
      );
    }
  });
});

test.afterEach(async () => {
  await withClient(async (client) => {
    await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE 'e2e-ux123-%'`, [
      E2E_HOUSEHOLD.id,
    ]);
  });
});

async function openList(page: Page) {
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(tag);
}

test("ticking a row far down the list shows the bulk bar on screen", async ({ page }) => {
  await openList(page);
  const last = page.getByRole("checkbox", { name: `Select ${name(COUNT - 1)}` }).filter({ visible: true });
  await last.scrollIntoViewIfNeeded();
  await last.check();

  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeInViewport({ ratio: 1 });
  const box = (await apply.boundingBox())!;
  if (test.info().project.name === "mobile") {
    // Docked to the top of the bottom bar, full width and two rows high,
    // with the Add-item button out of the way while the selection is open.
    const nav = page.getByRole("navigation").filter({ visible: true }).last();
    const navBox = (await nav.boundingBox())!;
    const bar = page.locator("[data-bulk-bar]");
    const barBox = (await bar.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(navBox.y);
    // Within a few px: the offset is the 3.75rem the layout reserves for
    // BottomNav, which renders a px or two taller (its border), so the
    // bar's bottom padding tucks just under it.
    expect(Math.abs(barBox.y + barBox.height - navBox.y)).toBeLessThanOrEqual(4);
    expect(barBox.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    expect(barBox.height).toBeLessThanOrEqual(130);
    await expect(page.getByRole("button", { name: "Add item" }).filter({ visible: true })).toHaveCount(0);

    // Scrolled to the very end, the last row clears the bar.
    await page.locator("main").evaluate((main) => main.scrollTo(0, main.scrollHeight));
    await expect(last).toBeInViewport();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(barBox.y);
  }

  // Scrolled back to the top with the selection kept, the bar is still there.
  await page.getByRole("checkbox", { name: `Select ${name(0)}` }).filter({ visible: true }).scrollIntoViewIfNeeded();
  await expect(apply).toBeInViewport({ ratio: 1 });

  if (test.info().project.name === "mobile") {
    // Clearing the selection brings the Add-item button back.
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.locator("[data-bulk-bar]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add item" }).filter({ visible: true })).toHaveCount(1);
  }
});

test("Select all in the bulk bar ticks every item", async ({ page }) => {
  await openList(page);
  await page.getByRole("checkbox", { name: `Select ${name(0)}` }).filter({ visible: true }).check();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(page.getByText(`${COUNT} items selected`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Select all", exact: true })).toHaveCount(0);
});
