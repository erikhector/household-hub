import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// iOS Safari sizes a natively drawn date field to its own content and
// ignores `width: 100%`, so on a phone the field poked out of its dialog and
// the sheet scrolled sideways. globals.css drops the native appearance for
// every date/time input. Chromium never had the bug, so this pins the fix
// itself (appearance: none) plus the visible result: the field sits inside
// its dialog and nothing scrolls horizontally.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("date fields fit inside their dialog", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await page.getByRole("main").getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add inventory item" });
  const date = dialog.getByLabel("Expires on");
  await expect(date).toBeVisible();

  expect(await date.evaluate((el) => getComputedStyle(el).appearance)).toBe("none");
  const fieldBox = (await date.boundingBox())!;
  const dialogBox = (await dialog.boundingBox())!;
  expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 0.5);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expectNoHorizontalOverflow(page);
});

// The checked Checkbox once rendered as an empty outline (no fill, no tick)
// on every browser: its inline SVG tick had spaces, so cn() split it into
// fragments and dropped `checked:bg-primary` as a conflicting colour. Pins
// that a checked box is filled with the primary colour and draws the tick.
test("a checked checkbox is filled and shows a tick", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await page.getByRole("main").getByRole("button", { name: "Add item", exact: true }).click();
  const box = page
    .getByRole("dialog", { name: "Add inventory item" })
    .getByRole("checkbox", { name: "This item doesn't expire" });
  const paint = () =>
    box.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fill: s.backgroundColor, border: s.borderTopColor, image: s.backgroundImage };
    });

  const before = await paint();
  expect(before.image).toBe("none");
  await box.check();
  // Polled to ride out the 150ms colour transition: once settled, the fill
  // is the primary colour, the same as the checked border.
  await expect
    .poll(async () => {
      const { fill, border } = await paint();
      return fill === border && fill !== before.fill;
    })
    .toBe(true);
  expect((await paint()).image).toContain("url(");
});
