import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, waitForDialogHistory } from "./ui";

// UX-144: a weekly-or-longer chore keeps a fixed anchor day, and editing its
// interval moves that anchor to the day of the edit (`recurrenceAnchorAt`).
// The row is back-dated in Postgres to a daily chore created 10 days ago, so
// the old "anchor = createdAt" rule would put the first weekly occurrence
// after a tick today 4 days out (created + 14), while the re-set anchor makes
// it a full week out (today + 7).
const ZONE = "Europe/Stockholm";
test.use({ timezoneId: ZONE });

const suffix = () => Math.random().toString(36).slice(2, 8);
const ID_PREFIX = `e2e-anchor-w${E2E_WORKER}-`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Only this household's rows, and only the ones this spec made.
test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND id LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `${ID_PREFIX}%`,
    ]),
  );
});

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// The day `offsetDays` after the local day `from` falls on, as the app labels
// it. Counts calendar days in the zone, not 24 h spans: the app schedules on
// local days, and Europe/Stockholm falls back on 25 Oct 2026, so "+ 7 x 24 h"
// lands a day early in the first local hour after midnight (and a day late in
// the last hour before it across a spring-forward).
const dayLabel = (from: Date, offsetDays: number) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: ZONE,
  }).formatToParts(from);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Noon UTC keeps the shifted date on the same calendar day in UTC.
  const shifted = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + offsetDays, 12));
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(shifted);
};

test("editing a task to repeat weekly anchors the schedule on the day of the edit", async ({ page, context }) => {
  const title = `Water the ferns ${suffix()}`;
  const id = `${ID_PREFIX}${suffix()}`;
  await withClient((client) =>
    client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "recurrenceIntervalDays", "createdAt")
       VALUES ($1, $2, $3, 1, now() - interval '10 days')`,
      [id, E2E_HOUSEHOLD.id, title],
    ),
  );

  await page.goto("/dashboard/tasks");
  // The server finds the local day from the time_zone cookie.
  await expect
    .poll(async () =>
      (await context.cookies()).some((cookie) => cookie.name === "time_zone" && decodeURIComponent(cookie.value) === ZONE),
    )
    .toBe(true);
  await page.reload();

  // The title opens the edit dialog, which pushes a history entry, so wait
  // for React and the router's history patch before tapping it (MAINT-68).
  const titleButton = page.getByRole("main").getByRole("button", { name: title, exact: true });
  await expectHydrated(titleButton);
  await expectRouterPatched(page);
  await titleButton.click();
  const dialog = page.getByRole("dialog", { name: `Edit "${title}"` });
  const repeat = dialog.getByRole("combobox", { name: "Repeat" });
  await repeat.click();
  await page.getByRole("option", { name: "Every 7 days" }).click();
  await expect(repeat).toContainText("Every 7 days");
  // The day of the edit, read on both sides of the save: the two differ only
  // when local midnight falls during it, and then the anchor is on either.
  const dayBeforeSave = dayLabel(new Date(), 0);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  const dayAfterSave = dayLabel(new Date(), 0);

  // The tick is optimistic (UX-14): the checkbox flips before the toggle's
  // POST has saved. Wait for the POST to answer, or the reload below can
  // cancel it and the server's row comes back not done.
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await saved;

  // The expected dates count from the instants the server stored, not from
  // the clock at the assertion. Counted from "now" there, a run that passed
  // local midnight after the save expected a day later than the label the
  // server rendered, and failed. The columns are Prisma's zoneless UTC
  // timestamps, which `pg` would read in the runner's zone, hence AT TIME ZONE.
  const { anchorAt, createdAt } = await withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT "recurrenceAnchorAt" AT TIME ZONE 'UTC' AS "anchorAt", "createdAt" AT TIME ZONE 'UTC' AS "createdAt"
       FROM "HouseholdTask" WHERE id = $1 AND "householdId" = $2`,
      [id, E2E_HOUSEHOLD.id],
    );
    return rows[0] as { anchorAt: Date | null; createdAt: Date };
  });
  expect(anchorAt).not.toBeNull();
  expect([dayBeforeSave, dayAfterSave]).toContain(dayLabel(anchorAt!, 0));

  // Reload so the label comes from the server's schedule: a week from the
  // edit, not two weeks from the day the task was created.
  await waitForDialogHistory(page);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect(page.getByRole("main").getByText(`Next due ${dayLabel(anchorAt!, 7)}`).first()).toBeVisible();
  await expect(page.getByRole("main").getByText(`Next due ${dayLabel(createdAt, 14)}`)).toHaveCount(0);
});
