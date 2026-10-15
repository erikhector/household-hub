import { expect, test, type Locator } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// Phone pass (Oct 2026), P6: the budget's first phone screen goes to the
// budget, not to chrome (no subtitle under the title), and the floating
// "Add transaction" never sits over the end of the list once it's
// scrolled to the bottom. Phone only by its file name.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function overlaps(a: Locator, b: Locator) {
  const [x, y] = [(await a.boundingBox())!, (await b.boundingBox())!];
  return !(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y);
}

for (const [path, subtitle] of [
  ["/dashboard/budget", "Track household income and expenses, one-time or recurring."],
  ["/dashboard/personal-budget", "Your own income and expenses — separate from any household you're part of."],
] as const) {
  test(`${path}: no subtitle, and the tabs sit high on the first screen`, async ({ page }) => {
    await page.goto(path);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(main.getByText(subtitle)).toBeHidden();
    // A tab, not the tablist: the list is `display: contents` (no box).
    const tabs = main.getByRole("tab", { name: "Overview" });
    await expect(tabs).toBeVisible();
    const viewport = page.viewportSize()!;
    expect((await tabs.boundingBox())!.y).toBeLessThan(viewport.height * 0.4);
    await expectNoHorizontalOverflow(page);
  });
}

test("the floating Add transaction clears the end of a long list", async ({ page }) => {
  const tag = budgetTag();
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-chrome-cat-${tag}`, name: `Misc ${tag}` });
    for (let i = 0; i < 15; i++) {
      await insertHouseholdTransaction(client, {
        id: `e2e-chrome-tx-${i}-${tag}`,
        categoryId: `e2e-chrome-cat-${tag}`,
        amount: 10 + i,
        description: `Row ${i} ${tag}`,
      });
    }
  });
  await page.goto("/dashboard/budget?tab=transactions");
  const main = page.getByRole("main");
  const add = page.getByRole("button", { name: "Add transaction" }).first();
  await expect(add).toBeVisible();
  await expect(main.getByRole("button", { name: `Row 0 ${tag}` })).toBeVisible();

  await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const exportLink = main.getByRole("button", { name: "Export CSV" });
  await expect(exportLink).toBeInViewport();
  expect(await overlaps(add, exportLink), "Add transaction covers Export CSV").toBe(false);
  // The list's last row (structural: the last swipeable row on the tab).
  const lastRow = main.locator("[data-swipe-row]").last();
  await expect(lastRow).toBeInViewport();
  expect(await overlaps(add, lastRow), "Add transaction covers the last row").toBe(false);
});
