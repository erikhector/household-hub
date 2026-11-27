import { expect, test, type Page } from "@playwright/test";
import { unique, uniqueId, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// Squirrel Wrapped: the household's year in review. The worker's household
// gets ten tasks completed on ten days early in the year Wrapped shows,
// which is past the "check back later" threshold whatever else the worker's
// other specs have added, and three one-off calendar events for the
// calendar card (an event is shown but isn't activity, so it can't lift a
// household out of "check back later" on its own). Both are in January of
// that year, so the tasks sit behind the Tasks page's "Show N older" and
// the events on no agenda or Home card, and both are removed afterwards.
// Then the story is stepped through with the buttons, the keyboard and a
// tap, and closed: back to the page it was opened from, or Home when it was
// the first page. It's modal, so Tab never leaves it.

const TASK_COUNT = 10;
const EVENT_COUNT = 3;

/** The year Wrapped shows today on `timeZone`'s clock: this year, or last
 * year in January. */
function wrappedYearIn(timeZone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return part("month") === 1 ? part("year") - 1 : part("year");
}

// The server reads the year on the viewer's clock: the browser's zone once
// the time_zone cookie is set, UTC before. Around New Year and the end of
// January the two can name different years, so the rows go into each year
// either could show. Noon UTC on 2-11 January is inside that year in every
// zone, and already past by the time Wrapped shows it.
const years = [...new Set([wrappedYearIn("UTC"), wrappedYearIn(Intl.DateTimeFormat().resolvedOptions().timeZone)])];
const januaryNoon = (year: number, i: number) => `${year}-01-${String(2 + i).padStart(2, "0")}T12:00:00Z`;
const taskIds: string[] = [];
const eventIds: string[] = [];

test.beforeAll(async () => {
  await withDb(async (client) => {
    for (const year of years) {
      for (let i = 0; i < TASK_COUNT; i++) {
        const id = uniqueId("wrapped-task");
        taskIds.push(id);
        await client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title, "completedAt") VALUES ($1, $2, $3, $4)`, [
          id,
          E2E_HOUSEHOLD.id,
          unique("Wrapped task"),
          januaryNoon(year, i),
        ]);
      }
      for (let i = 0; i < EVENT_COUNT; i++) {
        const id = uniqueId("wrapped-event");
        eventIds.push(id);
        await client.query(`INSERT INTO "HouseholdEvent" (id, "householdId", title, date) VALUES ($1, $2, $3, $4::date)`, [
          id,
          E2E_HOUSEHOLD.id,
          unique("Wrapped event"),
          januaryNoon(year, i).slice(0, 10),
        ]);
      }
    }
  });
});

test.afterAll(async () => {
  await withDb(async (client) => {
    await client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND id = ANY($2)`, [E2E_HOUSEHOLD.id, taskIds]);
    await client.query(`DELETE FROM "HouseholdEvent" WHERE "householdId" = $1 AND id = ANY($2)`, [E2E_HOUSEHOLD.id, eventIds]);
  });
});

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const STORY_NAME = /^Your \d{4} in Squirrel$/;

function story(page: Page) {
  return page.getByRole("dialog", { name: STORY_NAME });
}

/** Whether keyboard focus is somewhere inside the story. */
function focusInStory(page: Page) {
  return story(page).evaluate((el) => el.contains(document.activeElement));
}

/** The current card's "Card N of M", read by screen readers. */
function position(page: Page) {
  return story(page).getByText(/^Card \d+ of \d+$/);
}

test("steps through the year in review with buttons, keys and a tap, then closes", async ({ page }, testInfo) => {
  await page.goto("/dashboard/wrapped");
  const region = story(page);
  await expect(region.getByRole("heading", { name: STORY_NAME })).toBeVisible();
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
  // Back is disabled on the first card; the focus it held moves on inside
  // the story instead of falling out to <body>.
  await expect(back).toBeDisabled();
  await expect.poll(() => focusInStory(page)).toBe(true);

  // A tap on the right half of the card steps forward too.
  const card = region.getByRole("article");
  const box = await card.boundingBox();
  await card.click({ position: { x: box!.width * 0.75, y: 12 } });
  await expect(position(page)).toHaveText(/^Card 2 of \d+$/);

  // The calendar card counts the seeded events (at least: the worker's
  // other specs may have added more), though they aren't activity.
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
    if (await region.getByRole("button", { name: "Done" }).isVisible()) break;
    await next.click();
  }
  await expect(position(page)).toHaveText(new RegExp(`^Card ${total} of ${total}$`));
  await expect(region.getByText("Your household was a")).toBeVisible();
  await expect(region.getByRole("heading", { name: /squirrel$/ })).toBeVisible();
  await expect(region.getByRole("button", { name: /^(Share|Copy text)$/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Opened as the first page, so there's nothing of Squirrel's to go back
  // to: Close goes Home.
  await region.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a card taller than a short screen scrolls from its own top", async ({ page }) => {
  // A phone on its side at 200% text: the closing card doesn't fit, so it
  // scrolls. The mascot and the "Your household was a" line at its top must
  // be reachable by scrolling up, not pushed above the scroll start by
  // centring (M9).
  await page.setViewportSize({ width: 412, height: 393 });
  await page.goto("/dashboard/wrapped");
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  const region = story(page);
  const next = region.getByRole("button", { name: "Next" });
  await expectHydrated(next);
  const total = Number((await position(page).textContent())!.match(/of (\d+)/)![1]);
  for (let i = 1; i < total; i++) {
    await next.click();
    await expect(position(page)).toHaveText(new RegExp(`^Card ${i + 1} of`));
  }
  const card = region.getByRole("article");
  await expect(region.getByText("Your household was a")).toBeAttached();
  // The check only means something if the card really overflows here, by
  // more than its own padding (a smaller overflow centres into the padding
  // and stays in view whatever the alignment).
  expect(
    await card.evaluate((el) => el.scrollHeight - el.clientHeight > 2 * parseFloat(getComputedStyle(el).paddingTop)),
  ).toBe(true);
  for (const top of [region.getByRole("img", { name: "The Squirrel mascot holding an acorn" }), region.getByText("Your household was a")]) {
    await top.scrollIntoViewIfNeeded();
    // Its top edge is inside the card's visible box (at this size the
    // mascot alone is taller than the box, so only the top is checked).
    const [box, cardBox] = [await top.boundingBox(), await card.boundingBox()];
    expect(box!.y).toBeGreaterThanOrEqual(cardBox!.y);
    expect(box!.y).toBeLessThan(cardBox!.y + cardBox!.height);
  }
});

test("closing goes back to the page it was opened from", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await page.goto("/dashboard/wrapped");
  const close = story(page).getByRole("button", { name: "Close" });
  await expectHydrated(close);
  await close.click();
  await expect(page).toHaveURL(/\/dashboard\/inventory$/);
});

test("keeps keyboard focus inside the story", async ({ page }) => {
  await page.goto("/dashboard/wrapped");
  const region = story(page);
  const next = region.getByRole("button", { name: "Next" });
  await expectHydrated(next);
  await next.focus();
  // Tab past the last control and on round: focus never reaches the
  // sidebar, bottom bar or page hidden behind the story. Past the last
  // control it may leave the page for the browser's own UI (as with a
  // native modal <dialog>), which reads as <body> here; it comes back into
  // the story.
  let insideAgain = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const where = await region.evaluate((el) =>
      el.contains(document.activeElement) ? "story" : document.activeElement === document.body ? "body" : "page",
    );
    expect(where).not.toBe("page");
    if (i > 0 && where === "story") insideAgain = true;
  }
  expect(insideAgain).toBe(true);
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
