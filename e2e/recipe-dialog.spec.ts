import { expect, test, type Locator } from "@playwright/test";
import { dismissCookieNotice, openRecipesTab } from "./ui";

// The recipe form is the longest dialog in the app. On phones it opens as a
// bottom sheet, and it used to be a scroll container nested inside the
// sheet's own scroller. iOS Safari doesn't hand a swipe from one scroller
// over to the other, so the sheet got stuck partway and the save button was
// unreachable. Chromium chains the scroll, so it can't reproduce the stall
// itself; instead this pins down its cause: the sheet's body (UX-34: the
// sheet is a grabber above a scrolling body, dialog.tsx) is the dialog's
// only scroll container, and scrolling it brings the footer button on screen.
async function expectScrollsAsOneSheet(dialog: Locator, button: Locator) {
  const scrollers = await dialog.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        const { overflowY } = getComputedStyle(el);
        return /auto|scroll/.test(overflowY) && el.scrollHeight > el.clientHeight;
      })
      .map((el) => el.dataset.slot ?? el.tagName.toLowerCase()),
  );
  expect(scrollers.filter((slot) => slot !== "dialog-body")).toEqual([]);

  // The sheet mustn't scroll sideways either (DialogFooter bleeds -mx-4
  // into the body's padding).
  const body = dialog.locator('[data-slot="dialog-body"]');
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
}

// "New recipe" floats above the bottom bar on phones (PrimaryAction), where
// a fresh context's cookie notice would cover it.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// A name no pantry item resembles (and no remembered alias answers, since
// nothing here is saved), so step 2 always shows it for review.
// Long on purpose. The matcher scores bigram overlap and suggests anything
// at 0.35 or more, so a 10-letter name could land on a pantry item by luck
// (the seeded "Tomatoes" shares om/ma/at with "romatmnaai", 0.375) and the
// row would show a suggestion instead of "Nothing close". At 24 letters a
// 7-bigram name needs 6 shared bigrams to reach 0.35, which random letters
// don't do.
const nonsenseName = () =>
  Array.from({ length: 24 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

test("the new recipe dialog scrolls as one sheet on both steps", async ({ page }) => {
  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  await page.getByRole("button", { name: "New recipe" }).click();

  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await expect(dialog).toBeVisible();
  await expectScrollsAsOneSheet(dialog, dialog.getByRole("button", { name: "Create recipe" }));

  // Step 2, the ingredient review, is the longest content now.
  await dialog.getByRole("textbox", { name: "Name" }).fill(`Scroll check ${Date.now().toString(36)}`);
  await dialog.getByPlaceholder("Ingredient").fill(nonsenseName());
  await dialog.getByPlaceholder("Qty").fill("1");
  await dialog.getByPlaceholder("Unit").fill("pcs");
  await dialog.getByRole("button", { name: "Create recipe" }).click();

  const review = page.getByRole("dialog", { name: "Match ingredients" });
  await expect(review).toBeVisible();
  await expectScrollsAsOneSheet(review, review.getByRole("button", { name: "Create recipe" }));
});
