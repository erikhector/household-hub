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

// The Acceptance line is about pixels: a row scrolled under the bar must not
// show through. A loud marker (text and an icon-sized block on a saturated
// fill) is laid under the bar's whole box, in front of the page but behind
// the bar's z-index, and the bar's screenshot must not change. The same
// marker lifted above the bar proves the screenshot would notice it.
test("a row under the add bar does not show through the field or the bar", async ({ page }) => {
  await page.goto(LIST_URL);
  const field = page.getByRole("combobox", { name: "Add to the list" });
  await expect(field).toBeVisible();
  // The bar is server-rendered without the mic (support is only known once
  // the page hydrates), then the mic appears and the field's padding and
  // placeholder clip change. A "before" shot taken in between differs from
  // every later one, so wait for the hydrated bar (Chromium has a recognizer).
  await expect(page.getByRole("button", { name: "Add by voice" })).toBeVisible();
  const bar = field.locator("xpath=ancestor::div[contains(@class,'sticky')][1]");
  const box = (await bar.boundingBox())!;
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };

  const before = await page.screenshot({ clip });

  const placeMarker = (zIndex: number) =>
    page.evaluate(
      ({ clip, zIndex }) => {
        document.getElementById("ux82-marker")?.remove();
        const marker = document.createElement("div");
        marker.id = "ux82-marker";
        marker.textContent = "ROW UNDER THE BAR 12345 ■ ● ▲ MMMMMMMMMMMMMMMMMMMM";
        Object.assign(marker.style, {
          position: "fixed",
          left: `${clip.x}px`,
          top: `${clip.y}px`,
          width: `${clip.width}px`,
          height: `${clip.height}px`,
          zIndex: String(zIndex),
          background: "rgb(255, 0, 255)",
          color: "rgb(0, 255, 0)",
          fontSize: "28px",
          fontWeight: "900",
          lineHeight: "1",
          overflow: "hidden",
          pointerEvents: "none",
        });
        document.body.appendChild(marker);
      },
      { clip, zIndex },
    );

  await placeMarker(1000);
  const lifted = await page.screenshot({ clip });
  expect(lifted.equals(before), "the screenshot notices a marker above the bar").toBe(false);

  await placeMarker(1);
  const underneath = await page.screenshot({ clip });
  expect(underneath.equals(before), "nothing under the bar shows through").toBe(true);
});
