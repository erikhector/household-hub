import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice } from "./ui";

// GAP-53: "Copy as text" in the shopping list's ⋯ menu puts the open items on
// the clipboard and confirms with a toast. The test makes its own list, so it
// neither depends on nor changes the seeded one.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
});

test("Copy as text puts the open items on the clipboard and leaves ticked ones out", async ({ page }) => {
  const t = en.shoppingList;
  const listName = unique("Copy shop");
  const oat = unique("Oat drink");
  const rye = unique("Rye bread");

  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(listName);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();

  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(`${oat}, ${rye}`);
  await addBox.press("Enter");
  const oatBox = page.getByRole("checkbox", { name: new RegExp(`^${oat}( ×|$)`, "i") });
  await expect(oatBox).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${rye}( ×|$)`, "i") })).toBeVisible();

  // UX-86: a plain add is 1 pcs, which shows as just the name, no "× 1 pcs".
  await expect(oatBox).toHaveAccessibleName(oat);
  await expect(page.getByText(oat, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("× 1 pcs")).toHaveCount(0);

  const copy = async () => {
    await page.getByRole("button", { name: t.moreActions }).click();
    await page.getByRole("menuitem", { name: t.copyText }).click();
    // The first copy's toast may still be showing when the second runs, so
    // match any of them rather than one (strict mode).
    await expect(page.getByText(t.copyTextToast).first()).toBeVisible();
  };
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await copy();
  const text = await clipboard();
  expect(text.split("\n")[0]).toBe(listName);
  expect(text).toMatch(new RegExp(`^- .*${oat}$`, "im"));
  expect(text).toMatch(new RegExp(`^- .*${rye}$`, "im"));

  // A ticked item is in the cart, not on the list to buy.
  await oatBox.click();
  await expect(oatBox).toBeHidden();
  await copy();
  await expect.poll(clipboard).not.toContain(oat);
  expect(await clipboard()).toContain(rye);
});
