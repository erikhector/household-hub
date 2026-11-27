import { expect, test, type Page } from "@playwright/test";
import { unique, uniqueId, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow } from "./ui";

// Acorn stash (docs/superpowers/specs/2026-11-27-acorn-stash-design.md): the
// opt-in chore game on the Tasks page. Turned on from Household > Settings,
// a tick earns the ticker an acorn on the stash card, Undo takes it back,
// and turning it off hides the card again. The worker's household gets the
// setting back off afterwards, so other specs see the Tasks page as usual.

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

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await setStash(false);
  taskId = uniqueId("e2e-acorn-task");
  title = unique("Sweep the porch");
  await withDb((client) =>
    client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
      taskId,
      E2E_HOUSEHOLD.id,
      title,
    ]),
  );
});

test.afterEach(async () => {
  await setStash(false);
  await withDb(async (client) => {
    await client.query(`DELETE FROM "TaskCompletion" WHERE "householdId" = $1 AND "taskId" = $2`, [E2E_HOUSEHOLD.id, taskId]);
    await client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, taskId]);
  });
});

test("the acorn stash is off by default, earns an acorn per tick, gives it back on Undo, and hides again", async ({
  page,
}) => {
  const stash = page.getByRole("region", { name: "Acorn stash" });

  // Off: nothing of it on the Tasks page.
  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await expect(stash).toHaveCount(0);

  await toggleInSettings(page, true);

  await page.goto("/dashboard/tasks");
  await expect(stash).toBeVisible();
  // The viewer's own row. Other specs in this worker tick tasks too, so the
  // pile starts wherever they left it; only the change is ours.
  const mine = stash.getByRole("listitem").filter({ hasText: "(you)" });
  const before = Number(/(\d+) acorns? this week/.exec((await mine.textContent()) ?? "")?.[1]);
  expect(Number.isInteger(before)).toBe(true);
  const pile = (count: number) => `${count} ${count === 1 ? "acorn" : "acorns"} this week`;
  await expect(mine).toContainText(pile(before));
  await expectNoHorizontalOverflow(page);

  const box = page.getByRole("checkbox", { name: `Mark ${title} as done`, exact: true });
  await expectHydrated(box);
  const tickSaved = actionSaved(page, "/dashboard/tasks");
  await box.click();
  await tickSaved;
  await expect(mine).toContainText(pile(before + 1));
  await expect(mine).toContainText("in all");

  // Undo takes back exactly that acorn, and it stays gone after a reload.
  const undoSaved = actionSaved(page, "/dashboard/tasks");
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: `Done: ${title}` })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await undoSaved;
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done`, exact: true })).not.toBeChecked();
  await expect(mine).toContainText(pile(before));
  await page.reload();
  await expect(stash.getByRole("listitem").filter({ hasText: "(you)" })).toContainText(pile(before));

  // Off again: the card goes.
  await toggleInSettings(page, false);
  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await expect(stash).toHaveCount(0);
});
