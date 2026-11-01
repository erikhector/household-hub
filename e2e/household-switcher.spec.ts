import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  gotoRevealed,
} from "./ui";

// UX-158: the phone header used to open every page with ~90 px of "Household /
// <name>", though a user with one household has nothing to switch. With one
// household the header carries no switcher (and "Create household" is in the
// More menu, see overview.spec.ts), so the page title is the first thing in
// the page. With several, the switcher stays and still switches.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("one household: no switcher on a phone, and the page title is the first text in main", async ({
  page,
  isMobile,
}) => {
  await gotoRevealed(page, "/dashboard/household");
  const heading = page.getByRole("heading", {
    level: 1,
    name: en.household.title,
  });
  await expect(heading).toBeVisible();

  if (!isMobile) {
    // The desktop sidebar keeps its switcher (it costs the page no height).
    await expect(
      page
        .getByRole("complementary")
        .getByRole("button", { name: /E2E Household/ }),
    ).toBeVisible();
    return;
  }

  await expect(page.getByRole("button", { name: /E2E Household/ })).toHaveCount(
    0,
  );
  const main = page.getByRole("main");
  const [mainBox, headingBox] = await Promise.all([
    main.boundingBox(),
    heading.boundingBox(),
  ]);
  // Within the first few lines of main's viewport, not ~90 px (or the old
  // ~370 px on a list page) down.
  expect(headingBox!.y - mainBox!.y).toBeLessThan(40);
  const firstTextIsTitle = await main.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || !n.textContent?.trim()) continue;
      if (
        parent.closest(
          "[hidden], [aria-hidden='true'], script, style, template",
        )
      )
        continue;
      return parent.closest("h1") !== null;
    }
    return false;
  });
  expect(firstTextIsTitle).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test.describe("several households", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the switcher is there and switches", async ({
    page,
    isMobile,
  }, testInfo) => {
    const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
    const ids = {
      user: `e2e-hs-user-${tag}`,
      email: `e2e-hs-${tag}@squirrel.test`,
      a: `e2e-hs-a-${tag}`,
      b: `e2e-hs-b-${tag}`,
    };
    const password = "e2e-password-123";
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Switcher', now(), 'en')`,
        [ids.user, ids.email, await bcrypt.hash(password, 10)],
      );
      // One at a time so createdAt orders them: Alpha is the first, so active.
      for (const [id, name] of [
        [ids.a, "Alpha house"],
        [ids.b, "Beta house"],
      ]) {
        await client.query(
          `INSERT INTO "Household" (id, name) VALUES ($1, $2)`,
          [id, name],
        );
        await client.query(
          `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
          [`${id}-member`, id, ids.user],
        );
      }

      await page.goto("/login");
      await page.getByLabel("Email").fill(ids.email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      const row = isMobile
        ? page.getByRole("banner")
        : page.getByRole("complementary");
      // One slim row on a phone (the label is screen-reader only), not ~90 px.
      if (isMobile) expect((await row.boundingBox())!.height).toBeLessThan(64);
      await switchTo(page, row, "Alpha house", "Beta house");
      await switchTo(page, row, "Beta house", "Alpha house");
    } finally {
      await client.query(`DELETE FROM "Household" WHERE id = ANY($1)`, [
        [ids.a, ids.b],
      ]);
      await client.query(`DELETE FROM "User" WHERE id = $1`, [ids.user]);
      await client.end();
    }
  });
});

async function switchTo(
  page: Page,
  row: ReturnType<Page["getByRole"]>,
  from: string,
  to: string,
) {
  const trigger = row.getByRole("button", { name: new RegExp(from) });
  await expectHydrated(trigger);
  await trigger.click();
  await page.getByRole("menuitem", { name: new RegExp(to) }).click();
  await expect(row.getByRole("button", { name: new RegExp(to) })).toBeVisible();
}
