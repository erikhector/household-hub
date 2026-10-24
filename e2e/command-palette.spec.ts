import { expect, test } from "@playwright/test";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// UX-41a: the ⌘K / Ctrl+K command palette. Open, filter, run.
const SHORTCUT = "ControlOrMeta+k";

test("Ctrl+K opens the palette, typing filters it and Enter runs the command", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  await page.keyboard.press(SHORTCUT);

  const palette = page.getByRole("dialog", { name: "Command palette" });
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
  await page.keyboard.press(SHORTCUT);
  const palette = page.getByRole("dialog", { name: "Command palette" });
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
  await page.keyboard.press(SHORTCUT);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Type a command" }).fill("add task");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
});

test("Add to shopping list focuses the add box of the list in use", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard");
  await page.keyboard.press(SHORTCUT);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Type a command" }).fill("shopping list");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/?]+$/);
  await expect(page.getByRole("combobox", { name: "Add to the list" })).toBeFocused();
});
