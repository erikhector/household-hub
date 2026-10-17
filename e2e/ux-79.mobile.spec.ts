import { expect, test } from "@playwright/test";
import { cleanUp, seedList, tag } from "./ux-79-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-79 (phone only: from sm the row is a sidebar-layout row with its
// icons): an unticked row on an active list is one 56-64 px line, so a
// 15-item list shows at least six whole rows above the Next up dock
// instead of two or three.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(cleanUp);

test("an active 15-item list shows six whole rows above the dock, each 56-64 px", async ({ page }) => {
  const { path, names } = await seedList(tag(), 15);
  await page.goto(path);

  const rowOf = (name: string) =>
    page.getByRole("checkbox", { name: new RegExp(`^${name}`) }).locator("xpath=ancestor::*[@data-swipe-row][1]");

  // Scrolled the way a shopper is mid-shop: the first row just under the
  // sticky add bar. (On first load the page title and actions sit above the
  // list, which this item doesn't touch.)
  const main = page.getByRole("main");
  await main.evaluate((el) => el.scrollTo(0, 200));
  await page.waitForTimeout(200);
  const field = (await page.getByRole("combobox", { name: "Add to the list" }).boundingBox())!;
  const first = (await rowOf(names[0]).boundingBox())!;
  await main.evaluate((main, by) => main.scrollBy(0, by), first.y - (field.y + field.height + 16));
  await page.waitForTimeout(300);

  const dock = (await page.getByRole("region", { name: "Next up" }).boundingBox())!;
  const rows = [];
  for (const name of names.slice(0, 6)) rows.push((await rowOf(name).boundingBox())!);
  for (const box of rows) {
    expect(box.height, "a row without a note").toBeGreaterThanOrEqual(56);
    expect(box.height, "a row without a note").toBeLessThanOrEqual(64);
  }
  expect(rows[5].y + rows[5].height, "sixth row clear of the dock").toBeLessThanOrEqual(dock.y);
  await expectNoHorizontalOverflow(page);
});
