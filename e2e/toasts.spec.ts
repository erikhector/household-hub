import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";

// The Toaster (src/components/ui/sonner.tsx) tints outcome toasts: a
// success toast is green text (--success) on a pale green, not the neutral
// popover. Driven through a real save — the profile's Swish number form,
// resubmitted with whatever it already holds, so the shared seeded user is
// left exactly as it was.
test("a success toast is tinted with the success colour", async ({ page }) => {
  const t = en.profile.swishForm;
  await page.goto("/dashboard/profile");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: t.title }) });
  await form.getByRole("button", { name: t.save, exact: true }).click();

  const toast = page.getByRole("listitem").filter({ hasText: t.saved });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast).toHaveAttribute("data-rich-colors", "true");

  // Resolve the tokens the way the browser does, then compare: the toast's
  // text is --success and its background is not the plain popover.
  const expected = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--success)";
    probe.style.backgroundColor = "var(--popover)";
    document.body.append(probe);
    const { color, backgroundColor } = getComputedStyle(probe);
    probe.remove();
    return { color, popover: backgroundColor };
  });
  await expect(toast).toHaveCSS("color", expected.color);
  const background = await toast.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe(expected.popover);
});

// UX-18: on a phone the dashboard's fixed bottom bar owns the bottom edge,
// so a toast must sit above it instead of covering the navigation.
test("a toast clears the bottom navigation bar on phones", async ({ page }) => {
  const t = en.profile.swishForm;
  await page.goto("/dashboard/profile");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: t.title }) });
  await form.getByRole("button", { name: t.save, exact: true }).click();
  const toast = page.getByRole("listitem").filter({ hasText: t.saved });
  await expect(toast).toBeVisible();

  const barBox = await page.locator("nav.fixed.bottom-0").boundingBox();
  const toastBox = await toast.boundingBox();
  if (!toastBox) throw new Error("toast has no box");
  if (barBox) {
    // Phone layout: the bar is shown, and the toast ends above its top edge.
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(barBox.y);
  }
});

// UX-18: the copy button awaits the clipboard and says so when it fails,
// instead of toasting "copied" over an empty clipboard.
test("a failed clipboard write shows an error toast, not a success", async ({ page }) => {
  const t = en.household.invite;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
      configurable: true,
    });
  });
  await page.goto("/dashboard/household");
  await page.getByRole("button", { name: t.button }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(t.linkAriaLabel)).toBeVisible();
  await dialog.getByRole("button", { name: t.copy, exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: t.copyFailedToast })).toBeVisible();
  await expect(page.getByText(t.copiedToast)).toHaveCount(0);
});
