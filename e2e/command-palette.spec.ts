import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// UX-41a: the ⌘K / Ctrl+K command palette. Open, filter, run.
const SHORTCUT = "ControlOrMeta+k";

// The shortcut listener attaches on hydration, which a press right after
// page.goto can beat. Press again only while the palette isn't up, so a slow
// hydration doesn't toggle it open and shut.
async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press(SHORTCUT);
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass();
  return palette;
}

test("Ctrl+K opens the palette, typing filters it and Enter runs the command", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Type a command" });
  await expect(input).toBeFocused();
  await expect(palette.getByRole("option", { name: "Add task" })).toBeVisible();
  await expect(palette.getByRole("option", { name: "Go to Overview" })).toBeVisible();

  await input.fill("household bud");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await input.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/budget$/);
  await expect(palette).toHaveCount(0);
});

test("arrow keys move the highlight and Escape closes", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Type a command" });

  await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await expect(palette.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowUp");
  await input.press("ArrowUp");
  await expect(palette.getByRole("option").last()).toHaveAttribute("aria-selected", "true");

  await input.fill("zzzz");
  await expect(palette.getByText("No matching commands.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("Add task opens the add-task dialog on the tasks page", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  await palette.getByRole("combobox", { name: "Type a command" }).fill("add task");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
});

test("Add to shopping list focuses the add box of the list in use", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  await palette.getByRole("combobox", { name: "Type a command" }).fill("shopping list");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/?]+$/);
  await expect(page.getByRole("combobox", { name: "Add to the list" })).toBeFocused();
});
