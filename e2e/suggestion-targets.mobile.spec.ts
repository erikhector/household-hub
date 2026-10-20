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
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    expect(box.width, `${what} #${i} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${what} #${i} height`).toBeGreaterThanOrEqual(44);
  }
}

test("unit suggestions are at least 44 px tall", async ({ page }) => {
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  await page.getByRole("button", { name: "More list actions" }).click();
  await page.getByRole("menuitem", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an item" });
  await dialog.getByRole("button", { name: "Show suggestions" }).first().click();
  const rows = page.locator("[data-slot=autocomplete-item]");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    // The popup zooms in from 95%, so poll until the animation has settled.
    await expect
      .poll(() => rows.nth(i).evaluate((el) => el.getBoundingClientRect().height), {
        message: `unit suggestion #${i} height`,
      })
      .toBeGreaterThanOrEqual(44);
  }
});

test("the Match item combobox toggle is 44 x 44", async ({ page }) => {
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  await page.getByRole("button", { name: "Match item" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectAtLeast44(dialog.locator("[data-slot=combobox-trigger]"), "combobox toggle");
});
