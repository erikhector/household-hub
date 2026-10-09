import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-12 (DESIGN.md M2, thumb zone): the recipe form is the longest sheet in
// the app, and its Save used to scroll out of view on phones — exactly where
// a thumb can't reach. DialogFooter is sticky on phones now, so filling the
// form to the bottom must leave the submit in the viewport with no manual
// scrolling. (The iOS-keyboard lift behind it, --kb-inset, is covered by
// src/components/ui/keyboard-inset.test.ts; desktop Chromium has no
// on-screen keyboard to test it with.)
test.skip(({ isMobile }) => !isMobile, "thumb-zone rule: the sheet footer stays put");

test("a filled recipe form keeps its submit in view on a phone", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/meal-planning");
  // Android half: the layout viewport resizes above the keyboard instead of
  // letting it overlay the sheet.
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportMeta ?? "").toContain("interactive-widget=resizes-content");
  await page.getByRole("tab", { name: "Recipes" }).click();
  await page.getByRole("button", { name: "New recipe" }).click();

  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await expect(dialog).toBeVisible();

  // Fill the form down to the bottom: name, instructions, and a stack of
  // ingredient rows, so the sheet overflows and must scroll.
  await dialog.getByRole("textbox", { name: "Name" }).fill(`Sheet check ${Date.now().toString(36)}`);
  await dialog.getByPlaceholder("How to make it…").fill("Stir everything together and serve.");
  const add = dialog.getByRole("button", { name: "Add ingredient" });
  for (let i = 0; i < 5; i++) await add.click();
  const names = dialog.getByPlaceholder("Ingredient");
  const count = await names.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) await names.nth(i).fill(`sheet staple ${i}`);
  // A thumb typing in the last row: focus it, the way opening the keyboard
  // would, so the sheet scrolls the field into view.
  await dialog.getByPlaceholder("Unit").last().click();

  // No scrollIntoView anywhere above: the sticky footer must already hold
  // the submit in the viewport.
  const submit = dialog.getByRole("button", { name: "Create recipe" });
  await expect(submit).toBeInViewport();

  // Pin the cause, not just the symptom: the footer sticks to the sheet's
  // bottom on phones, opaque so the content scrolling underneath doesn't
  // show through the translucent desktop strip.
  const footer = await dialog.evaluate((root) => {
    const el = root.querySelector<HTMLElement>('[data-slot="dialog-footer"]');
    if (!el) return null;
    const style = getComputedStyle(el);
    return { position: style.position, background: style.backgroundColor };
  });
  expect(footer?.position).toBe("sticky");
  const alpha = footer?.background.match(/rgba?\(([^)]+)\)/)?.[1].split(",").map(Number) ?? [];
  expect(alpha.length >= 4 ? alpha[3] : 1).toBe(1);
});
