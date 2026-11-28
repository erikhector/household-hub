import { expect, test, type Page } from "@playwright/test";
import { unique, uniqueId, withDb } from "./db";
import { E2E_HOUSEHOLD, E2E_MEMBER } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, gotoRevealed } from "./ui";

// Acorn stash (docs/superpowers/specs/2026-11-27-acorn-stash-design.md): the
// opt-in chore game on the Tasks page. Turned on from Household > Settings,
// a tick earns the ticker an acorn on the stash card, Undo takes it back,
// and turning it off hides the card again. Ticks are only recorded while
// it's on, so every test turns it on before ticking, and a re-tick after a
// late untick earns nothing. The worker's household gets the setting back
// off afterwards, so other specs see the Tasks page as usual.

const setStash = (enabled: boolean) =>
  withDb((client) =>
    client.query(`UPDATE "Household" SET "acornStashEnabled" = $1 WHERE id = $2`, [enabled, E2E_HOUSEHOLD.id]),
  );

// Resolves once the next Server Action posted from `path` has answered.
const actionSaved = (page: Page, path: string) =>
  page.waitForResponse(
    (r) => r.request().method() === "POST" && "next-action" in r.request().headers() && new URL(r.url()).pathname === path,
  );

// Flips the Household > Settings checkbox and waits for its toast.
async function toggleInSettings(page: Page, checked: boolean) {
  await page.goto("/dashboard/household?tab=settings");
  const box = page.getByRole("checkbox", { name: /Show the acorn stash on the Tasks page/ });
  await expectHydrated(box);
  await expect(box).toBeChecked({ checked: !checked });
  const saved = actionSaved(page, "/dashboard/household");
  await box.click();
  await saved;
  await expect(page.getByText(checked ? "The acorn stash is on" : "The acorn stash is off")).toBeVisible();
  await expect(box).toBeChecked({ checked });
}

let taskId: string;
let title: string;
let seededIds: string[];

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await setStash(false);
  taskId = uniqueId("e2e-acorn-task");
  title = unique("Sweep the porch");
  // Two ticks of the viewer's own from earlier today, so the pile starts
  // above 0 (and above 1): the count must read right from any start, not
  // only from an empty stash.
  seededIds = [uniqueId("e2e-acorn-tc"), uniqueId("e2e-acorn-tc")];
  await withDb(async (client) => {
    await client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
      taskId,
      E2E_HOUSEHOLD.id,
      title,
    ]);
    for (const id of seededIds) {
      await client.query(
        `INSERT INTO "TaskCompletion" (id, "householdId", "memberId", "completedAt") VALUES ($1, $2, $3, now())`,
        [id, E2E_HOUSEHOLD.id, E2E_MEMBER],
      );
    }
  });
});

test.afterEach(async () => {
  await setStash(false);
  await withDb(async (client) => {
    await client.query(`DELETE FROM "TaskCompletion" WHERE "householdId" = $1 AND ("taskId" = $2 OR id = ANY($3))`, [
      E2E_HOUSEHOLD.id,
      taskId,
      seededIds,
    ]);
    await client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, taskId]);
  });
});

const pile = (count: number) => `${count} ${count === 1 ? "acorn" : "acorns"} this week`;
const yourPile = (count: number) => `You have ${pile(count)}`;

test("the acorn stash is off by default, earns an acorn per tick, gives it back on Undo, and hides again", async ({
  page,
}) => {
  const stash = page.getByRole("region", { name: "Acorn stash" });

  // Off: nothing of it on the Tasks page.
  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await expect(stash).toHaveCount(0);

  await toggleInSettings(page, true);

  await gotoRevealed(page, "/dashboard/tasks");
  await expect(stash).toBeVisible();
  const box = page.getByRole("checkbox", { name: `Mark ${title} as done`, exact: true });
  // M6: below the open tasks, so it never pushes them down on a phone.
  const rowBox = await box.boundingBox();
  const stashBox = await stash.boundingBox();
  expect(stashBox!.y).toBeGreaterThan(rowBox!.y + rowBox!.height);

  // Collapsed, it's one row: the title and the viewer's own pile, read from
  // the screen-reader sentence, which is its own element. Only the change
  // is asserted exactly, so the count can't hang on what else this week
  // left in the worker's household.
  const summaryPile = stash.getByText(/^You have \d+ acorns? this week$/);
  const before = Number(/^You have (\d+)/.exec((await summaryPile.textContent()) ?? "")?.[1]);
  expect(before).toBeGreaterThanOrEqual(2);
  await expect(stash.getByRole("listitem")).toHaveCount(0);

  // Opened, a row per member; the viewer's says "(you)".
  await stash.getByText("Acorn stash", { exact: true }).click();
  const mine = stash.getByRole("listitem").filter({ hasText: "(you)" });
  const minePile = mine.getByText(/^\d+ acorns? this week$/);
  await expect(minePile).toHaveText(pile(before));
  // The visible digit is its own element too, not run into the sentence.
  await expect(mine.getByText(String(before), { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const rowHeight = (await mine.boundingBox())!.height;

  await expectHydrated(box);
  const tickSaved = actionSaved(page, "/dashboard/tasks");
  await box.click();
  await tickSaved;
  await expect(minePile).toHaveText(pile(before + 1));
  await expect(summaryPile).toHaveText(yourPile(before + 1));
  await expect(mine.getByText(String(before + 1), { exact: true })).toBeVisible();
  await expect(mine).toContainText("in all");
  // M5: the row keeps its height when the leader badge comes or goes; the
  // name truncates rather than wrapping onto a second line.
  expect((await mine.boundingBox())!.height).toBe(rowHeight);

  // Undo takes back exactly that acorn, and it stays gone after a reload.
  const undoSaved = actionSaved(page, "/dashboard/tasks");
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: `Done: ${title}` })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await undoSaved;
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done`, exact: true })).not.toBeChecked();
  await expect(minePile).toHaveText(pile(before));
  await expect(summaryPile).toHaveText(yourPile(before));
  await page.reload();
  await expect(summaryPile).toHaveText(yourPile(before));
  await stash.getByText("Acorn stash", { exact: true }).click();
  await expect(minePile).toHaveText(pile(before));

  // Off again: the card goes.
  await toggleInSettings(page, false);
  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await expect(stash).toHaveCount(0);
});

test("a re-tick after a late untick is recorded but doesn't raise the pile", async ({ page }) => {
  // What a late untick leaves behind (past the toast's undo window): the
  // task open again with its completedAt put back (null, for a first tick),
  // and the tick's row kept, acorn and all.
  const keptId = uniqueId("e2e-acorn-tc");
  seededIds.push(keptId);
  await withDb((client) =>
    client.query(
      `INSERT INTO "TaskCompletion" (id, "householdId", "taskId", "memberId", "completedAt")
       VALUES ($1, $2, $3, $4, now() - interval '1 minute')`,
      [keptId, E2E_HOUSEHOLD.id, taskId, E2E_MEMBER],
    ),
  );
  await setStash(true);

  await gotoRevealed(page, "/dashboard/tasks");
  const stash = page.getByRole("region", { name: "Acorn stash" });
  const summaryPile = stash.getByText(/^You have \d+ acorns? this week$/);
  const before = Number(/^You have (\d+)/.exec((await summaryPile.textContent()) ?? "")?.[1]);
  // The two seeded ticks and the kept one.
  expect(before).toBeGreaterThanOrEqual(3);

  const box = page.getByRole("checkbox", { name: `Mark ${title} as done`, exact: true });
  await expectHydrated(box);
  const tickSaved = actionSaved(page, "/dashboard/tasks");
  await box.click();
  await tickSaved;

  // The kept row already paid for this tick: the pile stays where it was,
  // after a reload too...
  await page.reload();
  await expect(summaryPile).toHaveText(yourPile(before));
  // ...though the tick itself was recorded, with no acorn.
  const acorns = await withDb(async (client) => {
    const { rows } = await client.query<{ acorns: number }>(
      `SELECT acorns FROM "TaskCompletion" WHERE "householdId" = $1 AND "taskId" = $2 ORDER BY "completedAt"`,
      [E2E_HOUSEHOLD.id, taskId],
    );
    return rows.map((row) => row.acorns);
  });
  expect(acorns).toEqual([1, 0]);
});
