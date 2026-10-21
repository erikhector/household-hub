import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

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

const dayLabel = (offsetDays: number) => {
  const at = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: ZONE }).format(at);
};

test("editing a task to repeat weekly anchors the schedule on the day of the edit", async ({ page, context }) => {
  const title = `Water the ferns ${suffix()}`;
  await withClient((client) =>
    client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "recurrenceIntervalDays", "createdAt")
       VALUES ($1, $2, $3, 1, now() - interval '10 days')`,
      [`${ID_PREFIX}${suffix()}`, E2E_HOUSEHOLD.id, title],
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

  await page.getByRole("main").getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit "${title}"` });
  await dialog.getByRole("combobox", { name: "Repeat" }).click();
  await page.getByRole("option", { name: "Every 7 days" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();

  // Reload so the label comes from the server's schedule: a week from the
  // edit, not from the day the task was created.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect(page.getByRole("main").getByText(`Next due ${dayLabel(7)}`).first()).toBeVisible();
  await expect(page.getByRole("main").getByText(`Next due ${dayLabel(4)}`)).toHaveCount(0);
});
