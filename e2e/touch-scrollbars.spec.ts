import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// globals.css hides scrollbars on touch screens only. On the phone project
// (touch, coarse pointer) the scrolling `main` has none; on desktop (mouse)
// it keeps the default, so a mouse user can still see and drag it.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("scroll containers hide their scrollbar on touch screens only", async ({ page, isMobile }) => {
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toBeVisible();

  const touch = await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches);
  // The phone project emulates touch; without this the check could pass
  // on both projects with neither matching the touch query.
  expect(touch).toBe(isMobile);
  const width = await main.evaluate((el) => getComputedStyle(el).scrollbarWidth);
  expect(width).toBe(touch ? "none" : "auto");
});
