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
    { path: "/verify-email/e2e-bad-token", text: "Link expired" },
    { path: "/unsubscribe/e2e-bad-token", text: "Link not valid" },
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

// UX-142: a rate-limited verify-email visit is titled for what happened, not
// "Link expired". The limit is 10 attempts per token, so the 11th load trips
// it; a fresh random token keeps desktop and mobile runs from sharing a count.
test("verify-email rate limiting is titled 'Too many attempts', not 'Link expired'", async ({
  page,
}) => {
  const token = `e2e-rate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let i = 0; i < 10; i++) {
    await page.goto(`/verify-email/${token}`);
    await expect(page.getByText("Link expired")).toBeVisible();
  }
  await page.goto(`/verify-email/${token}`);
  await expect(page.getByText("Too many attempts", { exact: true })).toBeVisible();
  await expect(page.getByText(/try again later/i)).toBeVisible();
  await expect(page.getByText("Link expired")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

// UX-65: a stranger on a dead URL gets the token pages' status card and a
// way to the landing page, not a "Back to dashboard" that ends at the login.
test("a logged-out 404 uses the status card and leads to the landing page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
  await expect(page.getByRole("link", { name: "Squirrel" }).first()).toBeVisible();
  await expect(page.getByText("Back to dashboard")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Go to Squirrel" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("a logged-out 404 is in Swedish with the Swedish cookie", async ({ page, context, baseURL }) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await page.goto("/no-such-page");
  await expect(page.getByText("Sidan hittades inte")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gå till Squirrel" })).toBeVisible();
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
  const button = page.getByRole("link", { name: "Get started free" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(412);
});

// UX-68: a call to action that navigates is a link to a screen reader, even
// when it's styled as a button.
test("the landing page's calls to action are links, not buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started free" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Get started free" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
});
