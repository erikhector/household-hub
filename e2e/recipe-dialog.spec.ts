import { expect, test } from "@playwright/test";

// The recipe form is the longest dialog in the app. On phones it opens as a
// bottom sheet, and it used to be a scroll container nested inside the
// sheet's own scroller. iOS Safari doesn't hand a swipe from one scroller
// over to the other, so the sheet got stuck partway and the save button was
// unreachable. Chromium chains the scroll, so it can't reproduce the stall
// itself; instead this pins down its cause: the sheet is the dialog's only
// scroll container, and scrolling it brings the save button on screen.
test("the new recipe dialog scrolls as one sheet", async ({ page }) => {
  await page.goto("/dashboard/meal-planning");
  await page.getByRole("tab", { name: "Recipes" }).click();
  await page.getByRole("button", { name: "New recipe" }).click();

  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await expect(dialog).toBeVisible();

  const nestedScrollers = await dialog.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        const { overflowY } = getComputedStyle(el);
        return /auto|scroll/.test(overflowY) && el.scrollHeight > el.clientHeight;
      })
      .map((el) => el.tagName.toLowerCase()),
  );
  expect(nestedScrollers).toEqual([]);

  const save = dialog.getByRole("button", { name: "Create recipe" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
});
