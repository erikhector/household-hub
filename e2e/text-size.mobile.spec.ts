import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { DASHBOARD_ROUTES, PUBLIC_ROUTES, type UiRoute } from "./routes";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { budgetTag, insertHouseholdCategory, withDb as withBudgetDb } from "./budget-seed";
import { E2E_SHOPPING_LIST, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, LOCALES, setLocaleCookie } from "./ui";

// UX-9: with the root font-size at 200% (Android "Font size", iOS Larger
// Text in the installed app) every rem-sized control doubles while the
// phone stays 412 px wide, so anything built from fixed-width siblings or
// `nowrap` buttons scrolled sideways. Swedish is checked too, its words
// are longer.
test.skip(({ isMobile }) => !isMobile, "text size is a phone setting");

// UX-150: at 200% the bottom bar's labels used to break inside a word
// ("Overvi/ew") and the floating primary action slid under the taller bar.
// A label now stays on one line (truncated, never split), and whatever floats
// above the bar clears the bar's real, measured box.
async function expectBottomBarHolds(page: Page) {
  const nav = page.locator("nav.fixed.bottom-0");
  await expect(nav).toBeVisible();
  const labels = await nav.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("a > span:last-child, button > span:last-child")].map((span) => ({
      text: (span.textContent ?? "").trim(),
      lines: Math.round(span.getBoundingClientRect().height / parseFloat(getComputedStyle(span).lineHeight)),
      hyphens: getComputedStyle(span).hyphens,
      wrap: getComputedStyle(span).overflowWrap,
    })),
  );
  expect(labels.length).toBeGreaterThanOrEqual(5);
  for (const label of labels) {
    expect(label.lines, `"${label.text}" wraps`).toBe(1);
    expect(label.hyphens, `"${label.text}" hyphenates`).toBe("manual");
    expect(label.wrap, `"${label.text}" breaks anywhere`).toBe("normal");
  }
  const navBox = (await nav.boundingBox())!;
  const floating = page.locator("[data-primary-action]");
  for (const box of await Promise.all((await floating.all()).map((el) => el.boundingBox()))) {
    if (!box) continue;
    expect(box.y + box.height, "floating action sits above the bar").toBeLessThanOrEqual(navBox.y + 0.5);
  }
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function expectSurvivesDoubleText(page: Page, route: UiRoute) {
  await page.goto(route.path);
  // After navigation so it survives hydration; the app sizes everything in
  // rem, so one rule on the root is the whole setting.
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
  // A button that wraps its label must grow with it: Button's `max-sm:h-11`
  // beats a bare `h-auto`, which left wrapped text spilling out of a 44 px
  // box. Same rule everywhere, so every visible button is checked.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-slot="button"]')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.scrollHeight > el.clientHeight + 1)
      .map((el) => `${(el.textContent ?? "").trim().slice(0, 40)} (${el.scrollHeight}px > ${el.clientHeight}px)`),
  );
  expect(clipped, "buttons whose wrapped text overflows their box").toEqual([]);
  if (route.path.startsWith("/dashboard")) await expectBottomBarHolds(page);
}

for (const locale of LOCALES) {
  test.describe(`dashboard at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });
    for (const route of DASHBOARD_ROUTES) {
      test(`${route.pattern} has no sideways scroll`, async ({ page }) => {
        await expectSurvivesDoubleText(page, route);
      });
    }
  });

  test.describe(`empty meal week at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test("the first-dinner button clears the bottom bar", async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      // A far-future week nobody plans in, so it is empty for every run.
      await page.goto("/dashboard/meal-planning?week=2032-03-02");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      const first = page.locator("main button[aria-haspopup='dialog']").first();
      await first.scrollIntoViewIfNeeded();
      const [box, navBox] = await Promise.all([first.boundingBox(), page.locator("nav.fixed.bottom-0").boundingBox()]);
      expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y + 0.5);
      await expectBottomBarHolds(page);
    });
  });

  // UX-149: the week switcher's arrows used to shrink under the label and
  // draw on top of it, with the date cut off at the left edge.
  test.describe(`meal planner week switcher at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test("arrows and the week label do not intersect", async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await page.goto("/dashboard/meal-planning");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      const links = page.locator("main a[href*='meal-planning?week=']");
      const label = page.locator("main p.font-heading").first();
      const [a, b, l] = await Promise.all([
        links.first().boundingBox(),
        links.nth(1).boundingBox(),
        label.boundingBox(),
      ]);
      for (const arrow of [a!, b!]) {
        expect(arrow.width).toBeGreaterThanOrEqual(44);
        expect(arrow.height).toBeGreaterThanOrEqual(44);
        const apart = arrow.x + arrow.width <= l!.x + 0.5 || l!.x + l!.width <= arrow.x + 0.5;
        expect(apart, "arrow and label boxes intersect").toBe(true);
      }
      expect(l!.x).toBeGreaterThanOrEqual(0);
      const ellipsized = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(ellipsized, "label text is cut off").toBe(false);
    });
  });

  // The week-picks tray's header ("Picked for this week", its count and
  // "Pick meals") was a non-wrapping row, so in Swedish the button pushed
  // the page sideways once the tray held a pick. The route sweep above only
  // sees whatever this week happens to hold, so this seeds a pick into a
  // far-future week of its own (one per locale, both in the worker's
  // household).
  test.describe(`meal week with picks at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    const week = locale === "sv" ? "2032-08-09" : "2032-08-02";
    const dropWeek = (client: Client) =>
      // The plan's picks go with it.
      client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = $2::date`, [
        E2E_HOUSEHOLD.id,
        week,
      ]);
    test.afterEach(async () => {
      await withClient(dropWeek);
    });
    test("the tray header has no sideways scroll", async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await withClient(async (client) => {
        await dropWeek(client);
        const plan = await client.query<{ id: string }>(
          `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3) RETURNING id`,
          [`e2e-plan-text-size-${E2E_WORKER}-${locale}`, E2E_HOUSEHOLD.id, week],
        );
        await client.query(
          `INSERT INTO "MealPlanPick" (id, "mealPlanId", "freeformName", portions) VALUES ($1, $2, $3, 4)`,
          [`e2e-pick-text-size-${E2E_WORKER}-${locale}`, plan.rows[0].id, `Lasagne ${E2E_WORKER}`],
        );
      });
      await page.goto(`/dashboard/meal-planning?week=${week}`);
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("region", { name: locale === "sv" ? /Veckans val/ : /Picked for this week/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });

  // Home's "Add to list" sits in the Shopping & pantry card's header. A
  // Card clips its overflow, so a button pushed past the card's edge is cut
  // off without scrolling the page, and the route sweep above can't see it:
  // this checks every Home button stays inside its own card.
  test.describe(`Home card buttons at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test("stay inside their card", async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await page.goto("/dashboard");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByRole("main").getByRole("button", { name: locale === "sv" ? "Lägg till på listan" : "Add to list" }),
      ).toBeVisible();
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main [data-slot="card"] [data-slot="button"]')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .filter((el) => {
            const b = el.getBoundingClientRect();
            const c = el.closest<HTMLElement>('[data-slot="card"]')!.getBoundingClientRect();
            return b.left < c.left - 0.5 || b.right > c.right + 0.5;
          })
          .map((el) => (el.textContent ?? "").trim()),
      );
      expect(clipped, "buttons cut off at their card's edge").toEqual([]);
    });
  });

  // UX-160: at 200% in Swedish the budget title broke mid-word, the floating
  // primary pill spanned the width and covered the month switcher, and the
  // shopping list's dock and smart-add icons ate the list and the field.
  test.describe(`budget and shopping list at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    // The element at the centre of `target` must be `target` (or inside it):
    // nothing floats on top of it.
    async function expectUncovered(target: Locator, what: string) {
      await expect(target, `${what} is on screen`).toBeInViewport();
      const covered = await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !top || !(el === top || el.contains(top));
      });
      expect(covered, `${what} is covered by something floating`).toBe(false);
    }

    test("the budget keeps its title, month switcher and a short pill", async ({ page }) => {
      // The pill only exists once there is a category to add a transaction to.
      const catId = `e2e-textsize-cat-${budgetTag()}`;
      await withBudgetDb((client) => insertHouseholdCategory(client, { id: catId, name: "Text size" }));
      try {
        await checkBudget(page);
      } finally {
        await withBudgetDb((client) => client.query(`DELETE FROM "BudgetCategory" WHERE id = $1 AND "householdId" = $2`, [catId, E2E_HOUSEHOLD.id]));
      }
    });

    async function checkBudget(page: Page) {
      await page.goto("/dashboard/budget");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("data-large-text", "");
      const title = page.getByRole("heading", { level: 1 });
      expect(await title.evaluate((el) => getComputedStyle(el).hyphens)).toBe("auto");
      expect(await title.evaluate((el) => el.closest("[lang]")?.getAttribute("lang"))).toBe(locale);
      await expectUncovered(page.getByRole("link", { name: locale === "sv" ? "Föregående månad" : "Previous month" }), "previous month");
      await expectUncovered(page.getByRole("link", { name: locale === "sv" ? "Nästa månad" : "Next month" }), "next month");
      const pill = page.locator("[data-primary-action]").first();
      const [box, viewport] = [await pill.boundingBox(), page.viewportSize()!];
      expect(box!.width, "the pill is capped at 60% of the screen").toBeLessThanOrEqual(viewport.width * 0.6 + 1);
      // Above 150% it is the icon alone, its words still the accessible name.
      // Buttons animate their size (transition-all), so wait for it to settle.
      await expect.poll(async () => (await pill.boundingBox())!.width).toBeLessThanOrEqual(56);
      await expect(pill.getByRole("button")).toHaveAccessibleName(/\S/);
      await expectNoHorizontalOverflow(page);
    }

    test("the list keeps its field, a row and a collapsed dock", async ({ page }) => {
      await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("data-large-text", "");
      // The field keeps room for typing: wider than the icons and Add around it.
      const field = page.getByPlaceholder(locale === "sv" ? /^Lägg till/ : /^Add items/);
      const fieldBox = (await field.boundingBox())!;
      expect(fieldBox.width, "the smart-add field").toBeGreaterThanOrEqual(220);
      const iconButtons = [...(await field.locator("xpath=..").getByRole("button").all()), field.locator("xpath=../following-sibling::button")];
      for (const button of iconButtons) {
        await expect.poll(async () => (await button.boundingBox())!.width, "a smart-add icon").toBeLessThanOrEqual(48);
      }
      // The dock never takes more than a third of the scroller: it is either
      // collapsed to ring + count (no rows to tap) or at most a third of main.
      const dock = page.getByRole("region", { name: locale === "sv" ? "Näst på tur" : "Next up" });
      await expect(dock).toBeVisible();
      const mainHeight = await page.locator("main").evaluate((el) => el.clientHeight);
      const dockHeight = (await dock.boundingBox())!.height;
      const collapsed = (await dock.getAttribute("data-collapsed")) !== null;
      if (collapsed) {
        await expect(dock.getByRole("progressbar")).toBeVisible();
        await expect(dock.getByRole("button")).toHaveCount(0);
      } else {
        expect(dockHeight * 3, "an expanded dock leaves two thirds of main").toBeLessThanOrEqual(mainHeight + 1);
      }
      // A list row can be scrolled clear above the dock.
      const row = page.getByRole("checkbox", { name: /^(Oat milk|Apples)/ }).first();
      await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const dockTop = (await dock.boundingBox())!.y;
      await expect
        .poll(async () => {
          const b = await row.boundingBox();
          return !!b && b.y >= 0 && b.y + b.height <= dockTop;
        }, "a list row stays visible above the dock")
        .toBe(true);
      await expectNoHorizontalOverflow(page);
    });
  });

  // UX-180: a phone card's name used to truncate to one line ("Olive oil…"),
  // and `title` never shows on a touch screen. It now wraps (two lines
  // max), so a 20-character name stays fully readable inside the screen.
  test.describe(`inventory row name at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    const id = `e2e-item-text-size-${E2E_WORKER}-${locale}`;
    const name = locale === "sv" ? "Inlagd kronärtskocka" : "Marinated artichoke";
    const drop = (client: Client) =>
      client.query(`DELETE FROM "InventoryItem" WHERE id = $1 AND "householdId" = $2`, [id, E2E_HOUSEHOLD.id]);
    test.afterEach(async () => {
      await withClient(drop);
    });
    test("wraps in full instead of truncating", async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await withClient(async (client) => {
        await drop(client);
        await client.query(
          `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
           VALUES ($1, $2, $3, 'Pantry', 3, 'pcs', 1, now())`,
          [id, E2E_HOUSEHOLD.id, name],
        );
      });
      await page.goto("/dashboard/inventory");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      const label = page.locator(`p[title="${name}"]`);
      await label.scrollIntoViewIfNeeded();
      await expect(label).toBeVisible();
      const m = await label.evaluate((el) => {
        const row = el.closest("li")!;
        return {
          rowScroll: row.scrollWidth,
          rowClient: row.clientWidth,
          // The name's last line must sit inside the clamped box; the
          // category after it may be clamped away.
          cut: (() => {
            const rects = [...el.querySelector("span")!.getClientRects()];
            return rects[rects.length - 1].bottom > el.getBoundingClientRect().bottom + 1;
          })(),
          lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
          right: Math.max(...[...el.querySelector("span")!.getClientRects()].map((r) => r.right)),
          viewport: window.innerWidth,
        };
      });
      expect(m.rowScroll, "row scrolls sideways").toBe(m.rowClient);
      expect(m.lines, "name wraps rather than truncating").toBeGreaterThan(1);
      expect(m.cut, "name is cut off").toBe(false);
      expect(m.right, "name runs past the screen").toBeLessThanOrEqual(m.viewport);
    });
  });

  test.describe(`public pages at 200% text (${locale})`, () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
      await dismissCookieNotice(context, baseURL!);
    });
    for (const route of PUBLIC_ROUTES) {
      test(`${route.pattern} has no sideways scroll`, async ({ page }) => {
        await expectSurvivesDoubleText(page, route);
      });
    }
  });
}
