import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";

// UX-35: swipe row actions on shopping, task and inventory rows. Swipe right
// ticks, completes or adds one; swipe left reveals Edit and a Delete that
// hides the row with an Undo toast and only deletes once the toast is gone.
// Touch only, so phone only. Playwright has no touch-drag API, so the swipe
// goes through Chromium's DevTools protocol as real touch events, which the
// page sees as pointer events with pointerType "touch". Phone only by its
// file name: playwright.config.ts runs `*.mobile.spec.ts` only in `mobile`.

const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

/** Resolves once the page's next Server Action has answered: reloading
 * before then would cancel the save the test is about to check. */
function nextActionResponse(page: Page) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && "next-action" in request.headers();
  });
}

/** Drags a finger across `target` by `dx` px, from its centre unless `fromX`
 * says where (a viewport x) to put it down. */
async function swipe(page: Page, target: Locator, dx: number, { fromX, dy = 0 }: { fromX?: number; dy?: number } = {}) {
  // A swipe is all pointer handlers, so unlike a click (which a native
  // checkbox answers even before React loads) it does nothing until the page
  // has hydrated. React marks each element it has taken over with a
  // `__reactProps$…` key; under a loaded parallel run, goto() can return
  // before that.
  await expect
    .poll(() => target.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps"))))
    .toBe(true);
  await target.scrollIntoViewIfNeeded();
  // Measure until the point is really on the target's row (SwipeRow marks
  // its root `data-swipe-row`): a section streaming in above the list can
  // move the row between measuring and touching, and the touch would land
  // on whatever took its place.
  let x = 0;
  let y = 0;
  await expect
    .poll(async () => {
      const box = (await target.boundingBox())!;
      x = fromX ?? box.x + box.width / 2;
      y = box.y + box.height / 2;
      return target.evaluate((el, [px, py]) => {
        const row = el.closest("[data-swipe-row]");
        return row !== null && row.contains(document.elementFromPoint(px, py));
      }, [x, y]);
    })
    .toBe(true);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", px: number, py: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(px), y: Math.round(py) }],
    });
  await touch("touchStart", x, y);
  const steps = 12;
  for (let i = 1; i <= steps; i++) await touch("touchMove", x + (dx * i) / steps, y + (dy * i) / steps);
  await touch("touchEnd", x + dx, y + dy);
  await cdp.detach();
}

async function seedList(t: string, names: string[]) {
  const listId = `e2e-ux35-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Swipe ${t}`,
  ]);
  // Plus one row that's never ticked, so the list never swaps to its
  // "all cleared" state.
  for (const [i, name] of [...names, `Left ${t}`].entries()) {
    await sql(`INSERT INTO "ShoppingListItem" (id, "shoppingListId", name) VALUES ($1, $2, $3)`, [
      `e2e-ux35-item-${t}-${i}`,
      listId,
      name,
    ]);
  }
  return `/dashboard/shopping-list/${listId}`;
}

async function seedTask(t: string, title: string) {
  await sql(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
    `e2e-ux35-task-${t}`,
    E2E_HOUSEHOLD.id,
    title,
  ]);
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  // Only this worker's household: see AGENTS.md, "Parallel workers".
  for (const table of ["ShoppingList", "HouseholdTask", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux35-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

test("swiping a shopping row right ticks it, and the tick saves", async ({ page }) => {
  const main = page.getByRole("main");
  const t = tag();
  const name = `Apples ${t}`;
  await page.goto(await seedList(t, [name]));
  const box = main.getByRole("checkbox", { name: new RegExp(`^${name} ×`) });
  const width = (await box.locator("xpath=ancestor::label").boundingBox())!.width;

  const saved = nextActionResponse(page);
  await swipe(page, main.getByTitle(new RegExp(`^${name} ×`)), width * 0.6);
  await expect(box).toBeChecked();
  await saved;
  await page.reload();
  // UX-37: on an active list a ticked row lives in the collapsed "In the
  // cart" section, so open it to see the saved tick.
  await main.getByRole("button", { name: /^In the cart/ }).click();
  await expect(box).toBeChecked();
});

test("a short swipe, a scroll, or a swipe from the screen edge changes nothing", async ({ page }) => {
  const main = page.getByRole("main");
  const t = tag();
  const name = `Butter ${t}`;
  await page.goto(await seedList(t, [name]));
  const box = main.getByRole("checkbox", { name: new RegExp(`^${name} ×`) });
  const row = main.getByTitle(new RegExp(`^${name} ×`));

  await swipe(page, row, 40);
  // Mostly downwards: the browser's scroll, not a swipe.
  await swipe(page, row, 60, { dy: 120 });
  // On the row (it starts at the 16 px page gutter) but inside the left
  // 20 px, which belong to the OS back gesture.
  await swipe(page, row, 250, { fromX: 18 });
  await expect(box).not.toBeChecked();
});

test("swiping a task right marks it done", async ({ page }) => {
  const main = page.getByRole("main");
  const t = tag();
  const title = `Water plants ${t}`;
  await seedTask(t, title);
  await page.goto("/dashboard/tasks");

  const saved = nextActionResponse(page);
  await swipe(page, main.getByText(title, { exact: true }), 250);
  await expect(main.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await saved;
  await page.reload();
  await expect(main.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
});

test("swiping an inventory card right adds one", async ({ page }) => {
  const main = page.getByRole("main");
  const t = tag();
  const name = `Wheat flour ${t}`;
  await sql(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($1, $2, $3, 'Pantry', 2, 'pcs', now())`,
    [`e2e-ux35-inv-${t}`, E2E_HOUSEHOLD.id, name],
  );
  await page.goto("/dashboard/inventory");
  const stepper = main.getByRole("button", { name: `Increase ${name}` }).locator("..");
  await expect(stepper).toContainText("2 pcs");

  const saved = nextActionResponse(page);
  await swipe(page, main.getByRole("paragraph").filter({ hasText: name }), 250);
  await expect(stepper).toContainText("3 pcs");
  await saved;
  await page.reload();
  await expect(stepper).toContainText("3 pcs");
});

test("swiping left opens the row's Edit dialog", async ({ page }) => {
  const main = page.getByRole("main");
  const t = tag();
  const name = `Coffee ${t}`;
  await page.goto(await seedList(t, [name]));

  await swipe(page, main.getByTitle(new RegExp(`^${name} ×`)), -160);
  const edit = main.getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeVisible();
  await edit.click();
  // The dialog for this row, not just any dialog.
  await expect(page.getByRole("dialog", { name: `Edit "${name}"` })).toBeVisible();
});

test("swipe-delete hides the row with an Undo, and deletes once the toast is gone", async ({ page }) => {
  const main = page.getByRole("main");
  const t = tag();
  const title = `Wipe hob ${t}`;
  await seedTask(t, title);
  await page.goto("/dashboard/tasks");
  const row = main.getByText(title, { exact: true });

  await swipe(page, row, -160);
  await main.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toBeHidden();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();
  // Undo means nothing ever reached the server.
  await page.reload();
  await expect(row).toBeVisible();

  await swipe(page, row, -160);
  await main.getByRole("button", { name: "Delete", exact: true }).click();
  const toast = page.getByText(`Deleted "${title}"`);
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(async () => {
      await page.reload();
      return row.count();
    })
    .toBe(0);
});

// Phone pass (Oct 2026): budget transaction rows swipe left too. The row
// itself is the edit button (which Edit clicks); Delete hides it with Undo.
test("a budget transaction swipes left to Edit, and to Delete with Undo", async ({ page }) => {
  const main = page.getByRole("main");
  const t = budgetTag();
  const description = `Bus card ${t}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-ux35-txcat-${t}`, name: `Travel ${t}` });
    await insertHouseholdTransaction(client, {
      id: `e2e-ux35-tx-${t}`,
      categoryId: `e2e-ux35-txcat-${t}`,
      amount: 30,
      description,
    });
  });
  await page.goto("/dashboard/budget?tab=transactions");
  const row = main.getByRole("button", { name: new RegExp(`^${description}`) });

  await swipe(page, row, -160);
  await main.getByRole("button", { name: "Edit", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Edit transaction" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await swipe(page, row, -160);
  await main.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toBeHidden();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();
  // Undo means nothing ever reached the server.
  await page.reload();
  await expect(row).toBeVisible();
});
