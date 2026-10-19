import { expect, test } from "@playwright/test";
import { E2E_ITEM } from "./seed-data";
import { collectErrors, dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-141: below `lg` (1024 px) the inventory is the card list phones get,
// not the six-column table, which left the name column about three
// characters wide on a tablet with the sidebar open ("Crè…") and pushed
// Last updated off the right edge. From `lg` the table is back.
const LG = 1024;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the inventory shows the card list, with item names not truncated, below lg", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= LG, "the table is the layout from lg up");
  const errors = collectErrors(page);
  await page.goto("/dashboard/inventory");
  await expect(page.getByRole("table")).toHaveCount(0);
  const name = page
    .locator("main")
    .getByRole("list")
    .getByText(E2E_ITEM.name, { exact: true })
    .filter({ visible: true })
    .first();
  await expect(name).toBeVisible();
  // The name's line (`<p class="truncate">`) shows it all: no ellipsis.
  const truncated = await name.evaluate((el) => {
    const line = el.closest("p") ?? el;
    return line.scrollWidth > line.clientWidth + 1;
  });
  expect(truncated, "item name is cut off with an ellipsis").toBe(false);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("the inventory is a table from lg up", async ({ page }) => {
  test.skip(page.viewportSize()!.width < LG, "the card list is the layout below lg");
  await page.goto("/dashboard/inventory");
  await expect(page.getByRole("table").filter({ visible: true })).toHaveCount(1);
});
