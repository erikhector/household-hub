import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice } from "./ui";

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

  // Phone layout: the bar is shown (it's absent from the desktop layout),
  // and the toast ends above its top edge. Polled because the toast slides
  // in from below the screen over ~400 ms.
  const bar = page.locator("nav.fixed.bottom-0");
  if (await bar.isVisible()) {
    await expect
      .poll(async () => {
        const [barBox, toastBox] = await Promise.all([bar.boundingBox(), toast.boundingBox()]);
        return barBox && toastBox ? barBox.y - (toastBox.y + toastBox.height) : -1;
      })
      .toBeGreaterThanOrEqual(0);
  }
});

// UX-18: the copy button awaits the clipboard and says so when it fails,
// instead of toasting "copied" over an empty clipboard.
test("a failed clipboard write shows an error toast, not a success", async ({ page, context, baseURL }) => {
  // On a phone the cookie notice covers the floating primary action (UX-40).
  await dismissCookieNotice(context, baseURL!);
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

// UX-18: Sonner switches to its phone offsets at 600 px but the bottom bar
// shows until 640 px, so a 601-639 px viewport (a large phone in landscape,
// a small tablet) needs the CSS override in globals.css to clear the bar.
test("a toast clears the bottom bar between Sonner's 600 px and the bar's 640 px", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 900 });
  const t = en.profile.swishForm;
  await page.goto("/dashboard/profile");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: t.title }) });
  await form.getByRole("button", { name: t.save, exact: true }).click();
  const toast = page.getByRole("listitem").filter({ hasText: t.saved });
  await expect(toast).toBeVisible();
  const bar = page.locator("nav.fixed.bottom-0");
  await expect(bar).toBeVisible();
  await expect
    .poll(async () => {
      const [barBox, toastBox] = await Promise.all([bar.boundingBox(), toast.boundingBox()]);
      return barBox && toastBox ? barBox.y - (toastBox.y + toastBox.height) : -1;
    })
    .toBeGreaterThanOrEqual(0);
});
