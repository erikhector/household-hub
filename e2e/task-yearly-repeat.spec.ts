import { expect, test } from "@playwright/test";
import { unique, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import {
  dismissCookieNotice,
  expectHydrated,
  expectRouterPatched,
  waitForDialogHistory,
  waitForSheetClosed,
} from "./ui";

// GAP-84: the Repeat select goes up to a year. A task made through the
// dialog with "Every year (365 days)" names that on its badge, and once
// ticked it is closed until its anchor day comes round 365 days on, so after
// a reload the row reads "Next due" with next year's date.
const ZONE = "Europe/Stockholm";
test.use({ timezoneId: ZONE });

let title = "";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Only this household's row, by its unique title.
test.afterEach(async () => {
  if (!title) return;
  await withDb((client) =>
    client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND title = $2`, [E2E_HOUSEHOLD.id, title]),
  );
});

// The day `offsetDays` after the local day `from` falls on, as the app labels
// a date in another year. Counts calendar days in the zone, like the app.
const dayLabelWithYear = (from: Date, offsetDays: number) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: ZONE,
  }).formatToParts(from);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Noon UTC keeps the shifted date on the same calendar day in UTC.
  const shifted = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + offsetDays, 12));
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    shifted,
  );
};

test("a task set to repeat every year is next due a year after it is done", async ({ page, context }) => {
  title = unique("Change the smoke alarm battery");
  await page.goto("/dashboard/tasks");
  // The server finds the local day from the time_zone cookie.
  await expect
    .poll(async () =>
      (await context.cookies()).some((cookie) => cookie.name === "time_zone" && decodeURIComponent(cookie.value) === ZONE),
    )
    .toBe(true);
  await page.reload();

  // "Add task" opens a dialog, which pushes a history entry (MAINT-68).
  const addTask = page.getByRole("button", { name: "Add task" });
  await expectHydrated(addTask);
  await expectRouterPatched(page);
  await addTask.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Task title" }).fill(title);
  const repeat = dialog.getByRole("combobox", { name: "Repeat" });
  await repeat.click();
  await page.getByRole("option", { name: "Every year (365 days)" }).click();
  await expect(repeat).toContainText("Every year (365 days)");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  const done = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(done).toBeVisible();
  const row = page.getByRole("main").locator("[data-swipe-row]").filter({ hasText: title });
  await expect(row.getByText("Repeats every year (365 days)")).toBeVisible();

  // Tap only once the sheet is gone and the page behind it at rest
  // (MAINT-116). The tick is optimistic (UX-14): wait for its POST before
  // the reload, or the reload can cancel it.
  await waitForSheetClosed(page);
  await expectHydrated(done);
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await done.click();
  const notDone = page.getByRole("checkbox", { name: `Mark ${title} as not done` });
  await expect(notDone).toBeChecked();
  await saved;

  // Count from the anchor the server stored, not the clock now, so a run
  // across local midnight still expects the label the server rendered.
  // Prisma's columns are zoneless UTC, hence AT TIME ZONE.
  const anchorAt = await withDb(async (client) => {
    const { rows } = await client.query(
      `SELECT "recurrenceAnchorAt" AT TIME ZONE 'UTC' AS "anchorAt" FROM "HouseholdTask"
       WHERE "householdId" = $1 AND title = $2`,
      [E2E_HOUSEHOLD.id, title],
    );
    return (rows[0] as { anchorAt: Date | null }).anchorAt;
  });
  expect(anchorAt).not.toBeNull();

  // Reload so the label comes from the server's schedule: still completed,
  // and due again on the anchor day next year, with the year spelled out.
  await waitForDialogHistory(page);
  await page.reload();
  await expect(notDone).toBeChecked();
  await expect(row.getByText(`Next due ${dayLabelWithYear(anchorAt!, 365)}`)).toBeVisible();
});
