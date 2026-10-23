import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-133: a one-off task can carry a due date. Open tasks sort overdue, then
// due today, then due later, then undated, and a late row reads "Overdue · N
// days" (tasks page and overview). The zone is pinned so "today" is the same
// calendar day for the browser, the server (which reads the time_zone cookie)
// and this spec.
const ZONE = "Europe/Stockholm";
test.use({ timezoneId: ZONE });

const suffix = () => Math.random().toString(36).slice(2, 8);
const ID_PREFIX = `e2e-due-w${E2E_WORKER}-`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Rows made through the dialog have generated ids, so they're found by the
// title prefix; both are scoped to this worker's household.
test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND (id LIKE $2 OR title LIKE 'Due spec %')`, [
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

/** The calendar date `offsetDays` from today in ZONE, as YYYY-MM-DD. */
const dateInput = (offsetDays: number) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: ZONE,
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + offsetDays, 12)).toISOString().slice(0, 10);
};

async function openInZone(page: Page, path: string) {
  await page.goto(path);
  // The server finds the local day from the time_zone cookie, which the
  // first visit sets and then refreshes for.
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "time_zone" && decodeURIComponent(cookie.value) === ZONE,
      ),
    )
    .toBe(true);
  await page.reload();
}

test("a task keeps its due date, and a late one shows how late on the list and the overview", async ({ page }) => {
  const title = `Due spec book the car service ${suffix()}`;
  await openInZone(page, "/dashboard/tasks");

  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByLabel("Task title").fill(title);
  await dialog.getByLabel("Due date").fill(dateInput(-5));
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Reload first: the point is that the date saved.
  await page.reload();
  const row = page.getByRole("main").locator("[data-swipe-row]").filter({ hasText: title });
  await expect(row.getByText("Overdue · 5 days")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The overview's Today block names the lateness too.
  await page.goto("/dashboard");
  const todayItem = page.getByRole("list", { name: "Tasks to do" }).getByRole("listitem").filter({ hasText: title });
  await expect(todayItem.getByText("Overdue · 5 days")).toBeVisible();

  // Clearing the date takes the badge away.
  await page.goto("/dashboard/tasks");
  await page.getByRole("main").getByRole("button", { name: title, exact: true }).click();
  const edit = page.getByRole("dialog", { name: `Edit "${title}"` });
  await expect(edit.getByLabel("Due date")).toHaveValue(dateInput(-5));
  await edit.getByRole("button", { name: "Clear due date" }).click();
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  await expect(page.getByRole("main").getByRole("button", { name: title, exact: true })).toBeVisible();
  await expect(row.getByText(/Overdue/)).toHaveCount(0);
});

test("open tasks sort overdue, then today, then later, then undated", async ({ page }) => {
  const tag = suffix();
  const titles = {
    undated: `Due spec undated ${tag}`,
    later: `Due spec later ${tag}`,
    today: `Due spec today ${tag}`,
    overdue: `Due spec overdue ${tag}`,
  };
  // Created in the opposite order to the expected one, so a createdAt sort
  // would show the reverse.
  await withClient(async (client) => {
    const rows: [keyof typeof titles, string | null][] = [
      ["undated", null],
      ["later", dateInput(3)],
      ["today", dateInput(0)],
      ["overdue", dateInput(-2)],
    ];
    for (const [index, [key, date]] of rows.entries()) {
      await client.query(
        `INSERT INTO "HouseholdTask" (id, "householdId", title, "dueDate", "createdAt")
         VALUES ($1, $2, $3, $4, now() - interval '1 hour' + ($5 || ' seconds')::interval)`,
        [`${ID_PREFIX}${key}-${tag}`, E2E_HOUSEHOLD.id, titles[key], date, String(index)],
      );
    }
  });

  await openInZone(page, "/dashboard/tasks");
  const main = page.getByRole("main");
  await expect(main.getByText("Overdue · 2 days")).toBeVisible();
  await expect(main.getByText("Due today")).toBeVisible();

  const names = await main.getByRole("checkbox").evaluateAll((boxes) => boxes.map((b) => b.getAttribute("aria-label")));
  const position = (title: string) => names.indexOf(`Mark ${title} as done`);
  expect(position(titles.overdue)).toBeGreaterThanOrEqual(0);
  expect(position(titles.overdue)).toBeLessThan(position(titles.today));
  expect(position(titles.today)).toBeLessThan(position(titles.later));
  expect(position(titles.later)).toBeLessThan(position(titles.undated));
});
