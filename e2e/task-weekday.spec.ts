import { expect, test } from "@playwright/test";
import { unique, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, waitForDialogHistory, waitForSheetClosed } from "./ui";

// Weekly days: a whole-weeks repeat can be put on a chosen weekday in the
// task dialog. A new task whose day is still ahead waits under "Upcoming"
// until then, and a tick on it there completes it early.
const ZONE = "Europe/Stockholm";
test.use({ timezoneId: ZONE });

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const titles: string[] = [];

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Only this household's rows, and only the ones this spec made.
test.afterEach(async () => {
  await withDb((client) =>
    client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND title = ANY($2)`, [
      E2E_HOUSEHOLD.id,
      titles.splice(0),
    ]),
  );
});

// The local weekday (0 Sunday … 6 Saturday) `offsetDays` after now in ZONE.
const weekdayIn = (offsetDays: number) => {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: ZONE }).format(new Date());
  return (WEEKDAYS.indexOf(name) + offsetDays) % 7;
};

test("a weekly task put on a later weekday waits under Upcoming, and ticking it there completes it", async ({
  page,
  context,
}) => {
  const title = unique("Put out the bins");
  titles.push(title);

  await page.goto("/dashboard/tasks");
  // The server finds the local day from the time_zone cookie.
  await expect
    .poll(async () =>
      (await context.cookies()).some((cookie) => cookie.name === "time_zone" && decodeURIComponent(cookie.value) === ZONE),
    )
    .toBe(true);
  await page.reload();

  const add = page.getByRole("button", { name: "Add task" });
  // The dialog pushes a history entry, so wait for React and the router's
  // history patch before opening it (MAINT-68).
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Task title" }).fill(title);

  // No day picker until the repeat is whole weeks.
  await expect(dialog.getByRole("combobox", { name: "Day" })).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "Repeat" }).click();
  await page.getByRole("option", { name: "Every 7 days" }).click();
  const day = dialog.getByRole("combobox", { name: "Day" });
  // It starts on today's weekday, the anchor a repeat had before.
  await expect(day).toContainText(WEEKDAYS[weekdayIn(0)]);
  await expect(dialog.getByText("It shows in the list from that day.")).toBeVisible();

  // Two days on: far enough that a run crossing midnight still picks a later day.
  const target = WEEKDAYS[weekdayIn(2)];
  await day.click();
  await page.getByRole("option", { name: target }).click();
  await expect(day).toContainText(target);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await waitForSheetClosed(page);

  // Under "Upcoming", not open: an unticked box, the day on the badge and when it starts.
  const main = page.getByRole("main");
  const box = main.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(box).not.toBeChecked();
  await expect(main.getByText("Upcoming", { exact: true })).toBeVisible();
  await expect(main.getByText(`Repeats every 7 days on ${target}s`)).toBeVisible();
  await expect(main.getByText(/^Starts /).first()).toBeVisible();

  // Saved: it is still upcoming after a reload.
  await waitForDialogHistory(page);
  await page.reload();
  await expect(box).not.toBeChecked();
  await expect(main.getByText("Upcoming", { exact: true })).toBeVisible();

  // The edit dialog shows the chosen day.
  const titleButton = main.getByRole("button", { name: title, exact: true });
  await expectHydrated(titleButton);
  await expectRouterPatched(page);
  await titleButton.click();
  const edit = page.getByRole("dialog", { name: `Edit "${title}"` });
  await expect(edit.getByRole("combobox", { name: "Day" })).toContainText(target);
  await edit.getByRole("button", { name: "Cancel" }).click();
  await waitForSheetClosed(page);

  // A tick there does it early: it moves to Completed and stays done.
  await expectHydrated(box);
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await box.click();
  await expect(main.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await saved;
  await waitForDialogHistory(page);
  await page.reload();
  await expect(main.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
});
