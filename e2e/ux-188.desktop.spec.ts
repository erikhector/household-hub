import { expect, test } from "@playwright/test";
import { STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, gotoRevealed } from "./ui";

// UX-188: at 1280 px the inventory header put its toolbar beside the title,
// which wrapped the buttons into three ragged rows with the primary "Lägg
// till vara" alone and last, and every "Senast uppdaterad" cell repeated its
// column header, leaving Kategori clipped to "Dairy & eg…". Desktop only:
// below `lg` the table is a card list and phones have their own header.
test.use({ storageState: STORAGE_STATE_SV, viewport: { width: 1280, height: 800 } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the inventory header leads with Add item and the table has room for categories", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/inventory");
  const main = page.getByRole("main");
  const addItem = main.getByRole("button", { name: "Lägg till vara", exact: true }).filter({ visible: true });
  await expect(addItem).toBeVisible();
  await expectHydrated(addItem);

  // The header's controls are the visible buttons and links above the search
  // box. "Add item" must be the first of them in the DOM (tab order) and on
  // screen (top row, leftmost).
  const search = main.getByRole("searchbox").filter({ visible: true });
  const searchTop = (await search.boundingBox())!.y;
  const controls = await main
    .getByRole("button")
    .or(main.getByRole("link"))
    .filter({ visible: true })
    .evaluateAll(
      (els, top) =>
        els
          .map((el) => ({ name: el.textContent?.trim() ?? "", box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.bottom <= top)
          .map(({ name, box }) => ({ name, x: box.x, y: box.y })),
      searchTop,
    );
  expect(controls.length).toBeGreaterThan(1);
  expect(controls[0].name).toBe("Lägg till vara");
  const visualFirst = [...controls].sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x))[0];
  expect(visualFirst.name).toBe("Lägg till vara");

  // No cell repeats the "Senast uppdaterad" column header: it shows the date.
  const table = main.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Senast uppdaterad" })).toBeVisible();
  await expect(table.getByRole("cell").filter({ hasText: "Senast uppdaterad" })).toHaveCount(0);

  // The seeded Egg row (e2e/seed.ts) is in "Dairy & eggs", which now fits.
  const eggRow = table.getByRole("row").filter({ has: page.getByRole("cell", { name: "Egg", exact: true }) });
  const category = eggRow.getByText("Dairy & eggs", { exact: true });
  await expect(category).toBeVisible();
  const { scrollWidth, clientWidth } = await category.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
