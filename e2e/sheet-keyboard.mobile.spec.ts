import { expect, test } from "@playwright/test";
import { dismissCookieNotice, openRecipesTab } from "./ui";

// UX-12 (DESIGN.md M2, thumb zone): the recipe form is the longest sheet in
// the app, and its Save used to scroll out of view on phones — exactly where
// a thumb can't reach. DialogFooter is sticky on phones now, so filling the
// form to the bottom must leave the submit in the viewport with no manual
// scrolling. The second test covers the iOS keyboard (--kb-inset), with
// the keyboard simulated through the visual viewport; the event wiring
// is unit-tested in src/components/ui/keyboard-inset.test.ts.
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
// height behind the keyboard, and only the visual viewport shrinks. A tall
// sheet lifted above it but still 85dvh tall had its top pushed off the
// screen, and a field low in it ended up under the keyboard or the sticky
// footer, so you typed blind. Chromium has no on-screen keyboard, so this
// shrinks the visual viewport the way the keyboard does and fires the
// resize iOS fires: the real useKeyboardInset hook then lifts and caps the
// sheet and reveals the focused field.
test("a tall sheet over the iOS keyboard keeps the field being typed in visible", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  await page.getByRole("button", { name: "New recipe" }).click();
  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await expect(dialog).toBeVisible();

  // Enough rows that the sheet reaches its 85dvh cap and scrolls.
  const add = dialog.getByRole("button", { name: "Add ingredient" });
  for (let i = 0; i < 6; i++) await add.click();
  const unit = dialog.getByPlaceholder("Unit").last();
  // The case iOS gets wrong: the field is focused while out of view below
  // (iOS scrolled for it against the sheet before the keyboard came up).
  // focus({ preventScroll }) with the body at its top recreates that
  // without Playwright's click scrolling the field into view first.
  await unit.evaluate((el: HTMLElement) => {
    el.closest<HTMLElement>('[data-slot="dialog-body"]')!.scrollTop = 0;
    el.focus({ preventScroll: true });
  });
  await expect(unit).toBeFocused();

  const KEYBOARD = 340;
  await page.evaluate((px) => {
    const vv = window.visualViewport!;
    Object.defineProperty(vv, "height", { configurable: true, get: () => window.innerHeight - px });
    vv.dispatchEvent(new Event("resize"));
  }, KEYBOARD);

  const visibleBottom = page.viewportSize()!.height - KEYBOARD;
  const footer = dialog.locator('[data-slot="dialog-footer"]');
  // The sheet animates its lift and max-height, and the reveal waits for
  // that, so poll until everything has settled.
  await expect
    .poll(async () => {
      const [sheet, field, bar] = await Promise.all([dialog.boundingBox(), unit.boundingBox(), footer.boundingBox()]);
      if (!sheet || !field || !bar) return null;
      return {
        sheetTopOnScreen: sheet.y >= 0,
        sheetAboveKeyboard: sheet.y + sheet.height <= visibleBottom + 1,
        fieldBelowSheetTop: field.y >= sheet.y,
        fieldAboveFooter: field.y + field.height <= bar.y + 1,
      };
    })
    .toEqual({ sheetTopOnScreen: true, sheetAboveKeyboard: true, fieldBelowSheetTop: true, fieldAboveFooter: true });
});
