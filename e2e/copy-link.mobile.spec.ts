import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";

// UX-18: on a phone with the Web Share API the copy row gains a Share
// button, and dismissing the share sheet (an AbortError) is a choice, not
// an error. Phone-only: the button needs a coarse pointer.
test("the Share button hands the link to the share sheet; cancelling shows no toast", async ({ page }) => {
  const t = en.household.invite;
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.share = (data) => {
      (window as unknown as { shared: unknown[] }).shared.push(data);
      return Promise.reject(new DOMException("cancelled", "AbortError"));
    };
  });
  await page.goto("/dashboard/household");
  await page.getByRole("button", { name: t.button }).click();
  const dialog = page.getByRole("dialog");
  const field = dialog.getByLabel(t.linkAriaLabel);
  await expect(field).toBeVisible();
  // The read-only field keeps a usable width beside Copy and Share.
  expect((await field.boundingBox())!.width).toBeGreaterThanOrEqual(190);

  await dialog.getByRole("button", { name: t.share, exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared.length)).toBe(1);
  await expect(page.getByRole("listitem").filter({ hasText: t.copyFailedToast })).toHaveCount(0);
});
