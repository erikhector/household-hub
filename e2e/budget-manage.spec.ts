import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTemplate, withDb } from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets } from "./ui";

// Phone pass (Oct 2026), P5: on Manage, a recurring item is one line with
// its one action and a "More" menu (Delete last, apart), and a category
// chip is one button that opens its edit sheet, which holds Delete. Chips
// show names in full when they fit.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seed({ withItem = true } = {}) {
  const tag = budgetTag();
  const category = `Kids activities ${tag}`;
  const item = `Swimming ${tag}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-mng-cat-${tag}`, name: category });
    // A category a recurring item uses can't be deleted, so the chip test
    // seeds the category alone.
    if (withItem) await insertHouseholdTemplate(client, { id: `e2e-mng-tpl-${tag}`, categoryId: `e2e-mng-cat-${tag}`, name: item, amount: 350 });
  });
  return { category, item };
}

test("a recurring item is one line: its action and a More menu", async ({ page, isMobile }) => {
  const { item } = await seed();
  await page.goto("/dashboard/budget?tab=manage");
  const main = page.getByRole("main");

  const more = main.getByRole("button", { name: `More actions for ${item}` });
  await expect(more).toBeVisible();
  const row = more.locator("xpath=..");
  const log = row.getByRole("button", { name: "Log", exact: true });
  await expect(log).toBeVisible();
  const [logBox, moreBox] = [(await log.boundingBox())!, (await more.boundingBox())!];
  expect(Math.abs(logBox.y + logBox.height / 2 - (moreBox.y + moreBox.height / 2))).toBeLessThan(4);
  if (isMobile) {
    await expectTargetsApart(row);
    await expectTouchTargets(page);
  }
  await expectNoHorizontalOverflow(page);

  await more.click();
  for (const name of ["Mark as accounted for", "Edit", "Pause", "Delete"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit recurring item" })).toBeVisible();
  await page.keyboard.press("Escape");

  await more.click();
  await page.getByRole("menuitem", { name: "Pause", exact: true }).click();
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible();

  await more.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: `Delete ${item}?` }).getByRole("button", { name: "Delete" }).click();
  await expect(more).toHaveCount(0);
});

test("a category chip shows its whole name and edits, with Delete in the sheet", async ({ page }) => {
  const { category } = await seed({ withItem: false });
  await page.goto("/dashboard/budget?tab=manage");
  const main = page.getByRole("main");

  const chip = main.getByRole("button", { name: `Edit ${category}` });
  await expect(chip).toBeVisible();
  const clipped = await chip.locator("span").first().evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped, "the chip's name is cut off").toBe(false);
  await expectNoHorizontalOverflow(page);

  await chip.click();
  const sheet = page.getByRole("dialog", { name: "Edit category" });
  const del = sheet.getByRole("button", { name: `Delete ${category}` });
  const save = sheet.getByRole("button", { name: "Save" });
  await expect(del).toBeVisible();
  await expect
    .poll(async () => {
      const [d, s] = [(await del.boundingBox())!, (await save.boundingBox())!];
      return Math.max(s.y - (d.y + d.height), d.y - (s.y + s.height), s.x - (d.x + d.width));
    })
    .toBeGreaterThanOrEqual(8);
  await del.click();
  await page.getByRole("dialog", { name: `Delete ${category}?` }).getByRole("button", { name: "Delete" }).click();
  await expect(chip).toHaveCount(0);
});

// UX-118: the three Add buttons on Manage share one placement, top right
// of their panel, level with its title.
test("Add category, Add recurring item and Add planned bill sit top right", async ({ page }) => {
  await seed();
  await page.goto("/dashboard/budget?tab=manage");
  const main = page.getByRole("main");
  const boxes = [];
  for (const [add, title] of [
    ["Add category", "Categories"],
    ["Add recurring item", "Recurring items"],
    ["Add planned bill", "Planned bills"],
  ] as const) {
    const button = main.getByRole("button", { name: add, exact: true });
    await expect(button).toBeVisible();
    const heading = main.getByRole("heading", { name: title, exact: true });
    const [b, h] = [(await button.boundingBox())!, (await heading.boundingBox())!];
    // Beside the title, not under the description.
    expect(b.y).toBeLessThan(h.y + h.height + 24);
    expect(b.x).toBeGreaterThan(h.x + h.width - 1);
    boxes.push(b);
  }
  const rights = boxes.map((b) => b.x + b.width);
  expect(Math.max(...rights) - Math.min(...rights)).toBeLessThan(2);
  await expectNoHorizontalOverflow(page);
});
