import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-212 left desktop alone: with a fine pointer the body still pins its
// gradient to the viewport (globals.css), which is what keeps a scrolling
// page seamless there. ux-212.mobile covers the touch fix.
test.use({ storageState: { cookies: [], origins: [] } });

test("the page gradient stays pinned to the viewport on desktop", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/signup");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundAttachment)).toBe("fixed");
});
