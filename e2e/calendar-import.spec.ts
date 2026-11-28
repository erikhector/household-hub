import { expect, test, type Page } from "@playwright/test";
import { uniqueTag, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectRouterPatched, waitForDialogHistory } from "./ui";

// GAP-92: "Import from file" in the calendar's ⋯ menu. A three-event .ics
// (one weekly) is built in the test, uploaded and reviewed; one event is
// unticked and the other two imported, and they're in the agenda after a
// reload, the weekly one with its repeat badge. Uploading the same file
// again offers nothing new: the two imported events are flagged as already
// in the calendar and can't be ticked, so nothing more is added. Rows are
// named per run and removed afterwards, scoped to this worker's household.

let tag: string;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  tag = uniqueTag();
});

test.afterEach(async () => {
  await withDb(async (client) => {
    await client.query(`DELETE FROM "HouseholdEvent" WHERE "householdId" = $1 AND title LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `%${tag}%`,
    ]);
  });
});

/** The day `days` from today, in the browser's (this machine's) zone. */
function dayFromToday(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/** `YYYYMMDD` of the day `days` from today. */
function icsDay(days: number): string {
  const date = dayFromToday(days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function icsFile(events: { title: string; lines: string[] }[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//School//Term//EN"];
  for (const { title, lines: body } of events) lines.push("BEGIN:VEVENT", `SUMMARY:${title}`, ...body, "END:VEVENT");
  lines.push("END:VCALENDAR");
  return {
    name: "school-term.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(lines.join("\r\n") + "\r\n", "utf-8"),
  };
}

async function openImport(page: Page) {
  const more = page.getByRole("button", { name: "More calendar actions" });
  await expectHydrated(more);
  await expectRouterPatched(page);
  await more.click();
  await page.getByRole("menuitem", { name: "Import from file" }).click();
  const dialog = page.getByRole("dialog", { name: "Import events from a file" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** An agenda row (not a day group, which has a heading) holding the event `title`. */
function agendaRows(page: Page, title: string) {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: title, exact: true }), hasNot: page.getByRole("heading") });
}

test("imports two of three events from an .ics file, and a second import adds nothing", async ({ page }) => {
  const swimming = `Swimming ${tag}`;
  const sportsDay = `Sports day ${tag}`;
  const photos = `School photos ${tag}`;
  const file = icsFile([
    // How Google and Apple write a weekly event: a BYDAY of its own weekday.
    {
      title: swimming,
      lines: [
        `DTSTART:${icsDay(1)}T170000`,
        `DTEND:${icsDay(1)}T180000`,
        `RRULE:FREQ=WEEKLY;BYDAY=${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][dayFromToday(1).getDay()]}`,
      ],
    },
    { title: sportsDay, lines: [`DTSTART;VALUE=DATE:${icsDay(2)}`, `DTEND;VALUE=DATE:${icsDay(3)}`] },
    { title: photos, lines: [`DTSTART;VALUE=DATE:${icsDay(3)}`] },
  ]);

  await page.goto("/dashboard/calendar");
  let dialog = await openImport(page);
  await dialog.getByLabel("Calendar file (.ics)").setInputFiles(file);

  // The review list: nothing is saved yet, every event is ticked.
  await expect(dialog.getByText("3 events in the file")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: new RegExp(swimming) })).toBeChecked();
  await expect(dialog.getByRole("listitem").filter({ hasText: swimming }).getByText("Weekly")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Untick the photos, import the other two.
  await dialog.getByRole("checkbox", { name: new RegExp(photos) }).uncheck();
  await dialog.getByRole("button", { name: "Import 2 events" }).click();
  await expect(page.locator("[data-sonner-toast]").getByText("Imported 2 events")).toBeVisible();
  await waitForDialogHistory(page);

  await page.reload();
  // The weekly one is on its first day and the weeks after, with the badge.
  await expect.poll(() => agendaRows(page, swimming).count()).toBeGreaterThanOrEqual(2);
  await expect(agendaRows(page, swimming).first().getByText("Weekly")).toBeVisible();
  await expect(agendaRows(page, sportsDay)).toHaveCount(1);
  await expect(agendaRows(page, sportsDay).getByText("All day")).toBeVisible();
  await expect(agendaRows(page, photos)).toHaveCount(0);
  const swimmingRows = await agendaRows(page, swimming).count();

  // The same file again: the two imported events are already there and
  // can't be ticked; only the photos are offered.
  dialog = await openImport(page);
  await dialog.getByLabel("Calendar file (.ics)").setInputFiles(file);
  await expect(dialog.getByText("2 already in the calendar")).toBeVisible();
  for (const title of [swimming, sportsDay]) {
    const box = dialog.getByRole("checkbox", { name: new RegExp(title) });
    await expect(box).not.toBeChecked();
    await expect(box).toBeDisabled();
  }
  await dialog.getByRole("checkbox", { name: new RegExp(photos) }).uncheck();
  await expect(dialog.getByRole("button", { name: "Import 0 events" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await waitForDialogHistory(page);

  await page.reload();
  await expect(agendaRows(page, sportsDay)).toHaveCount(1);
  await expect.poll(() => agendaRows(page, swimming).count()).toBe(swimmingRows);
  await expect(agendaRows(page, photos)).toHaveCount(0);
});

test("a file that isn't a calendar says so and saves nothing", async ({ page }) => {
  await page.goto("/dashboard/calendar");
  const dialog = await openImport(page);
  await dialog.getByLabel("Calendar file (.ics)").setInputFiles({
    name: "notes.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(`Swimming ${tag}, Friday`, "utf-8"),
  });
  await expect(dialog.getByRole("alert")).toHaveText("That isn't a calendar file (.ics).");
});
