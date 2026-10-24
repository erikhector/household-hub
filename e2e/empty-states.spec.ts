import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-50: on a new household every section's empty state is the same thing:
// the mascot, one line on why the section is worth using, and exactly one
// primary action, placed through PrimaryAction (floating at the bottom right
// on a phone, so nothing may sit under it). The seeded household already has
// rows everywhere, so each test gets its own empty household and account
// (straight to Postgres, like quick-add-unit.spec.ts) and logs in through
// the real form.
test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = "e2e-password-123";

async function withEmptyHousehold(
  page: Page,
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
  tag: string,
  run: (client: Client, householdId: string) => Promise<void>,
) {
  await dismissCookieNotice(context, baseURL);
  const userId = `e2e-es-user-${tag}`;
  const householdId = `e2e-es-household-${tag}`;
  const email = `e2e-es-${tag}@squirrel.test`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Empty States', now(), 'en')`,
      [userId, email, await bcrypt.hash(PASSWORD, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Empty states household')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`e2e-es-member-${tag}`, householdId, userId],
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await run(client, householdId);
  } finally {
    // Household first: its members and rows cascade with it.
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await client.end();
  }
}

// The section's empty state: the mascot, the one line, and one primary. The
// solid (`bg-primary`) buttons and links in <main> are the primaries, and
// there must be exactly one, named `primary`.
async function expectOneEmptyStatePrimary(page: Page, line: string | RegExp, primary: string) {
  const main = page.getByRole("main");
  await expect(main.getByRole("img", { name: "Squirrel mascot" }).filter({ visible: true })).toHaveCount(1);
  await expect(main.getByText(line).filter({ visible: true })).toHaveCount(1);
  const button = main.getByRole(/link/.test(primary) ? "link" : "button", { name: primary.replace(/^link:/, "") });
  await expect(button.filter({ visible: true })).toHaveCount(1);
  const solid = main.locator("button.bg-primary:visible, a.bg-primary:visible");
  await expect(solid).toHaveCount(1);
  await expect(solid).toHaveAccessibleName(primary.replace(/^link:/, ""));
  // For eyeballing the layout (see "Screenshots" in AGENTS.md): off unless asked for.
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const slug = new URL(page.url()).search.replace(/\W+/g, "-") + new URL(page.url()).pathname.replace(/\W+/g, "-");
    await page.screenshot({ path: path.join(dir, `empty-${test.info().project.name}${slug}.png`) });
  }
  return solid;
}

// On a phone the primary floats at the bottom right: scrolled to the end of
// the page, no other control may sit under it (the empty inventory's "Paste
// a list" link used to). Mid-page, content scrolling under it is normal.
async function expectNothingUnderPrimary(page: Page, testInfo: { project: { name: string } }) {
  if (testInfo.project.name !== "mobile") return;
  await page.getByRole("main").evaluate((main) => {
    main.scrollTop = main.scrollHeight;
  });
  const fab = page.locator("[data-primary-action]:visible").first();
  const box = await fab.boundingBox();
  expect(box, "the primary action is on screen").not.toBeNull();
  const overlaps = await page.getByRole("main").evaluate((main, fabBox) => {
    const hits: string[] = [];
    for (const el of main.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [role=combobox]")) {
      if (el.closest("[data-primary-action]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const hidden = getComputedStyle(el).visibility === "hidden" || el.closest("[hidden]") !== null;
      if (hidden) continue;
      const overlap =
        r.left < fabBox.x + fabBox.width && r.right > fabBox.x && r.top < fabBox.y + fabBox.height && r.bottom > fabBox.y;
      if (overlap) hits.push(el.textContent?.trim().slice(0, 40) || el.getAttribute("aria-label") || el.tagName);
    }
    return hits;
  }, box!);
  expect(overlaps, "controls under the floating primary action").toEqual([]);
}

test("a new household's Tasks and Shopping pages each hold one primary inside the empty state", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-a`;
  await withEmptyHousehold(page, context, baseURL!, tag, async () => {
    await page.goto("/dashboard/tasks");
    await expectOneEmptyStatePrimary(page, /Add the chores that keep coming back/, "Add task");
    await expectNothingUnderPrimary(page, testInfo);
    await expectNoHorizontalOverflow(page);

    // The primary is the real thing: it opens the add-task dialog.
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/dashboard/shopping-list");
    await expectOneEmptyStatePrimary(page, /One shared list for the whole household/, "New list");
    await expectNothingUnderPrimary(page, testInfo);
    await expectNoHorizontalOverflow(page);
  });
});

test("a new household's inventory is one empty state with Add item, and nothing under it", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-b`;
  await withEmptyHousehold(page, context, baseURL!, tag, async () => {
    await page.goto("/dashboard/inventory");
    await expectOneEmptyStatePrimary(page, /Add a few items to start tracking/, "Add item");
    await expectNothingUnderPrimary(page, testInfo);
    await expectNoHorizontalOverflow(page);
  });
});

test("a new household's meal planning tabs each hold one primary inside the empty state", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-c`;
  await withEmptyHousehold(page, context, baseURL!, tag, async () => {
    // Planner: one empty state instead of seven "Add meal" cards.
    await page.goto("/dashboard/meal-planning");
    await expectOneEmptyStatePrimary(page, /Add a few recipes first/, "Add your first dinner");
    await expect(page.getByRole("button", { name: /^Add meal, / })).toHaveCount(0);
    await expectNothingUnderPrimary(page, testInfo);
    await expectNoHorizontalOverflow(page);

    await page.goto("/dashboard/meal-planning?tab=recipes");
    await expectOneEmptyStatePrimary(page, /No recipes yet/, "New recipe");
    await expectNothingUnderPrimary(page, testInfo);

    // Cook now: the mascot and one way forward, a link to the Recipes tab.
    await page.goto("/dashboard/meal-planning?tab=cook");
    await expectOneEmptyStatePrimary(page, /Add a recipe and this tab shows/, "link:Add a recipe");
    await expectNothingUnderPrimary(page, testInfo);
    await page.getByRole("link", { name: "Add a recipe" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/tab=recipes/);
    await expect(page.getByRole("button", { name: "New recipe" }).filter({ visible: true })).toBeVisible();

    // Meal prep: Record prep is a PrimaryAction like the sibling tabs, not
    // a full-width bar.
    await page.goto("/dashboard/meal-planning?tab=prep");
    await expectOneEmptyStatePrimary(page, /Cooked a big batch of something/, "Record prep");
    await expectNothingUnderPrimary(page, testInfo);
    await expectNoHorizontalOverflow(page);
  });
});

test("a brand-new shopping list has no disabled Register receipt above its add line", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-d`;
  await withEmptyHousehold(page, context, baseURL!, tag, async (client, householdId) => {
    const listId = `e2e-es-list-${tag}`;
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, 'Fresh list')`, [
      listId,
      householdId,
    ]);
    await page.goto(`/dashboard/shopping-list/${listId}`);
    await expect(page.getByText(/Nothing on this list yet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Register receipt" })).toHaveCount(0);

    // The first item brings it back.
    await client.query(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, quantity, unit) VALUES ($1, $2, 'Milk', 1, 'pcs')`,
      [`e2e-es-item-${tag}`, listId],
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Register receipt" })).toBeVisible();
  });
});
