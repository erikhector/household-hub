import { expect, test, type Locator, type Page } from "@playwright/test";
import { dismissCookieNotice, expectHydrated, expectRouterPatched } from "./ui";

// Every phone sheet can go full screen (dialog.tsx): swipe it up, or tap the
// grabber. A swipe down from full screen shrinks it back instead of closing
// it, and a second swipe down closes it as before. Phone only by its file
// name: from `sm` dialogs are centred modals.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// A real touch drag. Base UI's sheet gesture listens to touch events (not
// pointer events) on a phone, and Playwright's touchscreen only taps, so the
// drag goes through CDP the way a finger's would.
async function swipe(page: Page, target: Locator, dy: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y0 = box.y + Math.min(box.height / 2, 40);
  const cdp = await page.context().newCDPSession(page);
  const point = (y: number) => [{ x, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(y0) });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(y0 + (dy * i) / steps) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function openAddTask(page: Page) {
  await page.goto("/dashboard/tasks");
  const add = page.getByRole("button", { name: "Add task" });
  await expectHydrated(add);
  // MAINT-67: the dialog's history entry must land after Next patches
  // history, or its first commit closes the sheet again.
  await expectRouterPatched(page);
  await add.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Task title" })).toBeVisible();
  // A swipe is aimed where the sheet is, so let it finish sliding in.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return dialog;
}

async function coversScreen(page: Page, dialog: Locator) {
  const box = (await dialog.boundingBox())!;
  return Math.abs(box.y) <= 1 && Math.abs(box.height - page.viewportSize()!.height) <= 1;
}

test("the grabber takes a sheet full screen and back", async ({ page }) => {
  const dialog = await openAddTask(page);
  expect(await coversScreen(page, dialog)).toBe(false);

  await dialog.getByRole("button", { name: "Expand sheet" }).click();
  await expect.poll(() => coversScreen(page, dialog)).toBe(true);

  await dialog.getByRole("button", { name: "Collapse sheet" }).click();
  await expect.poll(() => coversScreen(page, dialog)).toBe(false);
  await expect(dialog).toBeVisible();
});

test("a swipe up goes full screen, a swipe down steps back, then closes", async ({ page }) => {
  const dialog = await openAddTask(page);
  const heading = dialog.getByRole("heading").first();

  await swipe(page, heading, -150);
  await expect.poll(() => coversScreen(page, dialog)).toBe(true);
  await expect(dialog.getByRole("button", { name: "Collapse sheet" })).toBeVisible();

  // Down from full screen: smaller again, still open.
  await swipe(page, heading, 250);
  await expect.poll(() => coversScreen(page, dialog)).toBe(false);
  await expect(dialog).toBeVisible();

  // Down again from the normal sheet, most of the way to the bottom (Base
  // UI dismisses a slow drag past half the sheet): closes, as before.
  await expect(dialog).not.toHaveAttribute("data-full-screen");
  const top = (await heading.boundingBox())!.y;
  await swipe(page, heading, page.viewportSize()!.height - top - 20);
  await expect(dialog).toBeHidden();
});
