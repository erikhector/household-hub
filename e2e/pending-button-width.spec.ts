import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_USER } from "./seed";
import { dismissCookieNotice } from "./ui";

// The save below renames this worker's seeded user, and every later spec in
// the worker reads that name (task-due-nudge.spec.ts asserts the assignee in
// its reminder entry), so the seeded name goes back afterwards, pass or
// fail (MAINT-121). The held save can still be in flight when a failed
// assertion ends the test, so the restore waits for its response first;
// otherwise the late save would land after the restore and rename the user
// again.
let pendingSave: Promise<unknown> | undefined;

test.afterEach(async () => {
  await pendingSave?.catch(() => {});
  pendingSave = undefined;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`UPDATE "User" SET "displayName" = $1 WHERE id = $2`, [E2E_USER.displayName, E2E_USER.id]);
  } finally {
    await client.end();
  }
});

// UX-42: a button that swaps its label to "Saving…" while its action runs
// keeps the width it had, so nothing next to it moves under the thumb.
// The server action is held for a second so the pending state can be
// measured instead of raced.
test("a saving button keeps its width", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.route("**/dashboard/profile", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto("/dashboard/profile");
  const name = page.getByLabel("Display name");
  await name.fill(`Width ${Date.now()}`);
  const save = page.getByRole("button", { name: "Save changes" }).first();
  const before = (await save.boundingBox())!;
  pendingSave = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/dashboard/profile",
  );
  await save.click();
  const saving = page.getByRole("button", { name: "Saving…" });
  await expect(saving).toBeVisible();
  const during = (await saving.boundingBox())!;
  expect(during.width).toBeCloseTo(before.width, 0);
  expect(during.height).toBeCloseTo(before.height, 0);
  await expect(page.getByRole("button", { name: "Save changes" }).first()).toBeVisible();
});
