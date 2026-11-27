import { expect, test } from "@playwright/test";
import { dismissCookieNotice, openRecipesTab } from "./ui";

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
  await openRecipesTab(page);
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

// The iOS half of the lift: Safari keeps the layout viewport (and dvh) full
// height behind the keyboard, and useKeyboardInset writes the keyboard's
// height to --kb-inset. A tall sheet lifted by it but still 85dvh tall had
// its top, and the field being typed in, pushed off the top of the screen.
// Chromium has no on-screen keyboard, so this writes the inset the way the
// hook would and checks the sheet then fits in the space above it.
test("a tall sheet lifted above the iOS keyboard keeps its top on screen", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  await page.getByRole("button", { name: "New recipe" }).click();
  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await expect(dialog).toBeVisible();

  // Enough rows that the sheet reaches its 85dvh cap.
  const add = dialog.getByRole("button", { name: "Add ingredient" });
  for (let i = 0; i < 6; i++) await add.click();
  const name = dialog.getByRole("textbox", { name: "Name" });
  await name.click();

  const KEYBOARD = 340;
  await page.evaluate((px) => document.documentElement.style.setProperty("--kb-inset", `${px}px`), KEYBOARD);

  // max-height animates (the full-screen morph), so poll until it settles.
  const visibleBottom = page.viewportSize()!.height - KEYBOARD;
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      return box ? { top: box.y >= 0, bottom: box.y + box.height <= visibleBottom + 1 } : null;
    })
    .toEqual({ top: true, bottom: true });

  // And the field being typed in is in that visible band, not under the
  // keyboard or above the screen.
  const field = await name.boundingBox();
  expect(field!.y).toBeGreaterThanOrEqual(0);
  expect(field!.y + field!.height).toBeLessThanOrEqual(visibleBottom + 1);
});
