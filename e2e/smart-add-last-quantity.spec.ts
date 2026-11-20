import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectRouterPatched } from "./ui";

// GAP-83: picking a smart add suggestion with nothing typed in front adds
// the amount last bought, and the suggestion shows that amount first. The
// household holds other specs' lists and items, so this one makes its own
// two lists and its own item, all uniquely named, and checks only those.
// Letters only: the smart add line reads a name ending in "x7" as "× 7".
const unique = (label: string) =>
  `${label} ${`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;

async function createList(page: Page, name: string) {
  await page.goto("/dashboard/shopping-list");
  const newList = page.getByRole("button", { name: "New list" });
  await expectHydrated(newList);
  await expectRouterPatched(page);
  await newList.click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const rowOf = (page: Page, item: string) => page.getByRole("checkbox", { name: new RegExp(`^${item}\\b`) });

test("a picked suggestion adds the quantity last bought", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const item = unique("Free range eggs");
  const sixPcs = new RegExp(`^${item} × 6 pcs`);

  // First trip: buy 6 of it.
  await createList(page, unique("Last qty first"));
  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await expectHydrated(addBox);
  await addBox.fill(`6 ${item}`);
  await addBox.press("Enter");
  const firstRow = rowOf(page, item);
  await expect(firstRow).toHaveAccessibleName(sixPcs);
  await expectHydrated(firstRow);
  // The tick is optimistic (UX-14): the row moves and the put-away button
  // shows on tap, before the save lands, so a reload straight after could
  // beat the request and come back with the row unticked (MAINT-123). Wait
  // for the tick's Server Action to answer (it does once the action has run)
  // before reloading. The add above has already answered: its row only shows
  // once smart add's action returns.
  const tickSaved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await firstRow.click();
  // With its only row ticked the list offers to put the trip away. Reload
  // and see it again, so the next list only opens once the tick is saved.
  const putAway = page.getByRole("button", { name: "Put everything away" });
  await expect(putAway).toBeVisible();
  await tickSaved;
  await page.reload();
  await expect(putAway).toBeVisible();

  // Next trip, on a new list: typing the start of the name suggests it with
  // the 6 it will add, and picking it adds 6, not 1.
  await createList(page, unique("Last qty second"));
  await expectHydrated(addBox);
  await addBox.fill(item.slice(0, -2));
  const suggestion = page.getByRole("option", { name: new RegExp(`^${item}`) });
  await expect(suggestion).toContainText("6 pcs");
  await expectNoHorizontalOverflow(page);
  await suggestion.click();
  await expect(rowOf(page, item)).toHaveAccessibleName(sixPcs);
  await page.reload();
  await expect(rowOf(page, item)).toHaveAccessibleName(sixPcs);
});
