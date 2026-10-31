import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { DASHBOARD_ROUTES, PUBLIC_ROUTES, type UiRoute } from "./routes";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
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
