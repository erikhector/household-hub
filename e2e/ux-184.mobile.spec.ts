import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, gotoRevealed } from "./ui";

// UX-184 (M9): a long recipe name in the add-meal sheet's recipe picker
// wraps inside the list instead of running past its border and under the
// check. No line clamp: the ending is what tells two such recipes apart.
// Phone-only (`.mobile.spec.ts`): that is where the list is narrow enough
// to clip. Nothing is planned, so the week only has to be one no other spec
// plans in (it must show "Add first dinner").
const WEEK = "2034-06-05";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function expectLongNameFits(page: Page, tag: string) {
  const id = `e2e-w${E2E_WORKER}-ux184-${tag}`;
  const prefix = "Grandmother's slow-braised Västerbotten & leek pie with browned butter and thyme crumbs";
  const name = `${prefix.slice(0, 80 - tag.length - 1)} ${tag}`;
  expect(name).toHaveLength(80);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name, servings) VALUES ($1, $2, $3, 2)`, [
      id,
      E2E_HOUSEHOLD.id,
      name,
    ]);

    // MAINT-98: wait for the settled page in steps, each with its own budget.
    // The planner streams in behind its own Suspense boundary, and React
    // hydrates such a boundary only after the shell, at its lowest (never
    // expiring) priority, so on a loaded runner the button is hydrated last.
    // Polling for it straight after goto() spent one 20 s budget on the
    // server's stream, the reveal (until then the button sits in a hidden
    // `S:` div outside main, so the locator has nothing to evaluate), the
    // shell's hydration and only then the boundary's, and ran out twice in a
    // locked ci:local run. Revealed, then the router patched (the shell has
    // hydrated), then the button: the same checks, in the order they settle.
    await gotoRevealed(page, `/dashboard/meal-planning?week=${WEEK}`);
    await expectRouterPatched(page);
    const add = page.getByRole("main").getByRole("button", { name: "Add first dinner" });
    await expectHydrated(add);
    await add.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Recipe" }).fill(tag);
    const option = dialog.getByRole("option", { name });
    await expect(option).toBeVisible();

    const box = await option.evaluate((el) => {
      const list = el.closest('[role="listbox"]') ?? el.parentElement!;
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        textRight: text.right,
        listRight: list.getBoundingClientRect().right,
      };
    });
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
    expect(box.textRight).toBeLessThanOrEqual(box.listRight);
    // Wrapped, not clamped: the whole name, ending included, is shown.
    await expect(option).toHaveText(name);
  } finally {
    await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [id, E2E_HOUSEHOLD.id]);
    await client.end();
  }
}

test("a long recipe name wraps inside the add-meal picker", async ({ page }, testInfo) => {
  await expectLongNameFits(page, `${Date.now().toString(36)}a${testInfo.retry}`);
});

test("a long recipe name wraps inside the add-meal picker at 320 px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await expectLongNameFits(page, `${Date.now().toString(36)}b${testInfo.retry}`);
});
