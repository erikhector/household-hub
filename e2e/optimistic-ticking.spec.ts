import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { clickRowAction, dismissCookieNotice, holdServerActions } from "./ui";

// UX-14: ticking is instant. A shopping row, a share-page row, a task and an
// inventory +/- all change on tap, before the server answers, and one
// pending save never greys out the rest of the list. Each test holds every
// Server Action request on the page (a "throttled route" that only lets go
// when told to), acts several times in a row, checks the screen already
// shows all of it, then lets the saves through and reloads to prove they
// reached the database. Rows are written straight to Postgres, named
// uniquely since the desktop and mobile runs share the seeded household,
// and removed again afterwards.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

// No service worker. The root layout registers one (src/lib/service-worker.js)
// with a `fetch` handler, and it installs and claims each fresh test page
// a moment after load. Playwright's page.route() can't see requests a
// service worker handles, and when the claim lands while a test is running
// the page's own fetches come back ERR_ABORTED without ever reaching the
// route below: the held actions are never released or counted, and the
// abort test can miss its abort. It hit about one run in fifteen to twenty with
// three e2e workers, whose load slows the worker's install into the
// window between goto and the taps. Playwright's own advice for request
// interception is to block service workers; nothing here tests them.
test.use({ serviceWorkers: "block" });

function db() {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

async function sql(text: string, values: unknown[] = []) {
  const client = db();
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

async function seedList(t: string, names: string[]) {
  const listId = `e2e-ux14-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Instant ${t}`,
  ]);
  // Plus one row that's never ticked, so the list doesn't swap to its
  // "all cleared" state (which hides the rows) once the others save.
  for (const [i, name] of [...names, `Left ${t}`].entries()) {
    await sql(`INSERT INTO "ShoppingListItem" (id, "shoppingListId", name) VALUES ($1, $2, $3)`, [
      `e2e-ux14-item-${t}-${i}`,
      listId,
      name,
    ]);
  }
  return listId;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  // Lists cascade to their items and share links. Only this worker's
  // household: another worker may be running this spec's other project
  // right now, on rows with the same prefix.
  for (const table of ["ShoppingList", "HouseholdTask", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux14-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

test("ticking three shopping items shows all three before any save answers", async ({ page }) => {
  const t = tag();
  const names = [`Apples ${t}`, `Butter ${t}`, `Coffee ${t}`];
  const listId = await seedList(t, names);
  const path = `/dashboard/shopping-list/${listId}`;
  await page.goto(path);
  const held = await holdServerActions(page, path);

  const boxes = names.map((name) => page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) }));
  for (const box of boxes) await box.click();
  // UX-37: ticked rows move at once into the collapsed "In the cart"
  // section, still before any save answers; open it to see them.
  const cart = page.getByRole("button", { name: /^In the cart/ });
  await expect(cart).toContainText("3");
  await cart.click();
  for (const box of boxes) {
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled();
  }
  expect(held.answered()).toBe(0);

  held.release();
  await expect.poll(held.answered).toBe(3);
  await page.reload();
  await cart.click();
  for (const box of boxes) await expect(box).toBeChecked();
});

// MAINT-19: a ticked row fades out of its aisle for a moment while the
// optimistic overlay already lists it in "In the cart". The fading copy is
// inert and aria-hidden, so the item is exposed once (a screen reader hears one checkbox).
test("a ticked shopping item is exposed once while its row fades out", async ({ page }) => {
  const t = tag();
  const name = `Coffee ${t}`;
  const listId = await seedList(t, [name]);
  const path = `/dashboard/shopping-list/${listId}`;
  await page.goto(path);
  const held = await holdServerActions(page, path);

  const box = page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
  await box.click();
  const cart = page.getByRole("button", { name: /^In the cart/ });
  await expect(cart).toContainText("1");
  await cart.click();
  await expect(box).toHaveCount(1);
  await expect(box).toBeChecked();

  held.release();
  await expect.poll(held.answered).toBe(1);
});

test("a tick that can't reach the server rolls back with a toast", async ({ page }) => {
  const t = tag();
  const name = `Dates ${t}`;
  const listId = await seedList(t, [name]);
  const path = `/dashboard/shopping-list/${listId}`;
  await page.goto(path);
  await page.route(
    (url) => url.pathname === path,
    (route) => (route.request().method() === "POST" ? route.abort() : route.continue()),
  );

  const box = page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
  await box.click();
  await expect(page.getByText("Couldn't save that. Check your connection and try again.")).toBeVisible();
  await expect(box).not.toBeChecked();
});

test("ticking three items on a share link shows all three before any save answers", async ({ page }) => {
  const t = tag();
  const names = [`Eggs ${t}`, `Flour ${t}`, `Grapes ${t}`];
  const listId = await seedList(t, names);
  const token = `e2e-ux14-token-${t}`;
  await sql(`INSERT INTO "ShoppingListShareLink" (id, "shoppingListId", token) VALUES ($1, $2, $3)`, [
    `e2e-ux14-share-${t}`,
    listId,
    token,
  ]);
  const path = `/share/shopping-list/${token}`;
  await page.goto(path);
  const held = await holdServerActions(page, path);

  const boxes = names.map((name) => page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) }));
  for (const box of boxes) await box.click();
  for (const box of boxes) await expect(box).toBeChecked();
  expect(held.answered()).toBe(0);

  held.release();
  await expect.poll(held.answered).toBe(3);
  await page.reload();
  for (const box of boxes) await expect(box).toBeChecked();
});

test("ticking three tasks shows all three done before any save answers", async ({ page }) => {
  const t = tag();
  const titles = [`Water plants ${t}`, `Wipe hob ${t}`, `Wash towels ${t}`];
  for (const [i, title] of titles.entries()) {
    await sql(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
      `e2e-ux14-task-${t}-${i}`,
      E2E_HOUSEHOLD.id,
      title,
    ]);
  }
  const path = "/dashboard/tasks";
  await page.goto(path);
  const held = await holdServerActions(page, path);

  for (const title of titles) await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  // The label flips with the tick, so a screen reader hears the new state.
  const done = titles.map((title) => page.getByRole("checkbox", { name: `Mark ${title} as not done` }));
  for (const box of done) await expect(box).toBeChecked();
  expect(held.answered()).toBe(0);

  held.release();
  await expect.poll(held.answered).toBe(3);
  await page.reload();
  for (const box of done) await expect(box).toBeChecked();
});

// UX-33: task ticks are local marks, and each save settles its own (see
// local-row-changes.ts). With two in flight, the one that fails moves its
// task back to the open section at once, without waiting for the slow one:
// React 19 entangles concurrent async transitions, so a mark dropped in one
// waited for every save. The tasks twin of shopping-mode.spec.ts's test.
test("a failed task tick rolls back at once while another tick is still saving", async ({ page }) => {
  const t = tag();
  const slowTitle = `Sweep porch ${t}`;
  const failTitle = `Feed cat ${t}`;
  const slowId = `e2e-ux14-task-${t}-slow`;
  const failId = `e2e-ux14-task-${t}-fail`;
  for (const [id, title] of [
    [slowId, slowTitle],
    [failId, failTitle],
  ]) {
    await sql(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [id, E2E_HOUSEHOLD.id, title]);
  }
  const path = "/dashboard/tasks";
  await page.goto(path);

  let releaseSlow!: () => void;
  const slowHeld = new Promise<void>((resolve) => (releaseSlow = resolve));
  let slowAnswered = false;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      const request = route.request();
      const body = request.postData() ?? "";
      if (request.method() !== "POST" || !("next-action" in request.headers())) return route.continue();
      if (body.includes(failId)) {
        // Long enough for the second tap to start its own save behind this one.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return route.abort("failed");
      }
      if (body.includes(slowId)) {
        await slowHeld;
        await route.continue();
        slowAnswered = true;
        return;
      }
      return route.continue();
    },
  );

  // Failing one first: Next sends a page's Server Actions one at a time, so
  // its request goes (and fails after a second) while the slow one, tapped
  // right after, waits behind it and is then held. Both are in flight when
  // the first one fails.
  await page.getByRole("checkbox", { name: `Mark ${failTitle} as done` }).click();
  await page.getByRole("checkbox", { name: `Mark ${slowTitle} as done` }).click();

  await expect(page.getByRole("checkbox", { name: `Mark ${failTitle} as done` })).not.toBeChecked();
  await expect(page.getByText("Couldn't save that. Check your connection and try again.")).toBeVisible();
  expect(slowAnswered, "the slow save is still in flight").toBe(false);
  await expect(page.getByRole("checkbox", { name: `Mark ${slowTitle} as not done` })).toBeChecked();

  releaseSlow();
  await expect.poll(() => slowAnswered).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${slowTitle} as not done` })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `Mark ${failTitle} as done` })).not.toBeChecked();
});

// UX-33: a confirmed delete hides the row at once. If the request never
// reaches the server (offline), the row comes back with a toast, rather
// than staying gone or taking the page to the error boundary.
test("a task delete that can't reach the server brings the row back", async ({ page }) => {
  const t = tag();
  const title = `Descale kettle ${t}`;
  await sql(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
    `e2e-ux14-task-${t}-del`,
    E2E_HOUSEHOLD.id,
    title,
  ]);
  const path = "/dashboard/tasks";
  await page.goto(path);
  await page.route(
    (url) => url.pathname === path,
    (route) => (route.request().method() === "POST" ? route.abort() : route.continue()),
  );

  await clickRowAction(page, { button: `Delete ${title}`, menu: `More actions for ${title}`, item: "Delete" });
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Couldn't save that. Check your connection and try again.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
});

test("three taps on an inventory stepper all show before any save answers", async ({ page }) => {
  const t = tag();
  const name = `Wheat flour ${t}`;
  await sql(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($1, $2, $3, 'Pantry', 2, 'pcs', now())`,
    [`e2e-ux14-inv-${t}`, E2E_HOUSEHOLD.id, name],
  );
  const path = "/dashboard/inventory";
  await page.goto(path);
  const held = await holdServerActions(page, path);

  // Named steppers (UX-14), so this finds the visible one: the table on
  // desktop, the card on a phone.
  const increase = page.getByRole("button", { name: `Increase ${name}` });
  const decrease = page.getByRole("button", { name: `Decrease ${name}` });
  await expect(decrease).toBeVisible();
  const stepper = increase.locator("..");
  for (let i = 0; i < 3; i++) await increase.click();
  await expect(stepper).toContainText("5 pcs");
  await expect(increase).toBeEnabled();
  expect(held.answered()).toBe(0);

  held.release();
  await expect.poll(held.answered).toBe(3);
  await page.reload();
  await expect(stepper).toContainText("5 pcs");
});
