import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated } from "./ui";

// PERF-26: the meal planning dialogs are separate chunks, mounted the first
// time they're asked to open (the PERF-25 helper). The first tap after a hard
// load must still open one at once, without the idle prefetch. The failed
// chunk path is the shared primitive's and is covered in
// shopping-lazy-dialogs.spec.ts; the rest of the page group's behaviour is
// covered by the flow specs that open each dialog.
const t = en.mealPlanning;
// A far-future week nobody plans in, so it is an empty week for every run.
const EMPTY_WEEK = "2032-03-02";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.describe("without the idle prefetch", () => {
  test.beforeEach(async ({ page }) => {
    // The tap has to fetch the chunk itself and open once it arrives.
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
  });

  test("Add your first dinner opens the meal form on the first tap", async ({ page }) => {
    await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);
    const first = page.getByRole("button", { name: t.addFirstDinner });
    await expectHydrated(first);
    await first.click();
    await expect(page.getByRole("dialog", { name: /^Add \w+ · \w+ \d+$/ })).toBeVisible();
  });

  test("New recipe opens the recipe form on the first tap", async ({ page }) => {
    await page.goto("/dashboard/meal-planning?tab=recipes");
    const button = page.getByRole("button", { name: t.newRecipe });
    await expectHydrated(button);
    await button.click();
    await expect(page.getByRole("dialog", { name: t.newRecipeDialogTitle })).toBeVisible();
  });

  test("Record prep opens its dialog on the first tap", async ({ page }) => {
    await page.goto("/dashboard/meal-planning?tab=prep");
    const button = page.getByRole("button", { name: t.prepRecordButton });
    await expectHydrated(button);
    await button.click();
    await expect(page.getByRole("dialog", { name: t.prepRecordDialogTitle })).toBeVisible();
  });
});
