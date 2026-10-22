import { expect, test, type Locator } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-143 (DESIGN.md M-rules, 44 x 44 targets): suggestion rows in the unit
// picker (Autocomplete) and the combobox toggle (Combobox) were 32 px and
// 42 px tall. Touch projects only: a mouse on desktop keeps the compact rows.
test.skip(({ isMobile }) => !isMobile, "touch target rule: a mouse on desktop keeps compact rows");

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function expectAtLeast44(target: Locator, what: string) {
  const count = await target.count();
  expect(count, `${what} is on screen`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await target.nth(i).evaluate((el) => {
      // Layout size (rounded), not the transformed rect: a popup list long
      // enough to scroll (UX-127 lists every common unit) measured
      // 43.99997 from float noise in the 95% zoom-in, for a 44 px row.
      const h = el as HTMLElement;
      return { width: h.offsetWidth, height: h.offsetHeight };
    });
    expect(box.width, `${what} #${i} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${what} #${i} height`).toBeGreaterThanOrEqual(44);
  }
}

test("unit suggestions are at least 44 x 44", async ({ page }) => {
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  await page.getByRole("button", { name: "More list actions" }).click();
  await page.getByRole("menuitem", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an item" });
  // The name and unit fields both have a "Show suggestions" button (name
  // first), so take the one in the unit field's group. The unit input has
  // no visible label in this dialog; its name comes from the placeholder.
  await dialog
    .getByRole("group")
    .filter({ has: page.getByRole("combobox", { name: "Unit", exact: true }) })
    .getByRole("button", { name: "Show suggestions" })
    .click();
  // A seeded pantry unit, so the test can't pass on the item-name list.
  await expect(page.getByRole("option", { name: "pcs", exact: true })).toBeVisible();
  // The popup zooms in from 95%, scaling every row with it until the
  // animation ends, so measure the settled layout rather than a frame of it.
  await page
    .locator("[data-slot=autocomplete-content]")
    .evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))),
    );
  await expectAtLeast44(page.locator("[data-slot=autocomplete-item]"), "unit suggestion");
});

test("the Match item combobox toggle is 44 x 44", async ({ page }) => {
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  await page.getByRole("button", { name: "Match item" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectAtLeast44(dialog.locator("[data-slot=combobox-trigger]"), "combobox toggle");
});
