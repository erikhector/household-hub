import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectTargetsApart, expectTouchTargets } from "./ui";

// UX-45: a phone's inventory list is a scan-and-tap list, so each item is
// two short lines (name and badges; stepper and actions) instead of a
// three-row card with a "Last updated" line. Ten items are written straight
// to Postgres under one unique prefix, so searching for it shows exactly
// these rows whatever else the worker's household holds.
const ITEM_COUNT = 10;
const prefix = `Compact ${E2E_WORKER}${Math.random().toString(36).slice(2, 7)}`;
const idPrefix = `e2e-ux45-${E2E_WORKER}-`;

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
  await withClient(async (client) => {
    for (let i = 0; i < ITEM_COUNT; i++) {
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, location, quantity, unit, "updatedAt")
         VALUES ($1, $2, $3, 'Pantry', 'Cupboard', 3, 'pcs', now() - interval '3 days')`,
        [`${idPrefix}${i}`, E2E_HOUSEHOLD.id, `${prefix} item ${String(i).padStart(2, "0")}`],
      );
    }
  });
});

// Only this household's rows: a cleanup by id prefix alone could delete
// another worker's rows mid-test.
test.afterAll(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${idPrefix}%`]),
  );
});

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Right after navigation the streamed page can briefly hold two copies of
// the list, so wait for the single visible search field before typing.
async function showTestItems(page: Page) {
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(prefix);
}

test("a phone shows at least eight items in one screen, without a Last updated line", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "the compact cards are the phone layout");
  await showTestItems(page);
  const main = page.getByRole("main");
  const rows = main.getByRole("listitem").filter({ hasText: prefix });
  await expect(rows).toHaveCount(ITEM_COUNT);

  // Scroll the list's first row to the top of `main` (the only thing that
  // scrolls on a phone) and count the rows that fit whole above the
  // bottom bar.
  await rows.first().evaluate((row) => row.scrollIntoView({ block: "start" }));
  const inView = await rows.evaluateAll((els) => {
    const main = document.querySelector("main")!.getBoundingClientRect();
    const nav = Array.from(document.querySelectorAll("nav")).find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.height > 0 && rect.bottom >= window.innerHeight - 1 && rect.top > window.innerHeight / 2;
    });
    const bottom = Math.min(main.bottom, nav ? nav.getBoundingClientRect().top : window.innerHeight);
    return els.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= main.top - 1 && rect.bottom <= bottom + 1;
    }).length;
  });
  expect(inView).toBeGreaterThanOrEqual(8);

  // The date moved to the item page; the row keeps 44 px targets 8 px apart.
  await expect(rows.first()).not.toContainText("Last updated");
  await expectTouchTargets(page);
  await expectTargetsApart(rows.first());
});

test("the row's stepper still changes the quantity, and the item page says when it was updated", async ({ page }) => {
  await showTestItems(page);
  const name = `${prefix} item 00`;
  // The step is optimistic (UX-14), so wait for the Server Action's
  // response before reloading, or the reload can race the save.
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await page.getByRole("button", { name: `Increase ${name}`, exact: true }).filter({ visible: true }).click();
  const updated = page.getByRole("main").getByText("4 pcs", { exact: true }).filter({ visible: true });
  await expect(updated).toBeVisible();
  await saved;

  // It saved: still 4 after a reload.
  await showTestItems(page);
  await expect(updated).toBeVisible();

  await page.goto(`/dashboard/inventory/items/${idPrefix}0`);
  await expect(page.getByRole("main").getByText(/^Last updated .+ by /)).toBeVisible();
});
