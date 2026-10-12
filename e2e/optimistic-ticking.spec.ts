import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

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

// Holds every Server Action POST to `path` until release() is called, and
// counts the ones that have come back. Next sends a page's actions one at a
// time, so holding the first one holds the queue behind it too.
async function holdServerActions(page: Page, path: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let answered = 0;
  const isAction = (request: { method(): string; headers(): Record<string, string> }) =>
    request.method() === "POST" && "next-action" in request.headers();
  // "response", not "requestfinished": the action's streamed RSC body can
  // stay open after the action itself has run and answered.
  page.on("response", (response) => {
    const request = response.request();
    if (isAction(request) && new URL(request.url()).pathname === path) answered++;
  });
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (isAction(route.request())) await gate;
      await route.continue();
    },
  );
  return { release, answered: () => answered };
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

  const boxes = names.map((name) => page.getByRole("checkbox", { name: new RegExp(`^${name} ×`) }));
  for (const box of boxes) await box.click();
  for (const box of boxes) {
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled();
  }
  expect(held.answered()).toBe(0);

  held.release();
  await expect.poll(held.answered).toBe(3);
  await page.reload();
  for (const box of boxes) await expect(box).toBeChecked();
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

  const box = page.getByRole("checkbox", { name: new RegExp(`^${name} ×`) });
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

  const boxes = names.map((name) => page.getByRole("checkbox", { name: new RegExp(`^${name} ×`) }));
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
