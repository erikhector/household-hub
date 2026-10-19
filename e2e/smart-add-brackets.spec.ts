import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-88: a comma inside brackets belongs to the item. "<tablets> (lemon-free,
// 120 st), <towels>" is two rows, not a "(lemon-free" row plus a junk
// "st)" row. Own list, so the seeded one is untouched. The closing letter
// keeps the generated suffix from ever ending in digits (a trailing "x29"
// would read as a quantity).
const unique = (label: string) => `${label} ${Date.now().toString(36)}z`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("Smart add keeps a bracketed comma inside its item", async ({ page }) => {
  const listName = unique("Bracket shop");
  const tablets = unique("Dishwasher tablets");
  const towels = unique("Paper towels");

  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(listName);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();

  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(`${tablets} (lemon-free, 120 st), ${towels}`);
  await addBox.press("Enter");

  await expect(
    page.getByRole("checkbox", { name: new RegExp(`^${tablets} \\(lemon-free, 120 st\\)`, "i") }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${towels}\\b`, "i") })).toBeVisible();
  // Exactly the two rows: no junk "st)" row.
  await expect(page.getByRole("checkbox")).toHaveCount(2);
});
