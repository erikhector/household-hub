import fs from "node:fs";
import path from "node:path";
import { expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { COOKIE_NOTICE_COOKIE } from "@/lib/cookie-inventory";
import type { UiRoute } from "./routes";

// Shared checks for the UI suites (smoke.spec.ts, public.spec.ts). Each
// spec runs once per Playwright project, so every check here runs on both
// the desktop and the mobile viewport (playwright.config.ts).

export const LOCALES = ["en", "sv"] as const;
export type Locale = (typeof LOCALES)[number];

// Logged out, the locale is picked by the `locale` cookie
// (src/lib/i18n/locales.ts), not by URL, so switching a whole context to
// Swedish is one cookie. Signed-in pages use the account's language
// instead, which is why smoke.spec.ts logs in as a Swedish user for sv.
export async function setLocaleCookie(context: BrowserContext, baseURL: string, locale: Locale) {
  await context.addCookies([{ name: "locale", value: locale, url: baseURL }]);
}

// Pre-acknowledge the cookie notice (src/components/legal/cookie-notice.tsx)
// the same way its "Got it" button does. It's a fixed overlay on every page
// of a fresh context, so without this every screenshot has it covering the
// bottom of the page, and a layout check measures the notice instead of the
// page. The notice itself is covered by cookie-notice.spec.ts.
export async function dismissCookieNotice(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: COOKIE_NOTICE_COOKIE, value: "1", url: baseURL }]);
}

// Start collecting uncaught page errors and console errors. Call before the
// first navigation; assert on the returned array at the end.
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

// Visit a route and assert it rendered: no HTTP error, landed where
// expected, no error boundary, and nothing wider than the viewport.
export async function expectRendersCleanly(page: Page, route: UiRoute) {
  const response = await page.goto(route.path);
  expect(response?.status(), `HTTP status for ${route.path}`).toBeLessThan(400);
  await expect(page).toHaveURL(route.finalPath ?? new RegExp(`${escape(route.path)}$`));
  // The app-level error boundary (src/app/error.tsx) replaces the page on
  // a render crash; its title is the tell.
  await expect(page.getByText(/something went wrong|något gick fel/i)).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
}

// A phone-width layout bug usually shows up as something wider than the
// screen: a long word, a fixed-width table, a row of buttons that doesn't
// wrap. On desktop the document is what scrolls; on a phone the dashboard
// shell pins itself to the viewport and only `main` scrolls
// (src/app/dashboard/layout.tsx), so both are checked. 1px of slack for
// sub-pixel rounding.
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const found: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) found.push(`document ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    const main = document.querySelector("main");
    if (main && main.scrollWidth > main.clientWidth + 1) found.push(`main ${main.scrollWidth}px > ${main.clientWidth}px`);
    return found;
  });
  expect(overflow, "content wider than the viewport (horizontal scroll)").toEqual([]);
}

// Screenshots for humans and the UX scout (autopilot-scout `ux` lens).
// Off unless E2E_SCREENSHOT_DIR is set, so normal runs stay fast and write
// nothing. Named <project>-<locale>-<route>.png so a directory listing
// groups desktop/mobile and en/sv side by side.
export async function saveScreenshot(page: Page, testInfo: TestInfo, locale: Locale, route: UiRoute) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  const slug = route.path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-") || "root";
  const file = path.join(dir, `${testInfo.project.name}-${locale}-${slug}.png`);
  fs.mkdirSync(dir, { recursive: true });

  // On a phone only `main` scrolls, so a plain fullPage screenshot stops at
  // the fold. Grow the viewport by main's hidden height for the shot (the
  // shell is sized with h-dvh, so main grows with it), then put it back.
  const viewport = page.viewportSize();
  const hidden = await page.evaluate(() => {
    const main = document.querySelector("main");
    return main ? main.scrollHeight - main.clientHeight : 0;
  });
  if (viewport && hidden > 0) await page.setViewportSize({ width: viewport.width, height: viewport.height + hidden });
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  if (viewport && hidden > 0) await page.setViewportSize(viewport);
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
