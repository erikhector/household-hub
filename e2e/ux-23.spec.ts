import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-23: the budget tab bar scrolls sideways instead of wrapping on a
// 320 px phone, and "Add transaction" is a live button (the disabled
// primary is hidden until a category exists, so it never reads as broken).
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("budget tabs stay on one row at 320 px and Add transaction is usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/dashboard/budget");

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  const tops = await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size, "all four tabs share one row").toBe(1);
  await expectNoHorizontalOverflow(page);

  // The last tab is reachable by scrolling the bar.
  const insights = page.getByRole("tab", { name: /insights|insikter/i }).last();
  await insights.scrollIntoViewIfNeeded();
  await insights.click();
  await expect(insights).toHaveAttribute("aria-selected", "true");

  const add = page.getByRole("button", { name: /add transaction|lägg till transaktion/i }).first();
  await expect(add).toBeVisible();
  await expect(add).toBeEnabled();
});
