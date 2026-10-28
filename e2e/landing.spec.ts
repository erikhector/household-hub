import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

// UX-58: the landing page shows the product and claims only what's true.
// public.spec.ts already renders it in both languages; these assert the
// item's acceptance lines.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the landing page leads with a phone-framed shopping list", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByRole("img", { name: /shopping list in Squirrel on a phone/ });
  // Above the fold at either size: on a phone it's under the buttons, so a
  // good share of it (the mascot, the list name and the first rows) shows
  // before any scrolling.
  await expect(preview).toBeInViewport({ ratio: 0.4 });
  await expectNoHorizontalOverflow(page);
});

test("the landing page names every part of the app and no example data", async ({ page }) => {
  await page.goto("/");
  for (const title of [
    "Pantry that watches itself",
    "Shopping lists that build themselves",
    "Meals, planned not panicked",
    "Chores that come back round",
    "Scan instead of typing",
    "Budgets without the spreadsheet",
  ]) {
    await expect(page.getByRole("main").getByText(title, { exact: true })).toBeVisible();
  }
  // A new household starts empty (UX-136), so the page mustn't say otherwise.
  await expect(page.getByText(/example data/i)).toHaveCount(0);
  await expect(page.getByText(/less than a minute/i)).toHaveCount(0);
});

// The fridge-door redesign: the headline, the notes as decoration only,
// and each fridge note re-homed beside the feature that replaces it.
test("the hero takes everything off the fridge, and the notes stay decoration", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Take everything off the fridge." })).toBeVisible();
  // The scribbles are aria-hidden: a screen reader hears the headline and
  // the phone's label, not "bananas, oat milk (2?)…".
  await expect(page.getByText("WHOSE TURN??").first()).toBeAttached();
  const hidden = await page
    .getByText("WHOSE TURN??")
    .first()
    .evaluate((el) => el.closest("[aria-hidden='true']") !== null);
  expect(hidden).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test("each fridge note sits beside the feature that replaces it", async ({ page }) => {
  await page.goto("/");
  const band = page.getByRole("heading", { name: "Every note on the fridge has a better home." }).locator("xpath=ancestor::section[1]");
  await expect(band.getByRole("listitem")).toHaveCount(3);
  for (const title of ["Shopping lists that build themselves", "Chores that come back round", "Budgets without the spreadsheet"]) {
    await expect(band.getByRole("heading", { level: 3, name: title })).toBeVisible();
  }
});

test("the closing sticky note leads to sign-up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Get the household in order." })).toBeVisible();
  await page.getByRole("link", { name: "Create your household" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("the phone preview follows the Swedish locale", async ({ page, context, baseURL }) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await page.goto("/");
  await expect(page.getByRole("img", { name: /inköpslista i Squirrel på en mobil/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Ta ner allt från kylskåpet." })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
