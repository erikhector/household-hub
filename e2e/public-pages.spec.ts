import { expect, test } from "@playwright/test";
import { STORAGE_INVENTORY } from "../src/lib/cookie-inventory";
import { dismissCookieNotice, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

// UX-28: the logged-out pages' shared polish. Visual checks of every page in
// both languages are in public.spec.ts; these assert the specific fixes.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the privacy cookie list gives every column room on a phone", async ({ page }) => {
  await page.goto("/privacy#cookies");
  const purposes = page.getByRole("term").filter({ hasText: "Purpose" });
  await expect(purposes.first()).toBeVisible();
  // Each "Purpose" value is a definition under its term, as wide as the card
  // allows, instead of the 2-3 characters the old table column got.
  const widths = await page
    .locator("dd")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThan(150);
  // Human-only page: the list still has exactly one entry per
  // cookie-inventory.ts row, with its name, purpose and duration.
  await expect(page.locator("#cookies li")).toHaveCount(STORAGE_INVENTORY.length);
  for (const entry of STORAGE_INVENTORY) {
    const item = page.locator("#cookies li").filter({ hasText: entry.name }).first();
    await expect(item).toContainText(entry.purpose);
    await expect(item).toContainText(entry.duration);
  }
  await expectNoHorizontalOverflow(page);
});

test("legal pages use sentence case, English body text and full-strength text", async ({
  page,
  context,
  baseURL,
}) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  // The body is English-only, so it says so to screen readers even when the
  // interface is Swedish (WCAG 3.1.2).
  await expect(page.locator("article")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  const section = page.locator("article section > div").first();
  const [text, foreground] = await Promise.all([
    section.evaluate((el) => getComputedStyle(el).color),
    page.locator("h1").evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(text).toBe(foreground);

  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of service" })).toBeVisible();
});

test("reset-password with a bad token shows the status card, not the form", async ({ page }) => {
  await page.goto("/reset-password/e2e-bad-token");
  await expect(page.getByText("Link expired")).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);
  await page.getByRole("link", { name: "Request a new link" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});

test.describe("invalid-link pages share one status card", () => {
  const pages = [
    { path: "/join/e2e-bad-token", text: "Invalid invite" },
    { path: "/share/shopping-list/e2e-bad-token", text: "Link not found" },
    { path: "/reset-password/e2e-bad-token", text: "Link expired" },
    { path: "/verify-email/e2e-bad-token", text: "Verify your email" },
    { path: "/unsubscribe/e2e-bad-token", text: "Weekly digest" },
  ];
  for (const { path, text } of pages) {
    test(path, async ({ page }) => {
      await page.goto(path);
      // verify/unsubscribe only learn the link is bad after their
      // auto-submitted action returns.
      await expect(page.getByText(/invalid|isn't valid|expired/i).first()).toBeVisible();
      await expect(page.getByText(text).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Squirrel" }).first()).toBeVisible();
      await expect(page.locator("main, body").locator("svg.text-destructive")).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test("signup's button names the same thing as its title", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText("Create your household").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create your household" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of service" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy policy" })).toBeVisible();
});

test("the landing page's main button stays on screen in a landscape phone", async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Get started free" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(412);
});
