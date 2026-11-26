import { expect, test } from "@playwright/test";
import { unique, uniqueId, withDb } from "./db";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  waitForDialogHistory,
} from "./ui";

// GAP-88a: day-ahead reminders for calendar events. A member picks "The
// morning of" in the event sheet and it's there when the sheet reopens; a
// member turns on calendar reminders in Profile; the scheduled sync
// (/api/cron/sync-notifications, with the CRON_SECRET playwright.config.ts
// gives the server) then claims one send per recipient and occurrence, and
// never for another household's event. The seeded users have no push
// devices, so nothing actually reaches a browser: the claim row
// (EventReminderSend), written before the push, is what's checked, and with
// no device zone the member's day is the UTC date.
const CRON_SECRET = process.env.CRON_SECRET || "e2e-cron-secret";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a reminder picked in the event sheet saves and shows on reopen", async ({ page }) => {
  const title = unique("Birthday");

  try {
    await page.goto("/dashboard/calendar");
    const add = page.getByRole("button", { name: "Add event" });
    await expectHydrated(add);
    await expectRouterPatched(page);
    await add.click();
    const addSheet = page.getByRole("dialog", { name: "Add event" });
    await addSheet.getByRole("textbox", { name: "Event" }).fill(title);
    const reminder = addSheet.getByRole("combobox", { name: "Reminder" });
    await expect(reminder).toHaveText(/No reminder/);
    await reminder.click();
    await page.getByRole("option", { name: "The morning of" }).click();
    await expect(reminder).toHaveText(/The morning of/);
    await expectNoHorizontalOverflow(page);
    await addSheet.getByRole("button", { name: "Add", exact: true }).click();
    await waitForDialogHistory(page);

    await page.reload();
    const row = page.getByRole("main").getByRole("button", { name: title, exact: true }).first();
    await expectHydrated(row);
    await expectRouterPatched(page);
    await row.click();
    const editSheet = page.getByRole("dialog", { name: `Edit "${title}"` });
    await expect(editSheet.getByRole("combobox", { name: "Reminder" })).toHaveText(/The morning of/);
  } finally {
    await withDb((client) =>
      client.query(`DELETE FROM "HouseholdEvent" WHERE "householdId" = $1 AND title = $2`, [E2E_HOUSEHOLD.id, title]),
    );
  }
});

test("turning on calendar reminders sends each due reminder once, only for the household's own events", async ({
  page,
  request,
}) => {
  const eventId = uniqueId("e2e-event-reminder");
  const otherHousehold = uniqueId("e2e-event-reminder-other");
  const otherEventId = uniqueId("e2e-event-reminder-other-event");

  await withDb(async (client) => {
    const runCron = async () => {
      const response = await request.get("/api/cron/sync-notifications", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      expect(response.status()).toBe(200);
    };
    const sends = async (id: string) =>
      (await client.query(`SELECT 1 FROM "EventReminderSend" WHERE "userId" = $1 AND "eventId" = $2`, [E2E_USER.id, id]))
        .rowCount;
    const reset = async () => {
      await client.query(`DELETE FROM "HouseholdEvent" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, eventId]);
      await client.query(`DELETE FROM "Household" WHERE id = $1`, [otherHousehold]);
      await client.query(`UPDATE "User" SET "eventReminderNudge" = false WHERE id = $1`, [E2E_USER.id]);
    };

    try {
      await reset();
      // Today (the UTC date) with "the morning of", in this household and in
      // another one this member doesn't belong to.
      await client.query(
        `INSERT INTO "HouseholdEvent" (id, "householdId", title, date, reminder)
         VALUES ($1, $2, $3, (now() AT TIME ZONE 'UTC')::date, 'MORNING_OF')`,
        [eventId, E2E_HOUSEHOLD.id, unique("Dentist")],
      );
      await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Other house')`, [otherHousehold]);
      await client.query(
        `INSERT INTO "HouseholdEvent" (id, "householdId", title, date, reminder)
         VALUES ($1, $2, 'Not yours', (now() AT TIME ZONE 'UTC')::date, 'MORNING_OF')`,
        [otherEventId, otherHousehold],
      );

      // Off by default: nothing is sent to a member who hasn't opted in.
      await runCron();
      expect(await sends(eventId)).toBe(0);

      await page.goto("/dashboard/profile");
      const toggle = page.getByRole("checkbox", { name: "Remind me about calendar events" });
      await expectHydrated(toggle);
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect(page.getByText("You'll get calendar reminders").first()).toBeVisible();
      await page.reload();
      await expect(page.getByRole("checkbox", { name: "Remind me about calendar events" })).toBeChecked();
      await expectNoHorizontalOverflow(page);

      await runCron();
      // A second run the same day sends nothing more.
      await runCron();
      expect(await sends(eventId)).toBe(1);
      expect(await sends(otherEventId)).toBe(0);
    } finally {
      await reset();
    }
  });
});
