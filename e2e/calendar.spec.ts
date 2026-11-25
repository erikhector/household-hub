import { expect, test, type Page } from "@playwright/test";
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
