import { expect, test, type Page } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// UX-41c: single-key shortcuts on the list pages and the `?` overlay. A
// desktop-only feature (a keyboard and a fine pointer), so this spec is
// desktop-only; the mobile project has no keys to press.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

// The key listener attaches on hydration, which a press right after goto can
// beat. Press again until the effect shows, so a slow hydration only delays.
async function pressUntil(page: Page, key: string, effect: () => Promise<void>) {
  await expect(async () => {
    await page.keyboard.press(key);
    await effect();
  }).toPass();
}

test("? opens the shortcuts overlay and Escape closes it", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/tasks");
  const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await pressUntil(page, "Shift+?", async () => {
    await expect(overlay).toBeVisible({ timeout: 1000 });
  });
  await expect(overlay.getByText("Next row")).toBeVisible();
  await expect(overlay.getByText("Search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

test("n opens Add task, and keys are ignored in the dialog's own fields", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard/tasks");
  const dialog = page.getByRole("dialog", { name: /task/i });
  await pressUntil(page, "n", async () => {
    await expect(dialog).toBeVisible({ timeout: 1000 });
  });
  const title = dialog.getByRole("textbox", { name: "Task title" });
  await title.fill("jnx kx");
  await expect(title).toHaveValue("jnx kx");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("j and k move through the task rows and x ticks the highlighted one", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const first = unique("Shortcut first");
  const second = unique("Shortcut second");
  await gotoRevealed(page, "/dashboard/tasks");
  for (const title of [first, second]) {
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByRole("textbox", { name: "Task title" }).fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  }

  const active = page.locator("[data-shortcut-active]");
  await pressUntil(page, "j", async () => {
    await expect(active).toHaveCount(1, { timeout: 1000 });
  });
  const firstRowLabel = await active.getByRole("checkbox").getAttribute("aria-label");
  expect(firstRowLabel).toMatch(/^Mark .+ as done$/);

  await page.keyboard.press("j");
  await expect(active).toHaveCount(1);
  const secondRowLabel = await active.getByRole("checkbox").getAttribute("aria-label");
  expect(secondRowLabel).not.toBe(firstRowLabel);

  await page.keyboard.press("k");
  await expect(active.getByRole("checkbox")).toHaveAttribute("aria-label", firstRowLabel!);

  await page.keyboard.press("x");
  const ticked = firstRowLabel!.replace(/^Mark (.+) as done$/, "$1");
  await expect(page.getByRole("checkbox", { name: `Mark ${ticked} as not done` })).toBeChecked();
});

test("/ focuses the inventory search and the keys type into it instead of moving rows", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard/inventory");
  const search = page.getByRole("searchbox");
  await pressUntil(page, "/", async () => {
    await expect(search).toBeFocused({ timeout: 1000 });
  });
  // The slash was swallowed, and j / k / x are text while a field has focus.
  await expect(search).toHaveValue("");
  await page.keyboard.type("jkx");
  await expect(search).toHaveValue("jkx");
  await expect(page.locator("[data-shortcut-active]")).toHaveCount(0);
});

test("n focuses the shopping list's add field", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  const add = page.getByRole("combobox", { name: /add/i }).first();
  await pressUntil(page, "n", async () => {
    await expect(add).toBeFocused({ timeout: 1000 });
  });
  await expect(add).toHaveValue("");
});

test("the keys do nothing on other pages", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/budget");
  await page.waitForTimeout(500);
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
