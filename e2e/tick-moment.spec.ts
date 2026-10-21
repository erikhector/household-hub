import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-54: the shared tick moment. Ticking a shopping row, a dock row or a task
// fills the checkbox (the `tick-pop` spring, flagged as data-ticking while it
// plays), buzzes for 10 ms where the device can, and only then moves the row.
// Under reduced motion nothing animates or waits, but the buzz still fires.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

// Same reason as shopping-mode.spec.ts: no service worker for the saves.
test.use({ serviceWorkers: "block" });

type Recorder = { __vibrations: unknown[]; __sawTicking: boolean };

test.beforeEach(async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.addInitScript(() => {
    const w = window as unknown as Recorder;
    w.__vibrations = [];
    w.__sawTicking = false;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: unknown) => {
        w.__vibrations.push(pattern);
        return true;
      },
    });
    // data-ticking is on the box only while the spring plays.
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.target instanceof Element && r.target.hasAttribute("data-ticking")) w.__sawTicking = true;
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-ticking"] });
  });
});

test.afterAll(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const table of ["ShoppingList", "InventoryItem"]) {
      await client.query(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux54-%' AND "householdId" = $1`, [
        E2E_HOUSEHOLD.id,
      ]);
    }
  } finally {
    await client.end();
  }
});

async function seedList(t: string, names: string[]) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const listId = `e2e-ux54-list-${t}`;
  try {
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      listId,
      E2E_HOUSEHOLD.id,
      `Shop ${t}`,
    ]);
    for (const [i, name] of names.entries()) {
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
         VALUES ($1, $2, $3, 'Aisle A', 0, 'pcs', now())`,
        [`e2e-ux54-inv-${t}-${i}`, E2E_HOUSEHOLD.id, name],
      );
      await client.query(
        `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased, "inventoryItemId")
         VALUES ($1, $2, $3, 'pcs', false, $4)`,
        [`e2e-ux54-item-${t}-${i}`, listId, name, `e2e-ux54-inv-${t}-${i}`],
      );
    }
  } finally {
    await client.end();
  }
  return `/dashboard/shopping-list/${listId}`;
}

const recorded = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Recorder;
    return { vibrations: w.__vibrations, sawTicking: w.__sawTicking };
  });

async function addTask(page: Page, title: string) {
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
}

test("ticking a shopping row buzzes 10 ms, springs, then moves the row to the cart", async ({ page }) => {
  const t = tag();
  const name = `Milk ${t}`;
  await page.goto(await seedList(t, [name, `Eggs ${t}`]));

  await page.getByRole("checkbox", { name: new RegExp(name) }).click();
  // The ticked row leaves its aisle ~450 ms after the tap (the spring, then
  // LEAVE_MS) and lands in the collapsed "In the cart", where `hidden` takes
  // it out of the accessibility tree. Asserting "checked" on the aisle copy
  // raced that: under load the first check could run after the row was gone.
  // Open the cart instead and assert the row's resting place. Until LEAVE_MS
  // is up the fading aisle copy is still there too: `inert` hides it from a
  // screen reader but not from Playwright's role query, so with the cart open
  // both copies match. Wait for the aisle one to go first, which also proves
  // the row moved, rather than letting `toBeChecked()` hit a strict-mode
  // violation (which fails at once, without retrying).
  await page.getByRole("button", { name: /^In the cart/ }).click();
  const row = page.getByRole("checkbox", { name: new RegExp(name) });
  await expect(row).toHaveCount(1);
  await expect(row).toBeChecked();
  await expect.poll(async () => (await recorded(page)).vibrations).toEqual([10]);
  expect((await recorded(page)).sawTicking).toBe(true);

  const dock = page.getByRole("region", { name: "Next up" });
  await expect(dock.getByRole("progressbar", { name: "Shopping progress" })).toHaveAttribute(
    "aria-valuetext",
    "1 of 2",
  );
});

test("ticking from the dock buzzes, then ticks the item", async ({ page }) => {
  const t = tag();
  const name = `Bread ${t}`;
  await page.goto(await seedList(t, [name, `Jam ${t}`]));

  const dock = page.getByRole("region", { name: "Next up" });
  await dock.getByRole("button", { name: new RegExp(`${name}.*into the cart$`) }).click();
  await expect.poll(async () => (await recorded(page)).vibrations).toEqual([10]);
  await expect(dock.getByRole("progressbar", { name: "Shopping progress" })).toHaveAttribute(
    "aria-valuetext",
    "1 of 2",
  );
});

test("completing a task buzzes 10 ms and springs, then it moves to Completed", async ({ page }) => {
  const title = `Water plants ${tag()}`;
  await addTask(page, title);

  await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect.poll(async () => (await recorded(page)).vibrations).toEqual([10]);
  expect((await recorded(page)).sawTicking).toBe(true);
});

test("under reduced motion the buzz still fires but nothing animates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const title = `Sweep ${tag()}`;
  await addTask(page, title);

  await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect.poll(async () => (await recorded(page)).vibrations).toEqual([10]);
  expect((await recorded(page)).sawTicking).toBe(false);
});
