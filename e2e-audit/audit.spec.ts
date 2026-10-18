import fs from "node:fs";
import path from "node:path";
import { test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { DASHBOARD_ROUTES, PUBLIC_ROUTES, type UiRoute } from "../e2e/routes";
import { dismissCookieNotice } from "../e2e/ui";

// The design-audit sweep. See playwright.audit.config.ts for what each
// project looks at and why. Every route in e2e/routes.ts is visited; for
// each one this saves a full-height screenshot and records what the DOM
// says about it in `<project>.json`:
//
// - `overflow`: the document or `main` wider than the screen;
// - `offscreen`: elements poking past the right edge with no scrolling
//   ancestor to reach them;
// - `clipped`: leaf text cut off by overflow with no `title` to read it;
// - `tinyText`: leaf text under 12 px;
// - `smallFields`: fields under 16 px on a phone (iOS zooms on focus);
// - `errors`: console and page errors.
//
// The `dialogs-*` projects instead open every popup trigger on the page,
// screenshot the popup, measure it (off-screen, overflow, targets under
// 44 px, field sizes and autofill hints) and check that Escape
// closes it. It never clicks anything that isn't a popup trigger, so it
// changes no data.
//
// Nothing here asserts. Findings are for a person (or the `ux` scout) to
// judge against DESIGN.md; the ones that are always bugs already have
// their own failing checks in e2e/.

const OUT = process.env.E2E_AUDIT_DIR ?? "test-results/audit";
const results: Record<string, unknown>[] = [];

const slug = (route: UiRoute) => route.pattern.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "") || "root";

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${test.info().project.name}.json`), JSON.stringify(results, null, 1));
});

// A fresh context for the logged-out pages, carrying over the project's
// device, theme and text-size settings but not the session.
async function publicPage(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({ ...testInfo.project.use, storageState: undefined });
  return prepare(await context.newPage(), testInfo);
}

async function prepare(page: Page, testInfo: TestInfo) {
  const context = page.context();
  await dismissCookieNotice(context, String(testInfo.project.use.baseURL));
  // next-themes reads its stored choice before the system setting, so set
  // it outright rather than relying on colorScheme alone.
  if (testInfo.project.name === "light") await context.addInitScript(() => localStorage.setItem("theme", "light"));
  if (testInfo.project.name === "text-200") {
    await context.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.setProperty("font-size", "200%", "important");
      });
    });
  }
  return page;
}

for (const { route, loggedIn } of [
  ...DASHBOARD_ROUTES.map((route) => ({ route, loggedIn: true })),
  ...PUBLIC_ROUTES.map((route) => ({ route, loggedIn: false })),
]) {
  test(`audit ${route.pattern}`, async ({ page, browser }, testInfo) => {
    const project = testInfo.project.name;
    const p = loggedIn ? await prepare(page, testInfo) : await publicPage(browser, testInfo);
    const errors: string[] = [];
    p.on("pageerror", (error) => errors.push(error.message));
    p.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await p.goto(route.path);
    await p.waitForLoadState("networkidle");

    if (project.startsWith("dialogs")) {
      await sweepPopups(p, route, project);
      return;
    }
    await fullScreenshot(p, path.join(OUT, `${project}-${slug(route)}.png`));
    results.push({ route: route.pattern, errors, ...(await probePage(p)) });
  });
}

// On a phone only `main` scrolls, so grow the viewport by main's hidden
// height for the shot (as saveScreenshot in e2e/ui.ts does), capped so a
// very long page doesn't produce an image no one can open.
async function fullScreenshot(page: Page, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const viewport = page.viewportSize();
  const hidden = await page.evaluate(() => {
    const main = document.querySelector("main");
    return main ? main.scrollHeight - main.clientHeight : 0;
  });
  if (viewport && hidden > 0) await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height + hidden, 8000) });
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  if (viewport && hidden > 0) await page.setViewportSize(viewport);
}

function probePage(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const phone = viewportWidth < 640;
    const found = { overflow: [] as string[], offscreen: [] as string[], clipped: [] as string[], tinyText: [] as string[], smallFields: [] as string[] };
    const doc = document.documentElement;
    const main = document.querySelector("main");
    if (doc.scrollWidth > doc.clientWidth + 1) found.overflow.push(`document ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    if (main && main.scrollWidth > main.clientWidth + 1) found.overflow.push(`main ${main.scrollWidth}px > ${main.clientWidth}px`);
    const describe = (el: Element) => `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 40)}"`;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest("[aria-hidden='true']")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right > viewportWidth + 1 && found.offscreen.length < 8) {
        let scroller = false;
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX)) {
            scroller = true;
            break;
          }
        }
        if (!scroller) found.offscreen.push(`${describe(el)} right=${Math.round(rect.right)}px`);
      }
      const leafText = el.children.length === 0 && (el.textContent ?? "").trim().length > 0;
      // `sr-only` text is clipped on purpose.
      const srOnly = rect.width <= 1 || style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
      if (leafText && !srOnly && el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(style.overflowX) && !el.closest("[title]") && found.clipped.length < 15) {
        found.clipped.push(describe(el));
      }
      if (leafText && !srOnly && parseFloat(style.fontSize) < 12 && found.tinyText.length < 8) found.tinyText.push(`${describe(el)} ${style.fontSize}`);
      if (phone && el.matches("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select") && parseFloat(style.fontSize) < 16) {
        found.smallFields.push(`${el.getAttribute("name") || el.id || describe(el)} ${style.fontSize}`);
      }
    }
    return found;
  });
}

async function sweepPopups(page: Page, route: UiRoute, project: string) {
  const triggers = "main [aria-haspopup]:visible, main [aria-expanded]:visible, header [aria-haspopup]:visible, nav [aria-haspopup]:visible";
  const count = Math.min(await page.locator(triggers).count(), 25);
  for (let i = 0; i < count; i++) {
    // A trigger that navigated (a link styled as a menu button) leaves the
    // page; come back so the indexes still line up.
    if (new URL(page.url()).pathname !== new URL(route.path, page.url()).pathname) {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
    }
    const trigger = page.locator(triggers).nth(i);
    if (!(await trigger.count())) continue;
    const name = ((await trigger.getAttribute("aria-label")) || (await trigger.innerText().catch(() => "")) || `trigger ${i}`)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40);
    try {
      await trigger.scrollIntoViewIfNeeded({ timeout: 2000 });
      await trigger.click({ timeout: 3000 });
    } catch {
      results.push({ route: route.pattern, trigger: name, couldNotOpen: true });
      continue;
    }
    await page.waitForTimeout(450);
    const popup = await probePopup(page);
    const file = `${project}-${slug(route)}--${i}-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}.png`;
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, file), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const stillOpen = await page.locator("[role=dialog]:visible, [role=alertdialog]:visible, [role=menu]:visible, [role=listbox]:visible").count();
    results.push({ route: route.pattern, trigger: name, file, popup, escapeCloses: stillOpen === 0 });
    if (stillOpen) {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
    }
  }
}

function probePopup(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const visible = (node: HTMLElement) => !node.closest("[aria-hidden='true']") && node.getBoundingClientRect().width > 1;
    const smallTargets = Array.from(el.querySelectorAll<HTMLElement>("button, a[href], input, [role=option], [role=menuitem], [role=checkbox]"))
      .filter((node) => visible(node) && !node.closest("label"))
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 43.5 || box.height < 43.5)
      .map(({ node, box }) => `"${(node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 25)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
    const fields = Array.from(el.querySelectorAll<HTMLInputElement>("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea"))
      .filter(visible)
      .map((field) => ({
        name: field.name || field.id,
        type: field.type,
        fontSize: getComputedStyle(field).fontSize,
        inputMode: field.inputMode,
        autoComplete: field.getAttribute("autocomplete") ?? "",
        enterKeyHint: field.enterKeyHint,
      }));
    return {
      // Fields under 16 px only matter here: iOS zooms on focus on phones.
      phone: window.innerWidth < 640,
      role: el.getAttribute("role"),
      title: el.getAttribute("aria-label") || el.querySelector("h2")?.textContent || "",
      offViewport: rect.bottom > window.innerHeight + 1 || rect.right > window.innerWidth + 1 || rect.left < -1 || rect.top < -1,
      overflowX: el.scrollWidth > el.clientWidth + 1,
      smallTargets: smallTargets.slice(0, 12),
      fields,
    };
  });
}
