import { expect, test } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { sv } from "../src/lib/i18n/dictionaries/sv";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets, setLocaleCookie } from "./ui";

// UX-178: the profile page is ~7 700 px tall on a phone, so a row of chips
// under the title jumps straight to each section.
const t = en.profile;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("tapping Notifications brings the push notifications heading into view", async ({ page }) => {
  await page.goto("/dashboard/profile");
  const nav = page.getByRole("navigation", { name: t.jumpBar });
  await expect(nav.getByRole("link")).toHaveText([
    t.sections.account,
    t.sections.preferences,
    t.sections.notifications,
    t.sections.data,
  ]);
  const push = page.getByRole("heading", { name: t.pushNotifications.title });
  await expect(push).not.toBeInViewport();
  await nav.getByRole("link", { name: t.sections.notifications }).click();
  await expect(push).toBeInViewport();
});

test("the chip row has 44 px targets and fits a 320 px screen in Swedish", async ({ page, context, baseURL }) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/dashboard/profile");
  const nav = page.getByRole("navigation", { name: sv.profile.jumpBar });
  await expect(nav.getByRole("link", { name: sv.profile.sections.data })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
});
