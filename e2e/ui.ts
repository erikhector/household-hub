import fs from "node:fs";
import path from "node:path";
import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { DIALOG_BACK_PENDING_ATTR } from "@/components/ui/dialog-history";
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

// Console "errors" the browser itself logs about markup we chose on purpose,
// not failures of the app. WebKit (the `iphone` project, as on a real
// iPhone) logs one for the viewport meta's `interactive-widget` key on every
// page: Android Chrome needs it (UX-12, src/app/layout.tsx) and Safari just
// ignores it. Keep this list to exact, explained browser messages.
const BROWSER_NOTICES = [/^Viewport argument key "interactive-widget" not recognized and ignored\.$/];

// Start collecting uncaught page errors and console errors. Call before the
// first navigation; assert on the returned array at the end.
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !BROWSER_NOTICES.some((notice) => notice.test(message.text())))
      errors.push(message.text());
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

// While a sheet is open on a phone, SheetIndent (sheet-indent.tsx) scales
// the page behind it down to 0.94, and once the sheet closes it eases back
// to 1 over 400 ms. Measured inside that window every box is a few percent
// small: straight after a sheet's Add, each 44 px target read 42-43 px and
// failed M3. Waits for the indent's transition to finish. With a sheet still
// open the page stays scaled, but it's inert then and the checks skip it.
async function waitForSheetIndent(page: Page) {
  await page.waitForFunction(() => {
    const indent = document.querySelector('[data-slot="sheet-indent"]');
    return !indent || indent.getAnimations().length === 0;
  });
}

// DESIGN.md rule M3: every tap target is at least 44 x 44 CSS px on phones.
// Measures every visible button, link, input and checkbox/switch/tab/menu
// item. A control passes when its own box is big enough, or when the thing
// a finger actually hits is: an enclosing <label> or link/button (the whole
// row is the target), or an absolutely positioned ::before/::after that
// extends the hit area past a smaller visible control. Links inside running
// text are exempt (WCAG 2.5.8): an <a> whose parent block also holds text of
// its own. Call on every touch project (not desktop); mouse sizing is deliberately
// denser. `min` is the 44px of M3, with 0.5px of slack for sub-pixel layout.
export async function expectTouchTargets(page: Page, min = 44) {
  await waitForSheetIndent(page);
  const small = await page.evaluate((min) => {
    const selector = 'button, a[href], input:not([type="hidden"]), [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="button"], [role="option"]';
    const found: string[] = [];
    const big = (w: number, h: number) => w >= min - 0.5 && h >= min - 0.5;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // Not rendered, or visually hidden (sr-only inputs, skip links): not a
      // target a finger can reach.
      if (style.visibility === "hidden" || style.display === "none" || rect.width <= 1 || rect.height <= 1) continue;
      if (el.closest("[hidden], [aria-hidden='true'], [inert]")) continue;
      if (el.matches("input[disabled], button[disabled]")) continue;
      if (big(rect.width, rect.height)) continue;

      // Enclosing label or interactive ancestor: the whole row is the target.
      const row = el.closest("label, a[href], button, [role='button'], [role='menuitem'], [role='tab']");
      if (row && row !== el) {
        const r = row.getBoundingClientRect();
        if (big(r.width, r.height)) continue;
      }
      // Pseudo-element hit area (e.g. `after:absolute after:-inset-2`).
      let extended = false;
      for (const pseudo of ["::before", "::after"]) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === "none" || ps.position !== "absolute") continue;
        // A stretched pseudo (`inset-*`) can report `auto` for its size on
        // an <input>, so fall back to the box the offsets imply.
        const w = parseFloat(ps.width) || rect.width - parseFloat(ps.left) - parseFloat(ps.right);
        const h = parseFloat(ps.height) || rect.height - parseFloat(ps.top) - parseFloat(ps.bottom);
        if (big(w, h)) extended = true;
      }
      if (extended) continue;
      // Link inside running text. `data-running-text` marks one the parent's
      // own-text test below can't see (a comma-separated list with a single
      // entry has no text node of its own).
      if (el.tagName === "A") {
        if (el.hasAttribute("data-running-text")) continue;
        const parent = el.parentElement;
        const own = Array.from(parent?.childNodes ?? []).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
        if (own) continue;
      }
      const name = el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 30) || el.getAttribute("name") || "";
      found.push(`<${el.tagName.toLowerCase()}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}> "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    return found;
  }, min);
  expect(small, `tap targets under ${min}x${min}px (DESIGN.md M3)`).toEqual([]);
}

// DESIGN.md rule M3, the other half: neighbouring targets are at least 8 px
// apart and never overlap. expectTouchTargets only measures each control on
// its own, so a row of 44 px buttons packed into 24 px slots passed it
// (UX-19). Checks every visible button, link and input inside `scope`
// pairwise; a pair where one contains the other (a button in a label) is
// skipped. Call on touch projects.
export async function expectTargetsApart(scope: Locator, gap = 8) {
  await waitForSheetIndent(scope.page());
  const close = await scope.evaluate((root, gap) => {
    const els = Array.from(root.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), [role="checkbox"], [role="switch"], [role="option"]')).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && style.visibility !== "hidden" && !el.closest("[hidden], [aria-hidden='true']");
    });
    const label = (el: HTMLElement) => el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 20) || el.tagName.toLowerCase();
    const found: string[] = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i];
        const b = els[j];
        if (a.contains(b) || b.contains(a)) continue;
        // The floating primary action (PrimaryAction, UX-40) is a layer over
        // the scrolling page, not a neighbour in it: content passes under it
        // by design, and main's extra bottom padding lets every row scroll
        // out from under it (asserted in large-title.spec.ts).
        if (!!a.closest("[data-primary-action]") !== !!b.closest("[data-primary-action]")) {
          const floating = (a.closest("[data-primary-action]") ?? b.closest("[data-primary-action]"))!;
          if (getComputedStyle(floating).position === "fixed") continue;
        }
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const dx = Math.max(rb.left - ra.right, ra.left - rb.right);
        const dy = Math.max(rb.top - ra.bottom, ra.top - rb.bottom);
        // Apart on either axis by the gap (0.5px of sub-pixel slack).
        if (Math.max(dx, dy) < gap - 0.5) found.push(`"${label(a)}" and "${label(b)}" are ${Math.round(Math.max(dx, dy))}px apart`);
      }
    }
    return found;
  }, gap);
  expect(close, `neighbouring tap targets under ${gap}px apart (DESIGN.md M3)`).toEqual([]);
}

// expectTouchTargets skips anything inside a `hidden` tab panel, and most of
// the budget UI lives in one, so a page's other tabs were never measured
// (UX-19). This measures the open tab, then clicks through every tab of every
// tablist on the page and measures each panel as it opens, then re-selects the
// tab that was open to begin with, so a screenshot taken afterwards shows the
// page's default state.
export async function expectTouchTargetsInTabs(page: Page, min = 44) {
  await expectTouchTargets(page, min);
  const lists = page.getByRole("tablist");
  const listCount = await lists.count();
  for (let l = 0; l < listCount; l++) {
    const tabs = lists.nth(l).getByRole("tab");
    const tabCount = await tabs.count();
    let original = -1;
    for (let t = 0; t < tabCount; t++) {
      const tab = tabs.nth(t);
      if ((await tab.getAttribute("aria-selected")) === "true") {
        original = t;
        continue;
      }
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expectTouchTargets(page, min);
    }
    if (original >= 0) {
      await tabs.nth(original).click();
      await expect(tabs.nth(original)).toHaveAttribute("aria-selected", "true");
    }
  }
}

// Screenshots for humans and the UX scout (autopilot-scout `ux` lens).
// Off unless E2E_SCREENSHOT_DIR is set, so normal runs stay fast and write
// nothing. Named <project>-<locale>-<route>.png so a directory listing
// groups desktop/mobile and en/sv side by side.
export async function saveScreenshot(page: Page, testInfo: TestInfo, locale: Locale, route: UiRoute) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  // From the pattern, not the path, so a seeded id (which differs per
  // worker, e2e/seed-data.ts) doesn't change the file name between runs.
  const slug = route.pattern.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "") || "root";
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

// The planner's meals and the recipe list's recipes are rows that open a
// sheet of labelled actions (Mark as cooked, Edit recipe, …). Taps the
// visible row whose name is exactly `name` (the last one, when an earlier
// row of another spec repeats it) and returns the sheet, which is titled
// with that name.
export async function openRowSheet(page: Page, name: string) {
  await page.getByRole("main").getByText(name, { exact: true }).filter({ visible: true }).last().click();
  const sheet = page.getByRole("dialog", { name, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Waits until every dialog is closed and the history.back() the last one
 * took its entry off with has landed. A dialog closed from the UI (a
 * submit, Undo removing the row it edits) does that back() asynchronously
 * (src/components/ui/dialog-history.ts, which marks <html> until it
 * lands): a page.reload() issued before then races it and comes back
 * net::ERR_ABORTED. Call it before a reload that follows a dialog closing. */
export async function waitForDialogHistory(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute(DIALOG_BACK_PENDING_ATTR);
}

/** UX-49: a delete that offers Undo only reaches the server once its toast
 * closes. Waits for that toast to show and go, and for the request it sends
 * to finish, so a reload after it sees the row gone. */
export async function waitForUndoableDelete(page: Page, message: string | RegExp) {
  const toast = page.getByText(message);
  await expect(toast).toBeVisible();
  // Listen for the delete's Server Action before the toast can close: it goes
  // out the moment the toast times out. waitForLoadState("networkidle") can't
  // stand in for this, since it resolves at once when the page already reached
  // idle during its load, so a reload right after could beat the request and
  // see the state it should have changed as it was (MAINT-60: a prepped
  // portion not yet given back).
  const sent = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
    { timeout: 15_000 },
  );
  await expect(toast).toBeHidden({ timeout: 15_000 });
  await sent;
  await page.waitForLoadState("networkidle");
}

/** page.goto, then waits until React has revealed every streamed Suspense
 * boundary. goto resolves on `load`, but React 19.2 batches the reveals,
 * so on a loaded runner the page can still be showing a loading.tsx
 * skeleton (a pending boundary's `B:` template) while its content waits in
 * a hidden `S:` div outside main. Measuring then gets the skeleton or a
 * null box, and a bare getByText can match the hidden copy as well. Use it
 * before measuring a page's layout. */
export async function gotoRevealed(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector("template[id^='B:'], div[hidden][id^='S:']"));
}

/** Waits until React has hydrated `target`. A click that lands before that
 * does nothing for a control driven by React state (a Base UI menu trigger
 * opens only through its handlers), and under a loaded run goto() can
 * return before hydration. React marks each element it has taken over with
 * a `__reactProps$…` key. Call it before the first click on such a control. */
export async function expectHydrated(target: Locator) {
  await expect
    .poll(() => target.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps"))))
    .toBe(true);
}

/** Waits until Next's app router has patched history.replaceState, which it
 * does in a passive effect after hydration. expectHydrated is not enough
 * before a click that changes history or the URL: a Dialog pushes a history
 * entry when it opens, and if that lands before the router's patch the
 * router's first commit rewrites the entry and the dialog is closed again
 * (MAINT-68: the Add-meal dialog opened and vanished, so the next locator
 * inside it waited out the 30 s timeout). Call it after expectHydrated and
 * before clicking a control that opens a dialog or switches a URL-driven tab. */
export async function expectRouterPatched(page: Page) {
  // "Not native code" is not enough (MAINT-72): src/components/ui/dialog-history.ts
  // wraps replaceState as soon as it is evaluated, before hydration, so the
  // check passed ~100 ms (more under load) before the router's patch landed
  // and the race it guards came back. The router's patch is the one that
  // tests the pushed state for `__NA`, which no other wrapper mentions.
  await expect
    .poll(() => page.evaluate(() => window.history.replaceState.toString().includes("__NA")))
    .toBe(true);
}

/** Opens the meal planner's Recipes tab and waits until it is the open one.
 * The tab bar is server-rendered before it is interactive: under a loaded run
 * goto() returns before React has hydrated it, and a click that lands then
 * does nothing, so the recipes panel stays `hidden` and the next control
 * ("New recipe", the search box) is never found, a 30 s timeout.
 *
 * Hydrated is not enough. The tab is driven by useSearchParams, and the tab
 * click changes the URL with history.replaceState, which Next's app router
 * only patches (so that useSearchParams follows) in a passive effect after
 * hydration. A click in that gap changes the URL and nothing else, and the
 * tab stays unselected. So wait for the tab to be hydrated and replaceState
 * to be patched (no longer native code), click, then assert the tab took,
 * before reaching for anything inside the panel. */
export async function openRecipesTab(page: Page) {
  const tab = page.getByRole("tab", { name: "Recipes" });
  await expectHydrated(tab);
  await expectRouterPatched(page);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Holds every Server Action POST to `path` until release() is called, and
// counts the ones that have come back. Next sends a page's actions one at a
// time, so holding the first one holds the queue behind it too.
export async function holdServerActions(page: Page, path: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let answered = 0;
  const isAction = (request: { method(): string; headers(): Record<string, string> }) =>
    request.method() === "POST" && "next-action" in request.headers();
  // "response", not "requestfinished": the action's streamed RSC body can
  // stay open after the action itself has run and answered.
  page.on("response", (response) => {
    const request = response.request();
    if (isAction(request) && new URL(request.url()).pathname === path) answered++;
  });
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (isAction(route.request())) await gate;
      await route.continue();
    },
  );
  return { release, answered: () => answered };
}

/** Clicks a swipeable row's Edit or Delete the way the current viewport
 * shows it. From `sm` up that's the row's own icon button, named `button`;
 * on a phone those icons are hidden (the row's left swipe shows them) and
 * the row's ⋯, named `menu` (RowActionsMenu), reaches the same button. */
export async function clickRowAction(
  page: Page,
  { button, menu, item }: { button: string; menu: string; item: "Edit" | "Delete" },
) {
  if ((page.viewportSize()?.width ?? 1280) >= 640) {
    await page.getByRole("button", { name: button, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** Budget redesign (Oct 2026): the Setup tab's Bills & income card has one
 * Add button, a menu that asks which kind of amount to add. Opens that menu
 * and picks `item`, which opens the dialog for it (the recurring item, planned
 * bill or planned income dialog, titled as before). The page must already be
 * on the Setup tab (`?tab=manage`). */
export async function addBillOrIncome(
  page: Page,
  item: "Repeats every month or year" | "One-off bill" | "One-off income",
) {
  const add = page
    .getByRole("main")
    .getByRole("region", { name: "Bills & income" })
    .getByRole("button", { name: "Add", exact: true });
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Insights' expenses card leads with the donut and folds every category's
 * row (its limit meter, "vs usual" and link) behind "All categories, with
 * limits" (Oct 2026). Opens it, for a spec about those rows. */
export async function openAllCategories(page: Page) {
  await page.getByRole("main").getByText("All categories, with limits").filter({ visible: true }).click();
}
