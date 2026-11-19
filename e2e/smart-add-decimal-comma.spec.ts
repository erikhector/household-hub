import { expect, test } from "@playwright/test";
import { STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, expectRouterPatched } from "./ui";

// UX-200: Swedish writes "1,5 l". A comma with a digit on both sides is a
// decimal, not a list separator, so "1,5 l mjölk" is one row of 1.5 litres,
// not a "1" row plus a "mjölk × 5 l" row, and the row reads the amount back
// with the decimal comma it was typed with. As the Swedish member, on an own
// list so the seeded one is untouched. The closing letter keeps the
// generated suffix from ever ending in digits (a trailing "x29" would read
// as a quantity).
const unique = (label: string) => `${label} ${Date.now().toString(36)}z`;

test.use({ storageState: STORAGE_STATE_SV });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("Smart add reads a decimal comma as part of the amount", async ({ page }) => {
  const listName = unique("Decimalhandel");
  const milk = unique("mjölk");

  await page.goto("/dashboard/shopping-list");
  const newList = page.getByRole("button", { name: "Ny lista" });
  await expectHydrated(newList);
  // The dialog pushes a history entry as it opens (see expectRouterPatched).
  await expectRouterPatched(page);
  await newList.click();
  await page.getByRole("textbox", { name: "Namn" }).fill(listName);
  await page.getByRole("button", { name: "Skapa lista" }).click();
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();

  const addBox = page.getByRole("combobox", { name: "Lägg till på listan" });
  await expectHydrated(addBox);
  await addBox.fill(`1,5 l ${milk}`);
  await addBox.press("Enter");

  await expect(page.getByRole("checkbox", { name: new RegExp(`^${milk} × 1,5 l\\b`, "i") })).toBeVisible();
  // Exactly one row: no junk "1" row.
  await expect(page.getByRole("checkbox")).toHaveCount(1);
});
