import { expect, test } from "@playwright/test";
import { COOKIE_NOTICE_COOKIE } from "@/lib/cookie-inventory";
import { en } from "@/lib/i18n/dictionaries/en";

// The informational cookie notice (src/components/legal/cookie-notice.tsx).
// The smoke and public specs pre-acknowledge it so it doesn't cover their
// screenshots and layout checks, so its own behaviour is covered here, on
// both viewports: it shows on a first visit, "Got it" hides it, and it
// stays hidden after a reload (the acknowledgement cookie stuck).
test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ["/login", "/privacy"]) {
  test(`the cookie notice on ${path} can be dismissed for good`, async ({ page, context }) => {
    await page.goto(path);
    const notice = page.getByRole("region", { name: en.cookieNotice.title });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("link", { name: en.cookieNotice.learnMore })).toHaveAttribute(
      "href",
      "/privacy#cookies",
    );

    await notice.getByRole("button", { name: en.cookieNotice.dismiss }).click();
    await expect(notice).toHaveCount(0);
    // A document.cookie write reaches Chromium's cookie store
    // asynchronously, so a reload right after the click can go out without
    // it (seen under parallel load). Wait until the browser has it.
    await expect
      .poll(async () => (await context.cookies()).some((cookie) => cookie.name === COOKIE_NOTICE_COOKIE))
      .toBe(true);
    await page.reload();
    await expect(page.getByRole("region", { name: en.cookieNotice.title })).toHaveCount(0);
  });
}
