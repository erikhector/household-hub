import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-105: with no open task the page says "You're all caught up!" above
// Completed even on a fresh visit, and one-offs ticked over a week ago sit
// behind "Show N older". Rows are written straight to Postgres, because
// there's no way to back-date a completion through the UI.
const suffix = () => Math.random().toString(36).slice(2, 8);
const ID_PREFIX = `e2e-caught-up-w${E2E_WORKER}-`;

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

async function seedCompleted(title: string, daysAgo: number, repeatEveryDays: number | null = null) {
  await withClient((client) =>
    client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "completedAt", "recurrenceIntervalDays")
       VALUES ($1, $2, $3, now() - ($4 || ' days')::interval, $5)`,
      [`${ID_PREFIX}${suffix()}`, E2E_HOUSEHOLD.id, title, String(daysAgo), repeatEveryDays],
    ),
  );
}

test("old completed one-offs collapse behind Show N older, and come back on tap", async ({ page }) => {
  const tag = suffix();
  const oldOne = `Paint the fence ${tag}`;
  const oldTwo = `Fix the gate ${tag}`;
  const recent = `Wash the car ${tag}`;
  const oldRepeating = `Vacuum ${tag}`;
  await seedCompleted(oldOne, 10);
  await seedCompleted(oldTwo, 20);
  await seedCompleted(recent, 2);
  // A repeating task never collapses, and 90 days keeps it completed.
  await seedCompleted(oldRepeating, 10, 90);

  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("checkbox", { name: `Mark ${recent} as not done` })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Mark ${oldRepeating} as not done` })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Mark ${oldOne} as not done` })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: `Mark ${oldTwo} as not done` })).toHaveCount(0);

  const show = page.getByRole("button", { name: /^Show \d+ older$/ });
  await expect(show).toBeVisible();
  await show.click();
  await expect(page.getByRole("checkbox", { name: `Mark ${oldOne} as not done` })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Mark ${oldTwo} as not done` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Hide older" }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${oldOne} as not done` })).toHaveCount(0);
});

test("with nothing open, a fresh visit shows the all-caught-up card above Completed", async ({ page }) => {
  await seedCompleted(`Rake the leaves ${suffix()}`, 1);
  await page.goto("/dashboard/tasks");

  // Close every open task (the worker's household collects other specs' rows).
  const open = page.getByRole("checkbox", { name: /^Mark .* as done$/ });
  while ((await open.count()) > 0) {
    const before = await open.count();
    // A tick moves the row at tap time (UX-33), before the save lands. Wait
    // for the Server Action's response, or the reload below can abort a save
    // still in flight and bring that task back open.
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
    await open.first().click();
    await saved;
    await expect(open).toHaveCount(before - 1);
  }

  // Reload: no tick happens in this visit, and the card is still there.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /^Mark .* as done$/ })).toHaveCount(0);
  const card = page.getByText("You're all caught up!");
  await expect(card).toBeVisible();
  const completedLabel = page.getByText("Completed", { exact: true });
  const cardBox = (await card.boundingBox())!;
  const labelBox = (await completedLabel.boundingBox())!;
  expect(cardBox.y).toBeLessThan(labelBox.y);
  await expectNoHorizontalOverflow(page);
});
