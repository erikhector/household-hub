import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_MEMBER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, waitForDialogHistory } from "./ui";

// GAP-60: "Skip this time" on an open repeating task moves the schedule on
// without logging a completion: the task leaves the open list, "Last done by"
// and the stored completedAt stay as they were, and Undo puts it back. The
// daily chore is seeded in Postgres with a real completion three days ago,
// so it is open and has a "Last done by" to keep.
const ID_PREFIX = `e2e-skip-w${E2E_WORKER}-`;
const suffix = () => Math.random().toString(36).slice(2, 8);

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

test("skipping a repeating task closes it without a completion, and Undo reopens it", async ({ page }) => {
  const title = `Water the ferns ${suffix()}`;
  const id = `${ID_PREFIX}${suffix()}`;
  await withClient((client) =>
    client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "recurrenceIntervalDays", "completedAt", "completedByMemberId")
       VALUES ($1, $2, $3, 1, now() - interval '3 days', $4)`,
      [id, E2E_HOUSEHOLD.id, title, E2E_MEMBER],
    ),
  );
  const storedCompletion = async () =>
    withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT "completedAt", "completedByMemberId", "skippedUntil" FROM "HouseholdTask" WHERE id = $1`,
        [id],
      );
      return rows[0] as { completedAt: Date; completedByMemberId: string; skippedUntil: Date | null };
    });
  const before = await storedCompletion();

  await page.goto("/dashboard/tasks");
  const open = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(open).toBeVisible();
  await expectHydrated(open);
  const main = page.getByRole("main");
  const lastDone = main.getByText(/Last done by/);
  const lastDoneBefore = await lastDone.count();

  const skipSaved = page.waitForResponse(
    (r) => r.request().method() === "POST" && "next-action" in r.request().headers(),
  );
  const isPhone = (page.viewportSize()?.width ?? 1280) < 640;
  if (isPhone) {
    // The row has no skip icon on a phone: the edit sheet carries the button.
    await expectRouterPatched(page);
    await main.getByRole("button", { name: title, exact: true }).click();
    const skip = page.getByRole("dialog").getByRole("button", { name: "Skip this time", exact: true });
    await expect(skip).toBeVisible();
    expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await skip.click();
  } else {
    // Named with the row's title, so it is unique per row.
    await page.getByRole("button", { name: `Skip ${title} this time`, exact: true }).click();
  }

  // The row leaves the open list, and says it was skipped. "Last done by" is
  // untouched: no completion was credited to anyone.
  await expect(page.getByText(`Skipped "${title}" this time`)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect(open).toHaveCount(0);
  await expect(main.getByText("Skipped", { exact: true })).toHaveCount(1);
  await expect(lastDone).toHaveCount(lastDoneBefore);
  await skipSaved;
  if (isPhone) await waitForDialogHistory(page);

  // It is saved: still skipped after a reload, and the stored completion is
  // exactly what it was.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect(lastDone).toHaveCount(lastDoneBefore);
  const after = await storedCompletion();
  expect(after.completedAt).toEqual(before.completedAt);
  expect(after.completedByMemberId).toBe(before.completedByMemberId);
  expect(after.skippedUntil).not.toBeNull();

  // Ticking a skipped task reopens it: that only drops the skip, and the
  // real last completion stays.
  const reopenSaved = page.waitForResponse(
    (r) => r.request().method() === "POST" && "next-action" in r.request().headers(),
  );
  await page.getByRole("checkbox", { name: `Mark ${title} as not done` }).click();
  await expect(open).toBeVisible();
  await reopenSaved;
  await page.reload();
  await expect(open).toBeVisible();
  const reopened = await storedCompletion();
  expect(reopened.skippedUntil).toBeNull();
  expect(reopened.completedAt).toEqual(before.completedAt);
  expect(reopened.completedByMemberId).toBe(before.completedByMemberId);
});

test("Undo on the skip toast brings the task straight back", async ({ page }) => {
  const title = `Sweep the porch ${suffix()}`;
  const id = `${ID_PREFIX}${suffix()}`;
  await withClient((client) =>
    client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "recurrenceIntervalDays") VALUES ($1, $2, $3, 2)`,
      [id, E2E_HOUSEHOLD.id, title],
    ),
  );

  await page.goto("/dashboard/tasks");
  const open = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(open).toBeVisible();
  await expectHydrated(open);

  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await expectRouterPatched(page);
    await page.getByRole("main").getByRole("button", { name: title, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Skip this time", exact: true }).click();
    await waitForDialogHistory(page);
  } else {
    await page.getByRole("button", { name: `Skip ${title} this time`, exact: true }).click();
  }
  await expect(open).toHaveCount(0);

  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: `Skipped "${title}" this time` })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(open).toBeVisible();

  await expect
    .poll(async () =>
      withClient(async (client) => {
        const { rows } = await client.query(`SELECT "skippedUntil" FROM "HouseholdTask" WHERE id = $1`, [id]);
        return rows[0].skippedUntil;
      }),
    )
    .toBeNull();
});

test("a one-off task has no skip action", async ({ page }) => {
  const title = `Post the parcel ${suffix()}`;
  const id = `${ID_PREFIX}${suffix()}`;
  await withClient((client) =>
    client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
      id,
      E2E_HOUSEHOLD.id,
      title,
    ]),
  );

  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Skip ${title} this time`, exact: true })).toHaveCount(0);
});
