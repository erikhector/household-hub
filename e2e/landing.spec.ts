import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

// UX-58, list-first: the landing page makes one promise (the shared list
// that keeps itself up to date), shows it, names three things it does and
// asks once. public.spec.ts already renders it in both languages; these
// assert the acceptance lines.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the landing page leads with a phone-framed shopping list", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByRole("img", { name: /shopping list in Squirrel on a phone/ });
  // Above the fold at either size: on a phone it's under the button, so a
  // good share of it (the mascot, the list name and the first rows) shows
  // before any scrolling.
  await expect(preview).toBeInViewport({ ratio: 0.4 });
  await expectNoHorizontalOverflow(page);
});

test("the hero promises the list, and the sticky notes stay decoration", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "The shopping list that keeps itself up to date." }),
  ).toBeVisible();
  // The notes beside the phone are aria-hidden: a screen reader hears the
  // headline and the phone's label, not "oat milk → added itself".
  const note = page.getByText("oat milk → added itself").first();
  await expect(note).toBeAttached();
  expect(await note.evaluate((el) => el.closest("[aria-hidden='true']") !== null)).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test("the landing page names three things the list does, and no example data", async ({ page }) => {
  await page.goto("/");
  for (const title of ["One list, everyone's phone", "It fills itself", "The receipt does the budget"]) {
    await expect(page.getByRole("main").getByRole("heading", { level: 3, name: title })).toBeVisible();
  }
  // A new household starts empty (UX-136), and signup waits on email
  // verification, so the page mustn't claim otherwise.
  await expect(page.getByText(/example data/i)).toHaveCount(0);
  await expect(page.getByText(/less than a minute/i)).toHaveCount(0);
});

// The preview's demo: with motion allowed it cycles (the stage clears, oat
// milk lands on the list, Sam's tick arrives); under reduced motion it
// rests on the finished picture and never moves.
test("the phone preview plays its demo, and rests under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const stage = page.locator("[data-phase]");
  await expect(stage).toHaveAttribute("data-phase", "added", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-phase", "ticked", { timeout: 10_000 });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(stage).toHaveAttribute("data-phase", "rest");
  // Long enough for the first two phases to have fired if the loop ran.
  await page.waitForTimeout(1500);
  await expect(stage).toHaveAttribute("data-phase", "rest");
});

test("the closing sticky note leads to sign-up", async ({ page }) => {
  await page.goto("/");
  const note = page
    .getByRole("heading", { name: "Take the list off the fridge." })
    .locator("xpath=ancestor::section[1]");
  await expect(note).toBeVisible();
  await note.getByRole("link", { name: "Start your list" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("the phone preview follows the Swedish locale", async ({ page, context, baseURL }) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await page.goto("/");
  await expect(page.getByRole("img", { name: /inköpslista i Squirrel på en mobil/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Inköpslistan som sköter sig själv." })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
