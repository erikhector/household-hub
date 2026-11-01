import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { commonCopy } from "@/lib/i18n/common";
import { dismissCookieNotice, expectHydrated, gotoRevealed } from "./ui";

// UX-40 (DESIGN.md M2, M7): on a phone the page title starts large and, once
// scrolled away, reappears compact in the top bar, where a tap scrolls back
// up; the page's primary action floats at the bottom right above the bottom
// bar instead of sitting in a top corner. Desktop keeps the header as it was.
// The household page is long enough to scroll on a phone (members, notes and
// four settings cards) and its primary action is "Invite member".
const compactTitle = { name: `${en.household.title} ${commonCopy.en.backToTop}` };

test("phone: the title collapses into the top bar and the primary action floats in the thumb zone", async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the collapsing title and floating action are the phone shell's");
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/household");
  const main = page.locator("main");
  const viewport = page.viewportSize()!;

  const heading = page.getByRole("heading", { level: 1, name: en.household.title });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", compactTitle)).toHaveCount(0);

  // The primary action: bottom half, right edge, clear of the bottom bar.
  const invite = page.getByRole("button", { name: en.household.invite.button });
  const [inviteBox, barBox] = await Promise.all([invite.boundingBox(), page.getByRole("navigation").boundingBox()]);
  expect(inviteBox!.y).toBeGreaterThan(viewport.height / 2);
  expect(viewport.width - (inviteBox!.x + inviteBox!.width)).toBeLessThanOrEqual(24);
  expect(inviteBox!.y + inviteBox!.height).toBeLessThanOrEqual(barBox!.y);

  // Scrolled to the end: the title has gone, its compact copy is in the top
  // bar, and the last block of the page ends above the floating button
  // rather than under it.
  await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const compact = page.getByRole("button", compactTitle);
  await expect(compact).toBeVisible();
  expect((await compact.boundingBox())!.y).toBeLessThan(viewport.height / 4);
  const last = await page.locator("main > div > *").last().boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual((await invite.boundingBox())!.y + 1);

  // The floating button still opens its dialog from down here.
  await invite.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // A tap on the compact title goes back to the top and the large title.
  await compact.click();
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(heading).toBeInViewport();
  await expect(page.getByRole("button", compactTitle)).toHaveCount(0);
});

test("desktop: the primary action stays in the page header", async ({ page, isMobile }) => {
  test.skip(isMobile, "the desktop header is unchanged");
  await page.goto("/dashboard/household");
  const heading = page.getByRole("heading", { level: 1, name: en.household.title });
  const invite = page.getByRole("button", { name: en.household.invite.button });
  const [headingBox, inviteBox] = await Promise.all([heading.boundingBox(), invite.boundingBox()]);
  // Same row as the title, at the top of the page.
  expect(Math.abs(inviteBox!.y - headingBox!.y)).toBeLessThan(40);
  await page.mouse.wheel(0, 4000);
  await expect(page.getByRole("button", compactTitle)).toHaveCount(0);
});

// A phone sticky bar (here the planner's week bar) stays below the compact
// title once it appears. For a single-household user the compact bar hangs
// below the slim header over the top of `main`, and a bar stuck at main's
// top edge ended up underneath it, all but hidden (worst in the iOS PWA,
// where the compact bar also carries the safe-area inset).
test("phone: a sticky bar stays visible below the compact title", async ({ page, context, baseURL, isMobile }) => {
  test.skip(!isMobile, "the collapsing title and sticky bars are the phone shell's");
  await dismissCookieNotice(context, baseURL!);
  // A short screen, so even an empty week scrolls far enough for the week
  // bar to stick and the title to collapse.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 480 });
  await gotoRevealed(page, "/dashboard/meal-planning");
  const weekActions = page.getByRole("button", { name: en.mealPlanning.morePlannerActions });
  // The title's observer is wired up on hydration; a scroll before that
  // never collapses it.
  await expectHydrated(page.getByRole("heading", { level: 1, name: en.mealPlanning.title }));
  const main = page.locator("main");
  await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const compact = page.getByRole("button", { name: `${en.mealPlanning.title} ${commonCopy.en.backToTop}` });
  await expect(compact).toBeVisible();
  await expect(weekActions).toBeInViewport();
  await expect
    .poll(async () => {
      const [bar, actions] = await Promise.all([compact.boundingBox(), weekActions.boundingBox()]);
      return actions!.y - (bar!.y + bar!.height);
    })
    .toBeGreaterThanOrEqual(0);
});
