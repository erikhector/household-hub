import { expect, test, type Locator } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-82: the sticky add bar on the shopping list is fully opaque, so a row
// scrolled under it never shows through the field or the bar (M9). Reads the
// seeded list without changing it.
const LIST_URL = `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Computed colours serialise as rgb()/oklch()/lab()/color() with an optional
// "/ alpha"; opaque means no alpha part, or one that resolves to 1 / 100%.
function isOpaque(color: string) {
  if (color === "transparent") return false;
  const alpha = color.match(/\/\s*([\d.]+)(%?)\s*\)/);
  if (alpha) return (alpha[2] ? Number(alpha[1]) / 100 : Number(alpha[1])) === 1;
  return !/^rgba\(/.test(color) || /,\s*1\)$/.test(color);
}

async function backgroundOf(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

test("the add field and its bar are opaque while the list scrolls under them", async ({ page }) => {
  await page.goto(LIST_URL);
  const field = page.getByRole("combobox", { name: "Add to the list" });
  await expect(field).toBeVisible();
  const bar = field.locator("xpath=ancestor::div[contains(@class,'sticky')][1]");

  expect(isOpaque(await backgroundOf(field)), "field background").toBe(true);
  expect(isOpaque(await backgroundOf(bar)), "bar background").toBe(true);
  expect(await bar.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
});
