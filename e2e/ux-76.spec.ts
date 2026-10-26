import { expect, test } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectNoHorizontalOverflow, gotoRevealed } from "./ui";

// UX-76: the Profile is four sections (Account, Preferences, Notifications,
// Data & privacy) with the rare items behind disclosures and Log out at the
// end, instead of eleven loose cards.
const t = en.profile;

// The cookie notice sits over the bottom of a phone screen and would catch
// the taps on the disclosures and Log out.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("profile is grouped into four sections, with Swish under Preferences", async ({ page }) => {
  await page.goto("/dashboard/profile");
  await expect(page.locator("main h2")).toHaveText([
    t.sections.account,
    t.sections.preferences,
    t.sections.notifications,
    t.sections.data,
  ]);

  const account = page.getByRole("region", { name: t.sections.account });
  await expect(account.getByLabel(t.displayNameForm.label)).toBeVisible();
  await expect(account.getByRole("heading", { name: t.emailForm.title })).toBeVisible();
  await expect(account.getByRole("heading", { name: t.passwordForm.title })).toBeVisible();
  // The name card no longer repeats its own field label as a heading.
  await expect(account.getByText(t.displayNameForm.label, { exact: true })).toHaveCount(1);

  const preferences = page.getByRole("region", { name: t.sections.preferences });
  await expect(preferences.getByLabel(t.swishForm.label)).toBeVisible();
  const notifications = page.getByRole("region", { name: t.sections.notifications });
  await expect(notifications.getByRole("heading", { name: t.weeklyDigest.title })).toBeVisible();
  await expect(notifications.getByRole("heading", { name: t.tonightsDinner.title })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("rare items sit behind disclosures", async ({ page }) => {
  await page.goto("/dashboard/profile");
  const data = page.getByRole("region", { name: t.sections.data });
  await expect(data.getByRole("link", { name: t.dataExport.button })).toBeVisible();

  const deleteTrigger = data.getByRole("button", { name: t.deleteAccount.trigger });
  await expect(deleteTrigger).toBeHidden();
  await data.getByText(t.dangerZoneTitle, { exact: true }).click();
  await expect(deleteTrigger).toBeVisible();

  const whatsNew = data.getByRole("link", { name: t.about.whatsNewLink });
  await expect(whatsNew).toBeHidden();
  await data.getByText(t.about.title, { exact: true }).click();
  await expect(whatsNew).toBeVisible();
});

test("desktop lays sections in two columns, phones in one", async ({ page }) => {
  // Measured straight away, so wait for the streamed page (see gotoRevealed).
  await gotoRevealed(page, "/dashboard/profile");
  const account = await page.locator("#profile-account").boundingBox();
  const preferences = await page.locator("#profile-preferences").boundingBox();
  expect(account && preferences).toBeTruthy();
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  if (wide) {
    expect(Math.abs(account!.y - preferences!.y)).toBeLessThan(2);
    expect(preferences!.x).toBeGreaterThan(account!.x + account!.width - 1);
  } else {
    expect(preferences!.y).toBeGreaterThan(account!.y + account!.height - 1);
  }
});

test("Log out is the last thing on the profile and signs out", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/profile");
  const logOut = page.locator("main").getByRole("button", { name: en.nav.logOut });
  const lastHeading = await page.locator("#profile-data").boundingBox();
  const button = await logOut.boundingBox();
  expect(button!.y).toBeGreaterThan(lastHeading!.y);
  await logOut.click();
  await expect(page).toHaveURL(/\/login/);
});
