import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-137: a repeating chore reschedules from the user's local day, not from
// the moment of the tick. The server decides open vs completed with its own
// clock, which Playwright can't move, so the day rolling over is set up the
// way task-caught-up.spec.ts back-dates a completion: straight in Postgres,
// to 23:40 local time yesterday. Under the old "tick + 24 h" rule that chore
// stayed Completed until 23:40 today.
const ZONE = "Europe/Stockholm";
test.use({ timezoneId: ZONE });

const suffix = () => Math.random().toString(36).slice(2, 8);
const ID_PREFIX = `e2e-recur-day-w${E2E_WORKER}-`;

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

test("a daily chore ticked now is due tomorrow, and reopens once the local day has rolled over", async ({
  page,
  context,
}) => {
  const title = `Wipe the bench ${suffix()}`;
  const id = `${ID_PREFIX}${suffix()}`;
  await withClient((client) =>
    client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "recurrenceIntervalDays") VALUES ($1, $2, $3, 1)`,
      [id, E2E_HOUSEHOLD.id, title],
    ),
  );

  await page.goto("/dashboard/tasks");
  // The server needs the browser's zone to find the local day (the
  // time_zone cookie); the tick below reads it.
  await expect
    .poll(async () =>
      // The zone's "/" is stored percent-encoded.
      (await context.cookies()).some((cookie) => cookie.name === "time_zone" && decodeURIComponent(cookie.value) === ZONE),
    )
    .toBe(true);
  await page.reload();

  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  const today = dayLabel(0);
  const tomorrow = dayLabel(1);
  await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await saved;

  // Reload so the label comes from the server's schedule, not the optimistic
  // row: due tomorrow's midnight, never "today".
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect(page.getByRole("main").getByText(`Next due ${tomorrow}`).first()).toBeVisible();
  await expect(page.getByRole("main").getByText(`Next due ${today}`)).toHaveCount(0);

  // The day rolls over: it was ticked at 23:40 yesterday, local time.
  await withClient((client) =>
    client.query(
      `UPDATE "HouseholdTask"
       SET "completedAt" = (date_trunc('day', now() AT TIME ZONE $2) - interval '20 minutes') AT TIME ZONE $2
       WHERE id = $1 AND "householdId" = $3`,
      [id, ZONE, E2E_HOUSEHOLD.id],
    ),
  );
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toHaveCount(0);
  await expect(page.getByRole("main").getByText(`Next due ${today}`)).toHaveCount(0);
});
