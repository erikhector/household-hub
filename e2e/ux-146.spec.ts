import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// UX-146: a failed invite link can be retried in place, and the failure
// doesn't outlive the retry. The first create-invite action is dropped at
// the network (what offline looks like); the second goes through.
test("a failed invite link shows Try again, and retrying shows the link with no error", async ({ page, context, baseURL }, testInfo) => {
  await dismissCookieNotice(context, baseURL!);
  const t = en.household.invite;
  let calls = 0;
  await page.route(
    (url) => url.pathname === "/dashboard/household",
    async (route) => {
      const request = route.request();
      if (request.method() === "POST" && "next-action" in request.headers() && calls++ === 0) {
        return route.abort("failed");
      }
      return route.continue();
    },
  );
  await page.goto("/dashboard/household");
  await page.getByRole("button", { name: t.button }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(t.createFailed)).toBeVisible();
  const retry = dialog.getByRole("button", { name: t.tryAgain });
  await expect(retry).toBeVisible();
  await expect(dialog.getByLabel(t.linkAriaLabel)).toHaveCount(0);
  if (testInfo.project.name.startsWith("mobile")) {
    // The smallest phone we support (M1/M3): no overflow, targets 44px.
    await page.setViewportSize({ width: 320, height: 568 });
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
  }

  await retry.click();
  await expect(dialog.getByLabel(t.linkAriaLabel)).toBeVisible();
  await expect(dialog.getByText(t.createFailed)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: t.tryAgain })).toHaveCount(0);
});
