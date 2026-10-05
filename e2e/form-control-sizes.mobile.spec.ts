import { expect, test, type Locator } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";

// UX-10 (DESIGN.md M4): a focused field under 16 px makes iOS zoom the page,
// and a unit field too narrow for its own buttons shows "p" for "pcs". Every
// visible, focusable field in each dialog below must compute to >= 16 px.
// Base UI renders aria-hidden mirror inputs (form value carriers) that are
// never focused, so those are skipped.
test.skip(({ isMobile }) => !isMobile, "phone font-size rule: desktop is deliberately text-sm");

async function expectFieldsAtLeast16px(dialog: Locator) {
  const fields = await dialog.locator("input, textarea, [role=combobox]").evaluateAll((els) =>
    els
      .filter((el) => {
        const input = el as HTMLInputElement;
        const rect = el.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          !el.closest("[aria-hidden=true]") &&
          !["hidden", "checkbox", "radio", "file", "submit", "button"].includes(input.type) &&
          getComputedStyle(el).visibility !== "hidden"
        );
      })
      .map((el) => ({
        label: el.getAttribute("aria-label") ?? el.id ?? el.tagName,
        size: parseFloat(getComputedStyle(el).fontSize),
      })),
  );
  expect(fields.length, "dialog has at least one field").toBeGreaterThan(0);
  for (const field of fields) expect(field.size, `font-size of ${field.label}`).toBeGreaterThanOrEqual(16);
}

const fitsItsValue = (field: Locator) =>
  field.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth);

test("shopping add and edit item dialogs use 16px fields and show the whole unit", async ({ page }) => {
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);

  await page.getByRole("button", { name: "Add item" }).click();
  const add = page.getByRole("dialog", { name: "Add an item" });
  await expectFieldsAtLeast16px(add);
  const addUnit = add.locator("#add-item-unit");
  await addUnit.fill("pcs");
  expect(await fitsItsValue(addUnit)).toBe(true);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Edit Apples" }).click();
  const edit = page.getByRole("dialog");
  await expectFieldsAtLeast16px(edit);
  const unit = edit.locator("#edit-item-unit");
  await expect(unit).toHaveValue("pcs");
  expect(await fitsItsValue(unit)).toBe(true);
});

test("budget transaction and recurring dialogs use 16px fields", async ({ page }) => {
  await page.goto("/dashboard/budget");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  await expectFieldsAtLeast16px(page.getByRole("dialog"));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Add recurring item" }).first().click();
  await expectFieldsAtLeast16px(page.getByRole("dialog"));
});
