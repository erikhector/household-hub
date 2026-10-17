import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-47: the name field accepts 60 characters, and a name that long used to
// push the switcher's chevron and "+" off a 412 px phone and spill the
// sidebar over the page heading on desktop. The switcher now truncates the
// name, keeps the chevron and "+" on screen, and the full name stays
// reachable (title on the name, the whole name in the dropdown). The name is
// restored afterwards so no other spec sees it.
const LONG_NAME = "Familjen Öberg-Håkansson på Södermalm med de tre katterna 60";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  expect(LONG_NAME).toHaveLength(60);
  await setName(LONG_NAME);
});

test.afterEach(async () => {
  await setName(E2E_HOUSEHOLD.name);
});

async function setName(name: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`UPDATE "Household" SET name = $1 WHERE id = $2`, [name, E2E_HOUSEHOLD.id]);
  } finally {
    await client.end();
  }
}

test("a 60-character household name is truncated and the switcher stays on screen", async ({ page }) => {
  await page.goto("/dashboard");

  // The header (phone) and the sidebar (desktop) each render a switcher;
  // only one is visible at a given width.
  const nameEl = page.getByTitle(LONG_NAME, { exact: true }).filter({ visible: true });
  await expect(nameEl).toBeVisible();
  const trigger = page.getByRole("button", { name: LONG_NAME }).filter({ visible: true });
  const plus = page.getByRole("button", { name: "Create household" }).filter({ visible: true });

  const viewport = page.viewportSize()!;
  const triggerBox = (await trigger.boundingBox())!;
  const plusBox = (await plus.boundingBox())!;
  const chevronBox = (await trigger.locator("svg").boundingBox())!;

  // The chevron sits inside the trigger and the trigger leaves room for "+",
  // all inside the screen.
  expect(chevronBox.x + chevronBox.width).toBeLessThanOrEqual(triggerBox.x + triggerBox.width + 1);
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(plusBox.x + 1);
  expect(plusBox.x + plusBox.width).toBeLessThanOrEqual(viewport.width);

  // Truncated, not full: the clamped name is cut off.
  const clipped = await nameEl.evaluate((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  expect(clipped).toBe(true);

  await expectNoHorizontalOverflow(page);
});

test("the full name is reachable in the switcher dropdown", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: LONG_NAME }).filter({ visible: true }).click();
  await expect(page.getByRole("menuitem", { name: new RegExp(LONG_NAME) })).toBeVisible();
  // The menu item's title carries the whole name for when it clamps.
  await expect(page.getByRole("menu").getByTitle(LONG_NAME, { exact: true })).toBeVisible();
});
