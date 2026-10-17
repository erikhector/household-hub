import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { collectErrors, dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-37: shopping mode as a tool. A whole shop can be ticked off with the
// thumb from the "Next up" dock (sticky in the bottom half of the screen)
// without scrolling to the top; ticked rows collapse into "In the cart";
// the whole row is the tap target; and the "All done" moment offers to put
// things away. Lists are written straight to Postgres, named uniquely, and
// removed again afterwards (only this worker's household's rows).
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

// No service worker, for the held and aborted saves below (as in
// optimistic-ticking.spec.ts, which says why at length): once the root
// layout's worker claims the page, its fetches skip page.route(), so the
// save meant to fail goes through and stays in the cart. Under eight
// workers that hit about one run in thirty. Nothing here tests the worker.
test.use({ serviceWorkers: "block" });

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

type SeedItem = { name: string; category?: string; note?: string; purchased?: boolean };

// Each item is linked to its own InventoryItem (that's where its aisle, the
// category, lives). `purchased` rows are ticked but not put away yet.
async function seedList(t: string, items: SeedItem[]) {
  const listId = `e2e-ux37-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Shop ${t}`,
  ]);
  for (const [i, item] of items.entries()) {
    const inventoryId = `e2e-ux37-inv-${t}-${i}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 'pcs', now())`,
      [inventoryId, E2E_HOUSEHOLD.id, item.name, item.category ?? "Uncategorized"],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, note, purchased, "inventoryItemId")
       VALUES ($1, $2, $3, 'pcs', $4, $5, $6)`,
      [`e2e-ux37-item-${t}-${i}`, listId, item.name, item.note ?? null, item.purchased ?? false, inventoryId],
    );
  }
  return `/dashboard/shopping-list/${listId}`;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  for (const table of ["ShoppingList", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux37-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

// Phones only: from sm the dock is sticky at the bottom of a sidebar
// layout's column, and nobody shops one-handed on that.
async function expectInBottomHalf(page: Page, locator: ReturnType<Page["locator"]>) {
  if (page.viewportSize()!.width >= 640) return;
  const box = (await locator.boundingBox())!;
  const height = page.viewportSize()!.height;
  expect(box.y + box.height / 2, "in the thumb zone").toBeGreaterThan(height / 2);
  expect(box.y + box.height, "on screen").toBeLessThanOrEqual(height);
}

// UX-78: the ticked row left the dock within ~60 ms and the next item slid
// under the same finger, so a double tap ticked two things.
test("a double tap on a dock row ticks only that item", async ({ page }) => {
  const t = tag();
  // More than the dock's three rows, so a ticked row is backfilled and the
  // dock keeps its height: the next item then slides under the finger.
  const names = [`Milk ${t}`, `Eggs ${t}`, `Bread ${t}`, `Jam ${t}`, `Tea ${t}`];
  const path = await seedList(t, names.map((name) => ({ name, category: `Aisle A ${t}` })));
  await page.goto(path);

  const dock = page.getByRole("region", { name: "Next up" });
  const progress = dock.getByRole("progressbar", { name: "Shopping progress" });
  await expect(progress).toHaveAttribute("aria-valuetext", "0 of 5");

  // Two taps 90 ms apart on the same spot, timed inside the page (a
  // Playwright click per tap adds latency of its own and can outlast the
  // gap): each lands on whatever dock row is under the point then, as a
  // thumb would.
  const first = dock.getByRole("button", { name: /, into the cart$/ }).first();
  const box = (await first.boundingBox())!;
  await page.evaluate(
    async ({ x, y }) => {
      const tap = () => document.elementFromPoint(x, y)?.closest("button")?.click();
      tap();
      await new Promise((resolve) => setTimeout(resolve, 90));
      tap();
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );

  await expect(progress).toHaveAttribute("aria-valuetext", "1 of 5");
  // Settled: the ticked row lingered as a filled check, then the next item
  // moved up; the count never went past one.
  await page.waitForTimeout(700);
  await expect(progress).toHaveAttribute("aria-valuetext", "1 of 5");
  // The next item has moved up, untouched and tickable again.
  await expect(dock.getByRole("button", { name: new RegExp(`${names[1]}.*into the cart$`) })).toBeEnabled();
});

test("a whole shop is ticked off from the dock in the thumb zone, without scrolling up", async ({ page }) => {
  const errors = collectErrors(page);
  const t = tag();
  const names = [`Apples ${t}`, `Pears ${t}`, `Cheese ${t}`, `Yoghurt ${t}`];
  const path = await seedList(t, [
    { name: names[0], category: `Aisle A ${t}` },
    { name: names[1], category: `Aisle A ${t}` },
    { name: names[2], category: `Aisle B ${t}` },
    { name: names[3], category: `Aisle B ${t}` },
  ]);
  await page.goto(path);

  const dock = page.getByRole("region", { name: "Next up" });
  const progress = dock.getByRole("progressbar", { name: "Shopping progress" });
  await expect(progress).toHaveAttribute("aria-valuetext", "0 of 4");
  await expect(dock).toContainText("0 of 4");
  await expectNoHorizontalOverflow(page);

  for (let done = 1; done <= names.length; done++) {
    const next = dock.getByRole("button", { name: /, into the cart$/ }).first();
    await expectInBottomHalf(page, next);
    await next.click();
    if (done < names.length) await expect(progress).toHaveAttribute("aria-valuetext", `${done} of 4`);
  }

  // The "All done" moment, with the ring full and the next step offered:
  // the seeded household puts away later (ON_PUT_AWAY, the default), so
  // that's putting the four away.
  const main = page.getByRole("main");
  await expect(main.getByText("All done", { exact: true })).toBeVisible();
  await expect(main.getByRole("progressbar", { name: "Shopping progress" })).toHaveAttribute("aria-valuetext", "4 of 4");
  await expect(dock).toHaveCount(0);
  await expect(main.getByText("4 things are waiting to be put away.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Put things away" })).toBeEnabled();

  // Never scrolled: neither the page nor (on a phone) main, its scroller.
  const scrolled = await page.evaluate(() => window.scrollY + (document.querySelector("main")?.scrollTop ?? 0));
  expect(scrolled).toBe(0);

  // Every tick saved.
  await page.reload();
  await expect(main.getByRole("button", { name: "Put things away" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("ticked rows collapse into In the cart, and the whole row is the target", async ({ page }) => {
  const t = tag();
  const note = `the green ones ${t}`;
  const name = `Grapes ${t}`;
  const path = await seedList(t, [{ name, note }, { name: `Lemons ${t}` }]);
  await page.goto(path);

  const box = page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
  const cart = page.getByRole("button", { name: /^In the cart/ });
  await expect(cart).toHaveCount(0);

  // Tapping the note — not the checkbox or the name — ticks the row.
  // A real tap at the note's centre: what's hit there is the label's
  // row-wide hit area, not the note.
  // Each tick's save is awaited before the next step: a reload that races
  // one drops the request.
  const saved = () =>
    page.waitForResponse((r) => r.request().method() === "POST" && "next-action" in r.request().headers());
  const ticked = saved();
  const noteBox = (await page.getByRole("main").getByText(note).boundingBox())!;
  await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
  await expect(cart).toHaveAttribute("aria-expanded", "false");
  await expect(cart).toContainText("1");
  await expect(box).toBeHidden();
  await ticked;

  // Opening the section shows it ticked, and un-ticking there puts it back.
  await cart.click();
  await expect(cart).toHaveAttribute("aria-expanded", "true");
  await expect(box).toBeChecked();
  const unticked = saved();
  await box.click();
  await expect(box).not.toBeChecked();
  await expect(cart).toHaveCount(0);
  await expect(box).toBeVisible();
  await unticked;

  await page.reload();
  await expect(box).not.toBeChecked();
});

test("All done offers to put away what's still in the cart", async ({ page }) => {
  const t = tag();
  const path = await seedList(t, [
    { name: `Rice ${t}`, purchased: true },
    { name: `Beans ${t}` },
  ]);
  await page.goto(path);

  await page.getByRole("region", { name: "Next up" }).getByRole("button", { name: /^Beans .*, into the cart$/ }).click();
  const main = page.getByRole("main");
  await expect(main.getByText("All done", { exact: true })).toBeVisible();
  // The seeded household puts away later (ON_PUT_AWAY), so both wait.
  await expect(main.getByText("2 things are waiting to be put away.")).toBeVisible();
  await page.getByRole("button", { name: "Put things away" }).click();
  await expect(page.getByRole("dialog", { name: "Put away before you finish?" })).toBeVisible();
});

// Each tick settles on its own (DESIGN.md M5): with two saves in flight, the
// one that fails rolls its row back into its aisle at once, without waiting
// for the slow one. React 19 entangles concurrent async transitions, so the
// old shared useOptimistic transition held the failed row in "In the cart"
// until every tick had settled (tick-overlay.ts).
test("a failed tick rolls back at once while another tick is still saving", async ({ page }) => {
  const t = tag();
  const slowName = `Bread ${t}`;
  const failName = `Butter ${t}`;
  const path = await seedList(t, [{ name: slowName }, { name: failName }, { name: `Jam ${t}` }]);
  await page.goto(path);

  const failItemId = `e2e-ux37-item-${t}-1`;
  const slowItemId = `e2e-ux37-item-${t}-0`;
  let releaseSlow!: () => void;
  const slowHeld = new Promise<void>((resolve) => (releaseSlow = resolve));
  let slowAnswered = false;
  await page.route(path, async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (request.method() !== "POST" || !("next-action" in request.headers())) return route.continue();
    if (body.includes(failItemId)) {
      // Long enough for the second tap to start its own save behind this one.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.abort("failed");
    }
    if (body.includes(slowItemId)) {
      await slowHeld;
      return route.continue();
    }
    return route.continue();
  });
  // Counted on the response, not after route.continue() (as the tasks twin
  // in optimistic-ticking.spec.ts does): that resolves once the request is
  // sent, before the server has written the tick, so a reload behind it
  // can render the list from before the save.
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "POST" && "next-action" in request.headers() && (request.postData() ?? "").includes(slowItemId)) {
      slowAnswered = true;
    }
  });

  const slow = page.getByRole("checkbox", { name: new RegExp(`^${slowName}\\b`) });
  const failing = page.getByRole("checkbox", { name: new RegExp(`^${failName}\\b`) });
  // Failing one first: Next.js sends a page's Server Actions one at a time,
  // so its request goes (and fails after a second) while the slow one,
  // tapped right after, waits behind it and is then held below. Both saves
  // are in flight when the first one fails.
  // Wait for the failing save to actually leave the page before tapping the
  // slow one: otherwise the slow request can be sent first, is held, and the
  // failing one queues behind it and never fails within the timeout.
  const failSent = page.waitForRequest((request) => request.method() === "POST" && (request.postData() ?? "").includes(failItemId));
  await failing.click();
  await failSent;
  await slow.click();

  // The failed one is back in its aisle, unticked, with the save-failed
  // toast, while the slow save is still being held.
  await expect(failing).toBeVisible();
  await expect(failing).not.toBeChecked();
  await expect(page.getByRole("listitem").filter({ hasText: "Couldn't save that." })).toBeVisible();
  expect(slowAnswered, "the slow save is still in flight").toBe(false);
  // ...and the slow one still shows as ticked (in the cart).
  await expect(slow).toBeHidden();

  releaseSlow();
  const cart = page.getByRole("button", { name: /^In the cart/ });
  await expect(cart).toContainText("1");
  // The slow save reached the database and the failed one didn't.
  await expect.poll(() => slowAnswered).toBe(true);
  await page.reload();
  await expect(cart).toContainText("1");
  await expect(failing).toBeVisible();
  await expect(failing).not.toBeChecked();
});

// A row added from the smart-add box scrolls into view above the phone dock,
// not behind it: main's scroll-padding only clears the BottomNav, so the
// rows carry a scroll-margin the dock's height (--shopping-dock).
test("a row just added scrolls into view above the dock", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the dock is fixed only on phones");
  const t = tag();
  const path = await seedList(
    t,
    Array.from({ length: 14 }, (_, i) => ({ name: `Item ${i} ${t}`, category: `Aisle ${i % 3} ${t}` })),
  );
  await page.goto(path);
  const dock = page.getByRole("region", { name: "Next up" });
  await expect(dock).toBeVisible();

  const added = `Added ${t}`;
  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(added);
  await addBox.press("Enter");
  const row = page.getByRole("checkbox", { name: new RegExp(`^${added}\\b`) });
  await expect(row).toBeVisible();
  await expect
    .poll(
      async () => {
        const [rowBox, dockBox] = await Promise.all([row.boundingBox(), dock.boundingBox()]);
        return rowBox && dockBox ? dockBox.y - (rowBox.y + rowBox.height) : -1;
      },
      { message: "the new row ends above the dock" },
    )
    .toBeGreaterThanOrEqual(0);
});
