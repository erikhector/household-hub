import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

// UX-58: the landing page shows the product and claims only what's true.
// public.spec.ts already renders it in both languages; these assert the
// item's acceptance lines.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the landing page leads with a phone-framed shopping list", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByRole("img", { name: /shopping list in Squirrel on a phone/ });
  // Above the fold at either size: on a phone it's under the buttons, so a
  // good share of it (the mascot, the list name and the first rows) shows
  // before any scrolling.
  await expect(preview).toBeInViewport({ ratio: 0.4 });
  await expectNoHorizontalOverflow(page);
});

test("the landing page names every part of the app and no example data", async ({ page }) => {
  await page.goto("/");
  for (const title of [
    "Pantry that watches itself",
    "Shopping lists that build themselves",
    "Meals, planned not panicked",
    "Chores that come back round",
    "Scan instead of typing",
    "Budgets without the spreadsheet",
  ]) {
    await expect(page.getByRole("main").getByText(title, { exact: true })).toBeVisible();
  }
  // A new household starts empty (UX-136), so the page mustn't say otherwise.
  await expect(page.getByText(/example data/i)).toHaveCount(0);
  await expect(page.getByText(/less than a minute/i)).toHaveCount(0);
});

test("the feature grid has no empty cell at 1280 px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const grid = page
    .getByRole("main")
    .getByText("Pantry that watches itself", { exact: true })
    .locator("xpath=ancestor::section[1]");
  const { cells, columns } = await grid.evaluate((el) => ({
    cells: el.children.length,
    columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
  }));
  expect(columns).toBe(3);
  expect(cells % columns).toBe(0);
});

test("the phone preview follows the Swedish locale", async ({ page, context, baseURL }) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await page.goto("/");
  await expect(page.getByRole("img", { name: /inköpslista i Squirrel på en mobil/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
