import { expect, test, type Page } from "@playwright/test";
import { eventDayLabel } from "@/lib/household-events";
import { unique } from "./db";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  waitForDialogHistory,
  waitForUndoableDelete,
} from "./ui";

// GAP-35: the household calendar. An event added on the calendar page shows
// in its agenda under today and on Home's "Coming up" card; editing it into a
// weekly repeat puts it on the following weeks too; deleting it takes every
// day of it away, with an Undo, and that sticks after a reload.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

/** The agenda group whose heading starts with "Today,". */
function todayGroup(page: Page) {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: /^Today,/ }) });
}

async function openTitle(page: Page, title: string) {
  const button = page.getByRole("main").getByRole("button", { name: title, exact: true }).first();
  await expectHydrated(button);
  await expectRouterPatched(page);
  await button.click();
  const sheet = page.getByRole("dialog", { name: `Edit "${title}"` });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("adds an event, shows it today and on Home, edits it into a weekly repeat and deletes it", async ({ page }) => {
  const title = unique("Dentist");
  const renamed = unique("Swimming");

  // Add, with the date left at its default of today and a start time.
  await page.goto("/dashboard/calendar");
  const add = page.getByRole("button", { name: "Add event" });
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  const addSheet = page.getByRole("dialog", { name: "Add event" });
  await addSheet.getByRole("textbox", { name: "Event" }).fill(title);
  await addSheet.getByLabel("Starts").fill("14:30");
  await addSheet.getByRole("button", { name: "Add", exact: true }).click();
  await waitForDialogHistory(page);

  const todayRow = todayGroup(page).getByRole("button", { name: title, exact: true });
  await expect(todayRow).toBeVisible();
  await expect(todayGroup(page).getByText(/2:30\sPM/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Home's "Coming up" names it and links to the calendar.
  await page.goto("/dashboard");
  const comingUp = page.getByRole("list", { name: "Upcoming events" });
  await expect(comingUp.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Edit: rename it and make it weekly.
  await page.goto("/dashboard/calendar");
  const editSheet = await openTitle(page, title);
  await editSheet.getByRole("textbox", { name: "Event" }).fill(renamed);
  await editSheet.getByRole("combobox", { name: "Repeats" }).click();
  await page.getByRole("option", { name: "Every week" }).click();
  await editSheet.getByRole("button", { name: "Save", exact: true }).click();
  await waitForDialogHistory(page);

  const renamedRows = page.getByRole("main").getByRole("button", { name: renamed, exact: true });
  await expect(todayGroup(page).getByRole("button", { name: renamed, exact: true })).toBeVisible();
  // Today and at least the next seven weeks of the 60-day agenda.
  await expect.poll(() => renamedRows.count()).toBeGreaterThanOrEqual(8);
  await expect(page.getByRole("main").getByRole("button", { name: title, exact: true })).toHaveCount(0);

  await page.reload();
  await expect(todayGroup(page).getByRole("button", { name: renamed, exact: true })).toBeVisible();

  // Delete from the sheet: every week of it goes at once, with an Undo.
  const deleteSheet = await openTitle(page, renamed);
  await deleteSheet.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(renamedRows).toHaveCount(0);
  await waitForUndoableDelete(page, `Deleted "${renamed}"`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await expect(renamedRows).toHaveCount(0);
});

test("Undo brings a deleted event back", async ({ page }) => {
  const title = unique("Parents evening");

  await page.goto("/dashboard/calendar");
  const add = page.getByRole("button", { name: "Add event" });
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  const addSheet = page.getByRole("dialog", { name: "Add event" });
  await addSheet.getByRole("textbox", { name: "Event" }).fill(title);
  await addSheet.getByRole("button", { name: "Add", exact: true }).click();
  await waitForDialogHistory(page);

  const row = todayGroup(page).getByRole("button", { name: title, exact: true });
  await expect(row).toBeVisible();
  // An event with no time is all day.
  await expect(todayGroup(page).getByText("All day").first()).toBeVisible();

  const sheet = await openTitle(page, title);
  await sheet.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();
  await page.reload();
  await expect(row).toBeVisible();
});

// GAP-91: past the 60-day agenda.

/** `YYYY-MM-DD` of the day `days` from today, in the browser's (this machine's) zone. */
function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Adds a one-off event on `date` from the calendar page, and returns its day's heading. */
async function addEventOn(page: Page, title: string, date: string) {
  const add = page.getByRole("button", { name: "Add event" });
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  const addSheet = page.getByRole("dialog", { name: "Add event" });
  await addSheet.getByRole("textbox", { name: "Event" }).fill(title);
  await addSheet.getByLabel("Date").fill(date);
  await addSheet.getByRole("button", { name: "Add", exact: true }).click();
  await waitForDialogHistory(page);
  // The toast and the agenda's heading name the day the same way.
  return eventDayLabel(date, "en", new Date().getFullYear());
}

function dayGroup(page: Page, heading: string) {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
}

test("an event 90 days ahead says where it went, and Show later brings it into the agenda", async ({ page }) => {
  const title = unique("Wedding");
  const date = dayFromToday(90);

  await page.goto("/dashboard/calendar");
  const heading = await addEventOn(page, title, date);

  // Past the 60 days on the page: the toast names the day instead.
  await expect(page.locator("[data-sonner-toast]").getByText(`Saved "${title}" for ${heading}`)).toBeVisible();
  const row = dayGroup(page, heading).getByRole("button", { name: title, exact: true });
  await expect(row).toHaveCount(0);

  const showLater = page.getByRole("button", { name: "Show later" });
  await expectHydrated(showLater);
  await expectRouterPatched(page);
  await showLater.click();
  await expect(page).toHaveURL(/[?&]until=\d{4}-\d{2}-\d{2}/);
  await expect(row).toBeVisible();
  await expect(page.getByRole("main").getByText("The next 120 days.")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The extended agenda is the URL's, so it survives a reload.
  await page.reload();
  await expect(row).toBeVisible();
});

test("the toast's Show opens the agenda as far as the saved day", async ({ page }) => {
  const title = unique("Passport renewal");
  const date = dayFromToday(200);

  await page.goto("/dashboard/calendar");
  const heading = await addEventOn(page, title, date);

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: `Saved "${title}" for ${heading}` });
  await toast.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]until=${date}`));
  await expect(dayGroup(page, heading).getByRole("button", { name: title, exact: true })).toBeVisible();
});
