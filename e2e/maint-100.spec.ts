import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, gotoRevealed, waitForDialogHistory } from "./ui";

// MAINT-100: rows that haven't moved must not glide. On a phone the page
// behind an open sheet is drawn at 0.94 (sheet-indent.tsx), and the list
// measured its rows as drawn (use-flip-list.ts). A task added through the
// sheet arrives while the page is still small, so at the list's next
// change every row looked 6% of its offset away from where it had been
// and jumped there to glide back: 37 px for the fourteenth row. A tap on
// a row's checkbox whose press and release straddled that jump was
// released over another row, so nothing was ticked ("add a task and mark
// it done" in flows.spec.ts, once in a full run, where the worker's
// household has a long list). Desktop has no scaled page, and there the
// rows must stay put all the same.
const suffix = () => Math.random().toString(36).slice(2, 8);
const ID_PREFIX = `e2e-maint100-w${E2E_WORKER}-`;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Only this household's rows, and only the ones this spec inserted.
test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND id LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `${ID_PREFIX}%`,
    ]),
  );
});

test("after a task is added through the sheet, ticking another leaves the rows above it where they are", async ({
  page,
  context,
  baseURL,
}) => {
  // On a phone the cookie notice covers the floating primary action (UX-40).
  await dismissCookieNotice(context, baseURL!);
  const token = suffix();
  const fillers = [0, 1, 2, 3].map((n) => `Stay put filler ${n} ${token}`);
  const added = `Stay put added ${token}`;
  const ticked = `Tick me ${token}`;
  // Open tasks list oldest first. The fillers sit above the task the test
  // adds, so that one is a few rows down (the jump grew with the offset),
  // and the task to tick is dated tomorrow, so it sits below them all and
  // ticking it moves nothing above it.
  await withClient(async (client) => {
    for (const title of fillers) {
      await client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
        `${ID_PREFIX}${suffix()}`,
        E2E_HOUSEHOLD.id,
        title,
      ]);
    }
    await client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "createdAt") VALUES ($1, $2, $3, now() + interval '1 day')`,
      [`${ID_PREFIX}${suffix()}`, E2E_HOUSEHOLD.id, ticked],
    );
  });

  // Every glide the list starts (use-flip-list.ts plays them with the Web
  // Animations API, id "flip-move"), by the label of the row's checkbox.
  await page.addInitScript(() => {
    const moves: string[] = [];
    (window as unknown as { flipMoves: string[] }).flipMoves = moves;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (typeof options === "object" && options.id === "flip-move") {
        moves.push(this.querySelector("input[type=checkbox]")?.getAttribute("aria-label") ?? "");
      }
      return animate.call(this, keyframes, options);
    };
  });
  const flipMoves = () => page.evaluate(() => (window as unknown as { flipMoves: string[] }).flipMoves);

  await gotoRevealed(page, "/dashboard/tasks");
  const addTask = page.getByRole("button", { name: "Add task" });
  await expectHydrated(addTask);
  await expectRouterPatched(page);
  await addTask.click();
  await page.getByRole("textbox", { name: "Task title" }).fill(added);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${added} as done` })).toBeVisible();
  await waitForDialogHistory(page);

  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await page.getByRole("checkbox", { name: `Mark ${ticked} as done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${ticked} as not done` })).toBeChecked();
  // The ticked row glides down to Completed, which shows the list did its
  // measuring for this change...
  await expect.poll(flipMoves).toContain(`Mark ${ticked} as not done`);
  // ...and none of the rows above it, which are where they were, moved.
  expect((await flipMoves()).filter((label) => label.includes("Stay put"))).toEqual([]);
  await saved;
});
