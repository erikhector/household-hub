import { expect, test, type Page } from "@playwright/test";
import { unique, uniqueId, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// Squirrel Wrapped: the household's year in review. The worker's household
// gets ten one-off calendar events on ten days early in the year Wrapped
// shows, which is past the "check back later" threshold whatever else the
// worker's other specs have added. Past one-off events show on no agenda or
// Home card, so nothing another spec reads changes, and they're removed
// again afterwards. Then the story is stepped through with the buttons, the
// keyboard and a tap, and closed back to Home.

const EVENT_COUNT = 10;

/** The year Wrapped shows today: this year, or last year in January. */
function wrappedYear(now = new Date()): number {
  return now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

const eventIds = Array.from({ length: EVENT_COUNT }, () => uniqueId("wrapped-event"));

test.beforeAll(async () => {
  const year = wrappedYear();
  await withDb(async (client) => {
    for (const [i, id] of eventIds.entries()) {
      await client.query(`INSERT INTO "HouseholdEvent" (id, "householdId", title, date) VALUES ($1, $2, $3, $4::date)`, [
        id,
        E2E_HOUSEHOLD.id,
        unique("Wrapped event"),
        `${year}-01-${String(2 + i).padStart(2, "0")}`,
      ]);
    }
  });
});

test.afterAll(async () => {
  await withDb((client) =>
    client.query(`DELETE FROM "HouseholdEvent" WHERE "householdId" = $1 AND id = ANY($2)`, [E2E_HOUSEHOLD.id, eventIds]),
  );
});

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

function story(page: Page) {
  return page.getByRole("region", { name: `Your ${wrappedYear()} in Squirrel` });
}

/** The current card's "Card N of M", read by screen readers. */
function position(page: Page) {
  return story(page).getByText(/^Card \d+ of \d+$/);
}

test("steps through the year in review with buttons, keys and a tap, then closes", async ({ page }, testInfo) => {
  await page.goto("/dashboard/wrapped");
  const region = story(page);
  await expect(region.getByRole("heading", { name: `Your ${wrappedYear()} in Squirrel` })).toBeVisible();
  await expect(position(page)).toHaveText(/^Card 1 of \d+$/);
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name !== "desktop") await expectTouchTargets(page);

  const next = region.getByRole("button", { name: "Next" });
  const back = region.getByRole("button", { name: "Back" });
  await expectHydrated(next);
  // Nothing before the first card.
  await expect(back).toBeDisabled();

  await next.click();
  await expect(position(page)).toHaveText(/^Card 2 of \d+$/);
  await expect(back).toBeEnabled();

  // The arrow keys do what the buttons do.
  await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText(/^Card 3 of \d+$/);
  await page.keyboard.press("ArrowLeft");
  await expect(position(page)).toHaveText(/^Card 2 of \d+$/);

  await back.click();
  await expect(position(page)).toHaveText(/^Card 1 of \d+$/);

  // A tap on the right half of the card steps forward too.
  const card = region.getByRole("article");
  const box = await card.boundingBox();
  await card.click({ position: { x: box!.width * 0.75, y: 12 } });
  await expect(position(page)).toHaveText(/^Card 2 of \d+$/);

  // The calendar card counts the seeded events (at least: the worker's
  // other specs may have added more).
  const total = Number((await position(page).textContent())!.match(/of (\d+)/)![1]);
  for (let i = 2; i < total; i++) {
    if (await region.getByRole("heading", { name: "On the calendar" }).isVisible()) break;
    await next.click();
    await expect(position(page)).toHaveText(new RegExp(`^Card ${i + 1} of`));
  }
  const events = await region.getByText(/^\d+ events on the household calendar$/).textContent();
  expect(Number(events!.split(" ")[0])).toBeGreaterThanOrEqual(EVENT_COUNT);

  // The last card names the household's squirrel and offers to share it;
  // Next becomes Done there.
  for (let i = 0; i < total; i++) {
    if (await region.getByRole("link", { name: "Done" }).isVisible()) break;
    await next.click();
  }
  await expect(position(page)).toHaveText(new RegExp(`^Card ${total} of ${total}$`));
  await expect(region.getByText("Your household was a")).toBeVisible();
  await expect(region.getByRole("heading", { name: /squirrel$/ })).toBeVisible();
  await expect(region.getByRole("button", { name: /^(Share|Copy text)$/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await region.getByRole("link", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("Escape closes the year in review", async ({ page }) => {
  await page.goto("/dashboard/wrapped");
  const next = story(page).getByRole("button", { name: "Next" });
  await expectHydrated(next);
  await next.click();
  await expect(position(page)).toHaveText(/^Card 2 of \d+$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dashboard$/);
});
