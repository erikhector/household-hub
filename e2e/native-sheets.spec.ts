import { expect, test, type Locator, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice } from "./ui";

// UX-34: native-grade bottom sheets. Every Dialog is a Base UI Drawer
// (src/components/ui/dialog.tsx): on a phone it drags down to dismiss,
// a long form rests at half or full height, the page behind scales down, and
// a touch open focuses the sheet rather than a field (no keyboard). The X,
// Escape and back keep working (back-closes-dialogs.spec.ts covers X/back).
// From `sm` the dialog is a centred modal and doesn't drag.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// A drag with real touch input (Chromium's CDP; Playwright's own touchscreen
// only taps). `stepDelay` paces it: 0 is a flick, a few dozen ms per step a
// slow, deliberate pull.
async function touchDrag(page: Page, from: { x: number; y: number }, dy: number, steps: number, stepDelay: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= steps; i++) {
    if (stepDelay) await page.waitForTimeout(stepDelay);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y + (dy * i) / steps }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function grabberPoint(dialog: Locator) {
  const box = await dialog.locator('[data-slot="dialog-grabber"]').boundingBox();
  expect(box, "the sheet has a grabber on phones").not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

// A short form (not a long one with snap points), in a far-future week so it
// opens on an empty plan.
async function openAddMeal(page: Page, open: "tap" | "click" = "click") {
  await page.goto("/dashboard/meal-planning?week=2031-03-03");
  const trigger = page.getByRole("button", { name: /^Add meal, / }).first();
  if (open === "tap") await trigger.tap();
  else await trigger.click();
  const dialog = page.getByRole("dialog", { name: /^Add \w+ · \w+ \d+$/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "bottom-sheet gestures are phone-only");

  test("a flick down on the grabber dismisses the sheet and leaves no back step", async ({ page }) => {
    await page.goto("/dashboard");
    const dialog = await openAddMeal(page);
    await touchDrag(page, await grabberPoint(dialog), 260, 4, 0);
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard\/meal-planning/);
    // The dialog's history entry went with it (UX-11): the next back is a
    // normal one.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a short, slow pull springs back instead of dismissing", async ({ page }) => {
    const dialog = await openAddMeal(page);
    // Let the open animation finish before measuring where the sheet rests.
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const before = await dialog.boundingBox();
    await touchDrag(page, await grabberPoint(dialog), 40, 8, 40);
    // Still open, and settled back where it was.
    await expect(dialog).toBeVisible();
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.y)).toBe(Math.round(before!.y));
  });

  test("a long form rests at half height with Save still in reach, and the grabber toggles it", async ({ page }) => {
    const t = en.inventory;
    await page.goto("/dashboard/inventory");
    await page.getByRole("button", { name: t.addItem }).first().click();
    const dialog = page.getByRole("dialog", { name: t.addDialogTitle });
    await expect(dialog).toBeVisible();
    // Opens full.
    await expect(dialog).toHaveAttribute("data-expanded", "");

    const viewport = page.viewportSize()!;
    // M3: the grabber button's visible pill is 16px tall, but its hit area
    // reaches 44px, down over the top of the sheet's body. The body paints
    // later, so this checks the button, not the body, wins a tap there.
    const grabber = await grabberPoint(dialog);
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ?? null,
      { x: grabber.x, y: grabber.y + 20 },
    );
    expect(hit).toBe(en.common.collapseSheet);
    await dialog.getByRole("button", { name: en.common.collapseSheet }).click();
    await expect(dialog).not.toHaveAttribute("data-expanded", "");
    // Half: the sheet's top (its box includes the snap translate) sits at
    // about mid-screen…
    await expect.poll(async () => (await dialog.boundingBox())!.y).toBeGreaterThan(viewport.height * 0.45);
    // …and Save rides at the bottom of the visible part (M2).
    const save = dialog.getByRole("button", { name: t.addItem, exact: true });
    await expect(save).toBeInViewport();
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(viewport.height + 1);

    await dialog.getByRole("button", { name: en.common.expandSheet }).click();
    await expect(dialog).toHaveAttribute("data-expanded", "");
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeInViewport();
  });

  test("the page behind scales down while a sheet is open", async ({ page }) => {
    const dialog = await openAddMeal(page);
    const indent = page.locator('[data-slot="sheet-indent"]');
    await expect(indent).toHaveAttribute("data-active", "");
    await expect.poll(() => indent.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    // At rest, no transform at all: one (even scale(1)) would turn the page
    // wrapper into the containing block of the fixed bottom bar.
    await expect.poll(() => indent.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  });

  test("under reduced motion the page behind stays put", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openAddMeal(page);
    const indent = page.locator('[data-slot="sheet-indent"]');
    await expect(indent).toHaveAttribute("data-active", "");
    expect(await indent.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  });

  test("a touch open focuses the sheet, not a field, so the keyboard stays down", async ({ page }) => {
    const dialog = await openAddMeal(page, "tap");
    await expect.poll(() => dialog.evaluate((el) => document.activeElement === el)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");
  });
});

test.describe("on a desktop", () => {
  test.skip(({ isMobile }) => isMobile, "the centred modal");

  test("a mouse open focuses the first field, and Escape closes", async ({ page }) => {
    const t = en.inventory;
    await page.goto("/dashboard/inventory");
    await page.getByRole("button", { name: t.addItem }).first().click();
    const dialog = page.getByRole("dialog", { name: t.addDialogTitle });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("the centred dialog doesn't drag", async ({ page }) => {
    const dialog = await openAddMeal(page);
    const before = (await dialog.boundingBox())!;
    // The grabber is phone-only; drag the dialog's top edge instead.
    const x = before.x + before.width / 2;
    const y = before.y + 4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 300, { steps: 10 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    expect(Math.round((await dialog.boundingBox())!.y)).toBe(Math.round(before.y));
  });
});
