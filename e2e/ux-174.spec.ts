import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, gotoRevealed } from "./ui";

// UX-174: Household is split into Members / Notes / Settings tabs instead of
// ~3 000 px of stacked forms, and Budget Manage's cards say one line each,
// with the longer explanation behind a "Learn more" disclosure.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("household opens on Members, with the first form within two screens", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/household");
  const main = page.getByRole("main");

  await expect(main.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
  await expect(main.getByText("E2E Tester", { exact: true })).toBeVisible();
  // Notes and Settings are not on screen until their tab is opened.
  await expect(main.getByRole("heading", { name: "Notes" })).toBeHidden();
  await expect(main.getByRole("heading", { name: "Currency" })).toBeHidden();

  // The page, tabs included, is no taller than two screens of content.
  const height = await page.evaluate(() => {
    const el = document.querySelector("main");
    return el ? el.scrollHeight : document.documentElement.scrollHeight;
  });
  expect(height).toBeLessThanOrEqual(2 * (page.viewportSize()?.height ?? 800));
  await expectNoHorizontalOverflow(page);
});

test("the Notes and Settings tabs show their sections and keep the tab in the URL", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/household");
  const main = page.getByRole("main");
  await expectHydrated(main.getByRole("tab", { name: "Notes" }));

  await main.getByRole("tab", { name: "Notes" }).click();
  await expect(main.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page).toHaveURL(/tab=notes/);

  await main.getByRole("tab", { name: "Settings" }).click();
  await expect(main.getByRole("heading", { name: "Currency" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Danger zone" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Notes" })).toBeHidden();

  await page.reload();
  await expect(main.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  await expect(main.getByRole("heading", { name: "Currency" })).toBeVisible();
});

test("budget Manage: one line per card, the rest behind Learn more", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/budget?tab=manage");
  const main = page.getByRole("main");

  const learnMore = main.getByText("Learn more", { exact: true });
  await expect(learnMore).toHaveCount(2);
  const explanation = main.getByText(/Everything you add here counts in Safe to spend/);
  await expect(explanation).toBeHidden();

  await learnMore.first().click();
  await expect(explanation).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
