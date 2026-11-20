import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { format } from "@/lib/i18n/format";
import { unique } from "./db";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  waitForDialogHistory,
} from "./ui";

// GAP-82: a row's ⋯ "Move to list…" sends it to another open list. The
// household holds other specs' lists and rows, so this one makes its own two
// lists and its own item, all uniquely named, and checks only those.
const t = en.shoppingList.moveItem;

async function createList(page: Page, name: string) {
  await page.goto("/dashboard/shopping-list");
  const newList = page.getByRole("button", { name: "New list" });
  await expectHydrated(newList);
  await expectRouterPatched(page);
  await newList.click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/]+$/);
  return page.url();
}

const rowOf = (page: Page, item: string) => page.getByRole("checkbox", { name: new RegExp(`^${item}\\b`) });

test("an item moves to another open list from its ⋯ menu", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const from = unique("Move from");
  const to = unique("Move to");
  const item = unique("Picture hooks");

  const fromUrl = await createList(page, from);
  const toUrl = await createList(page, to);

  await page.goto(fromUrl);
  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await expectHydrated(addBox);
  await addBox.fill(item);
  await addBox.press("Enter");
  await expect(rowOf(page, item)).toBeVisible();

  // The ⋯ is the way in at every width: on a phone it already holds Edit and
  // Delete, on a desktop it shows because there is somewhere to move to.
  const more = page.getByRole("button", { name: format(en.shoppingList.rowActionsAriaLabel, { name: item }), exact: true });
  await expectHydrated(more);
  await expectRouterPatched(page);
  await more.click();
  await page.getByRole("menuitem", { name: t.menuLabel }).click();

  const sheet = page.getByRole("dialog", { name: format(t.title, { name: item }) });
  await expect(sheet).toBeVisible();
  // The list this row is on isn't offered as a target.
  await expect(sheet.getByRole("button", { name: from, exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await sheet.getByRole("button", { name: to, exact: true }).click();

  await expect(page.getByText(format(t.movedToast, { name: item, list: to }))).toBeVisible();
  await waitForDialogHistory(page);
  await expect(rowOf(page, item)).toHaveCount(0);
  await page.reload();
  await expect(addBox).toBeVisible();
  await expect(rowOf(page, item)).toHaveCount(0);

  await page.goto(toUrl);
  await expect(rowOf(page, item)).toBeVisible();
});
