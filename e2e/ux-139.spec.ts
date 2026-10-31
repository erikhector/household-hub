import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_ITEM, E2E_SHOPPING_LIST } from "./seed-data";
import { collectErrors, dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-139: on a phone a list (and a dashboard card, which is mostly a list
// in a card) reaches out of main's 16 px gutter to 6 px from each screen
// edge, keeping its rounded corners, while the page title stays on the
// 16 px gutter. From `sm` (the landscape and tablet projects too) nothing
// changes: the surface starts where the title does.
const PHONE_MAX = 640;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function expectSurfaceEdges(page: Page, surface: Locator) {
  await expect(surface).toBeVisible();
  const title = await page.locator("main").getByRole("heading", { level: 1 }).first().boundingBox();
  const box = await surface.boundingBox();
  const width = page.viewportSize()!.width;
  expect(title && box).toBeTruthy();
  if (width < PHONE_MAX) {
    expect(Math.round(title!.x)).toBe(16);
    expect(Math.round(box!.x)).toBe(6);
    expect(Math.round(width - (box!.x + box!.width))).toBe(6);
  } else {
    expect(box!.x).toBeGreaterThanOrEqual(title!.x - 1);
  }
  await expectNoHorizontalOverflow(page);
}

test("shopping list rows reach to 6 px from the screen edges on a phone", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  // The row itself (SwipeRow's root), not the shopping-mode dock's copy.
  await expectSurfaceEdges(page, page.locator("main [data-swipe-row]").filter({ hasText: E2E_ITEM.name }).first());
  expect(errors).toEqual([]);
});

test("the inventory list reaches to 6 px from the screen edges on a phone", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= PHONE_MAX, "a table from sm up, not this list");
  const errors = collectErrors(page);
  await page.goto("/dashboard/inventory");
  await expectSurfaceEdges(
    page,
    page.locator("main").getByRole("list").filter({ hasText: E2E_ITEM.name }).filter({ visible: true }).first(),
  );
  expect(errors).toEqual([]);
});

test("budget cards reach to 6 px from the screen edges on a phone", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard/budget");
  await expectSurfaceEdges(page, page.locator('main [data-slot="card"]').filter({ visible: true }).first());
  expect(errors).toEqual([]);
});

// Budget redesign (Oct 2026): Insights' breakdown card (behind the
// Expenses / Income / Savings switch) is a Card, so it bleeds by itself; a
// bleeding wrapper around it pushed it flush to the screen edge.
test("Insights' breakdown card reaches the edges like any other card", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard/budget?tab=insights");
  const card = page
    .locator('main [data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]').getByText(/^Expenses by category/) })
    .filter({ visible: true })
    .first();
  await expectSurfaceEdges(page, card);
  expect(errors).toEqual([]);
});
