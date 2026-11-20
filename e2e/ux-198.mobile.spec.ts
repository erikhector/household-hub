import { expect, test, type Locator, type Page } from "@playwright/test";
import { withDb } from "./db";
import { format, plural } from "../src/lib/i18n/format";
import { sv } from "../src/lib/i18n/dictionaries/sv";
import { E2E_HOUSEHOLD, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// UX-198: on a 320 px phone the bulk-edit bar's second row squeezed the
// value input to 41 px between the field select and Apply ("t.e…"), and
// the Swedish count was cut to "2 varor ma…". Now that row wraps so the
// input keeps 128 px, and the count wraps instead of truncating. At 412 px
// it all still fits in two rows (in Chromium), and however many rows it
// takes, <main> reserves the bar's measured height. Rows are written straight to Postgres, in
// Swedish because that's the longer count. The signed-in locale comes from
// the account, hence the Swedish seeded user (same household).
const t = sv.inventory.bulkActions;
const tag = `t${Math.random().toString(36).slice(2, 10)}`;
// Enough rows that the list scrolls under the bar at 320 x 640.
const COUNT = 12;
const name = (i: number) => `Bulk198 ${tag} ${String(i).padStart(2, "0")}`;
const idPrefix = `e2e-ux198-w${E2E_WORKER}-${tag}`;

test.use({ storageState: STORAGE_STATE_SV });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await withDb(async (client) => {
    for (let i = 0; i < COUNT; i++) {
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
         VALUES ($1, $2, $3, 'Skafferi', 3, 'st', 1, now())`,
        [`${idPrefix}-${i}`, E2E_HOUSEHOLD.id, name(i)],
      );
    }
  });
});

test.afterEach(async () => {
  await withDb(async (client) => {
    await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `${idPrefix}-%`,
    ]);
  });
});

async function selectTwo(page: Page) {
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await expectHydrated(search);
  await search.fill(tag);
  for (const i of [0, 1]) {
    const box = page.getByRole("checkbox", { name: format(t.selectItemAriaLabel, { name: name(i) }) }).filter({ visible: true });
    await expectHydrated(box);
    await box.check();
  }
  const bar = page.locator("[data-bulk-bar]");
  await expect(bar.getByText(format(plural(2, t.selectedCount), { count: 2 }))).toBeVisible();
  return bar;
}

// Apply has dropped below the field select: the bar is three rows.
async function expectThreeRows(bar: Locator) {
  await expect(async () => {
    const field = (await bar.getByRole("combobox", { name: t.fieldAriaLabel }).boundingBox())!;
    const apply = (await bar.getByRole("button", { name: t.apply, exact: true }).boundingBox())!;
    expect(apply.y).toBeGreaterThanOrEqual(field.y + field.height);
  }).toPass();
}

// Scrolled to the very end, the last row clears the bar: <main> reserves
// the bar's measured height (`--bulk-bar-h`), however many rows it has.
// Retried, since the ResizeObserver publishes after a re-wrap.
async function expectLastRowClears(page: Page, bar: Locator) {
  const last = page.getByRole("checkbox", { name: tag }).filter({ visible: true }).last();
  await expect(async () => {
    await page.locator("main").evaluate((main) => main.scrollTo(0, main.scrollHeight));
    await expect(last).toBeInViewport();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual((await bar.boundingBox())!.y);
  }).toPass();
}

test("at 320 px the bulk bar keeps the value field readable and the count whole", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const bar = await selectTwo(page);

  const value = bar.getByRole("combobox", { name: t.valueAriaLabel });
  expect((await value.boundingBox())!.width).toBeGreaterThanOrEqual(128);

  const count = bar.getByText(format(plural(2, t.selectedCount), { count: 2 }));
  const { scrollWidth, clientWidth } = await count.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  await expectTouchTargets(page);
  await expectNoHorizontalOverflow(page);

  // The bar is three rows here, and <main> reserves all three.
  await expectThreeRows(bar);
  await expectLastRowClears(page, bar);
});

test("at 412 px the bulk bar is still two rows", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  const bar = await selectTwo(page);

  // Two rows: the field select, the value field and Apply share a line,
  // and that line sits right under the count's.
  const field = (await bar.getByRole("combobox", { name: t.fieldAriaLabel }).boundingBox())!;
  const apply = (await bar.getByRole("button", { name: t.apply, exact: true }).boundingBox())!;
  const clear = (await bar.getByRole("button", { name: t.clearSelection }).boundingBox())!;
  expect(Math.abs(apply.y - field.y)).toBeLessThanOrEqual(1);
  expect(field.y).toBeGreaterThan(clear.y);
  expect(field.y).toBeLessThan(clear.y + clear.height + 16);
  await expectLastRowClears(page, bar);
});

// The margin at 412 px is thin, and a wider font (SF Pro on an iPhone, a
// bigger text size) can wrap the field row there too. Widening Apply's
// label stands in for that: the bar goes to three rows at 412 px, and
// <main> follows it instead of keeping a two-row reserve.
test("at 412 px a field row that wraps still leaves the last row clear", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  const bar = await selectTwo(page);
  await page.addStyleTag({ content: "[data-bulk-bar] > div:last-child > button { letter-spacing: 0.6em; }" });
  await expectThreeRows(bar);
  await expectNoHorizontalOverflow(page);
  await expectLastRowClears(page, bar);
});
