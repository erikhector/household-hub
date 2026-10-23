import { expect, test, type Locator } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets, waitForDialogHistory, waitForUndoableDelete } from "./ui";

// Phone pass (Oct 2026), P2: transactions on a phone are compact rows under
// day headers. The row itself opens the edit sheet (which holds Delete),
// an expense's amount is plain text colour (red is for errors and over
// budget), a row with no description is named by its category, and the
// export link sits under the list instead of on top of it. The desktop
// table keeps its edit/delete buttons and drops the year from its dates.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedRows() {
  const tag = budgetTag();
  const category = `Food ${tag}`;
  const described = `Coffee ${tag}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-txrows-cat-${tag}`, name: category });
    await insertHouseholdTransaction(client, {
      id: `e2e-txrows-a-${tag}`,
      categoryId: `e2e-txrows-cat-${tag}`,
      amount: 45.5,
      description: described,
    });
    await insertHouseholdTransaction(client, {
      id: `e2e-txrows-b-${tag}`,
      categoryId: `e2e-txrows-cat-${tag}`,
      amount: 12,
    });
  });
  return { category, described };
}

/** The colour `el` actually renders in, next to what the two candidate
 * tokens render as on this page. */
async function colours(el: Locator) {
  return el.evaluate((node) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    probe.className = "text-foreground";
    const foreground = getComputedStyle(probe).color;
    probe.className = "text-destructive";
    const destructive = getComputedStyle(probe).color;
    probe.remove();
    return { own: getComputedStyle(node).color, foreground, destructive };
  });
}

test("phone rows open the edit sheet, name themselves and delete from the sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the phone list; the desktop table has its own test below");
  const { category, described } = await seedRows();
  await page.goto("/dashboard/budget?tab=transactions");
  const main = page.getByRole("main");

  const row = main.getByRole("button", { name: new RegExp(`^${described}`) });
  await expect(row).toBeVisible();
  // Grouped under today's header, and compact: well under the old ~120 px card.
  await expect(main.getByRole("heading", { name: "Today" })).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(72);
  // Swipeable (SwipeRow), with the row itself as the named path.
  await expect(row.locator("xpath=ancestor::*[@data-swipe-row]")).toHaveCount(1);
  // No description: the category names the row.
  await expect(main.getByRole("button", { name: new RegExp(`^${category}`) })).toBeVisible();

  const amount = row.getByText(/45[.,]50/);
  const { own, foreground, destructive } = await colours(amount);
  expect(own).toBe(foreground);
  expect(own).not.toBe(destructive);

  await expectTouchTargets(page);
  await expectNoHorizontalOverflow(page);

  // Export moved below the list.
  const exportLink = main.getByRole("link", { name: "Export CSV" });
  expect((await exportLink.boundingBox())!.y).toBeGreaterThan((await row.boundingBox())!.y);

  // The row opens the edit sheet; Delete lives there, away from Save.
  await row.click();
  const sheet = page.getByRole("dialog", { name: "Edit transaction" });
  await expect(sheet).toBeVisible();
  const del = sheet.getByRole("button", { name: "Delete transaction" });
  const save = sheet.getByRole("button", { name: "Save" });
  // The form is taller than the sheet once the worker's household has
  // collected a few categories (one chip each, and every spec adds its
  // own), so at scrollTop 0 Delete, the last thing in the form body, sits
  // under the sticky footer. That overlap is the sheet scrolling, not a
  // layout bug: "away from Save" is only meaningful with Delete scrolled
  // into view, which is also where a user taps it. Scroll it to the middle
  // of the scroller first (the footer is below it then, never over it).
  await del.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Measured once the sheet has finished sliding up (mid-slide the sticky
  // footer and the form body are still moving relative to each other).
  await expect
    .poll(async () => {
      const [d, s] = [(await del.boundingBox())!, (await save.boundingBox())!];
      return Math.max(s.y - (d.y + d.height), d.y - (s.y + s.height));
    })
    .toBeGreaterThanOrEqual(8);

  await del.click();
  // UX-49: no confirm. The sheet closes, the row goes at once, and the
  // delete reaches the server when the Undo toast closes; a reload before
  // then would still find the row. The sheet's history.back() lands
  // asynchronously (dialog-history.ts), which waitForDialogHistory also
  // waits for so the reload isn't aborted.
  await waitForUndoableDelete(page, `Deleted "${described}"`);
  await waitForDialogHistory(page);
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(main.getByRole("button", { name: new RegExp(`^${category}`) })).toBeVisible();
  await expect(main.getByRole("button", { name: new RegExp(`^${described}`) })).toHaveCount(0);
});

test("the desktop table drops the year and keeps its row buttons", async ({ page, isMobile }) => {
  test.skip(isMobile, "the desktop table; phones have the test above");
  const { described } = await seedRows();
  await page.goto("/dashboard/budget?tab=transactions");
  const main = page.getByRole("main");

  const row = main.getByRole("row").filter({ hasText: described });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(String(new Date().getFullYear()));
  const { own, foreground } = await colours(row.getByText(/45[.,]50/));
  expect(own).toBe(foreground);

  await row.getByRole("button", { name: "Edit transaction" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit transaction" });
  await dialog.getByRole("button", { name: "Delete transaction" }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
