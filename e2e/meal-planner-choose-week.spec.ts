import { expect, test } from "@playwright/test";
import { mondayOf, unique, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  expectTargetsApart,
} from "./ui";

// GAP-85: the planner's week range is a "Choose week" button that opens a
// date field; any date shows the week containing it, and "This week" is
// still the way back.
const DAY_MS = 24 * 60 * 60 * 1000;
const key = (day: Date) => day.toISOString().slice(0, 10);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The same range the planner prints (formatWeekRange in
// week-planner-helpers.ts), built with the server's Node ICU.
const range = (monday: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .formatRange(monday, new Date(monday.getTime() + 6 * DAY_MS))
    .replace(/[  ]/g, " ");

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("Choose week jumps to the week of any date, and This week comes back", async ({ page }, testInfo) => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thisMonday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
  // Ten weeks ahead, on whatever weekday today is: the planner must still
  // land on that week's Monday.
  const picked = new Date(today.getTime() + 70 * DAY_MS);
  const targetMonday = new Date(thisMonday.getTime() + 70 * DAY_MS);

  await page.goto("/dashboard/meal-planning");
  const main = page.getByRole("main");
  const chooseWeek = main.getByRole("button", { name: /^Choose week/ });
  // The range is the button's visible text, and its accessible name too.
  await expect(chooseWeek).toHaveAccessibleName(`Choose week: ${range(thisMonday)}`);
  await expect(chooseWeek).toHaveAttribute("aria-expanded", "false");

  if (testInfo.project.name === "mobile") {
    // M3: a 44 px target.
    const box = await chooseWeek.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }

  await expectHydrated(chooseWeek);
  await expectRouterPatched(page);
  await chooseWeek.click();
  await expect(chooseWeek).toHaveAttribute("aria-expanded", "true");
  const field = main.getByLabel("Show the week of");
  await expect(field).toBeVisible();
  // It starts on the week being shown.
  await expect(field).toHaveValue(key(thisMonday));
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name === "mobile") {
    // M4/M9: 16 px, so iOS doesn't zoom into the field.
    const fontSize = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  }

  await field.fill(key(picked));
  await expect(page).toHaveURL(new RegExp(`[?&]week=${key(targetMonday)}`));
  await expect(chooseWeek).toHaveAccessibleName(`Choose week: ${range(targetMonday)}`);
  // The field closes once the week is picked.
  await expect(main.getByLabel("Show the week of")).toHaveCount(0);

  // An empty week shows one "Add first dinner" instead of seven empty days
  // (M6), so plan a meal there to see the week's day cards.
  const name = unique("Julbord");
  try {
    const addFirst = main.getByRole("button", { name: "Add first dinner" });
    await expectHydrated(addFirst);
    await addFirst.click();
    const dialog = page.getByRole("dialog", { name: /^Add \w+ · \w+ \d+$/ });
    await dialog.getByRole("combobox", { name: "Recipe" }).click();
    await page.getByRole("option", { name: "Custom meal…" }).click();
    await dialog.getByRole("textbox", { name: "Meal name" }).fill(name);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(main.getByText(name)).toBeVisible();

    // That week's seven day cards, Monday to Sunday: each card's "Add meal"
    // is named by its day ("Add meal, Mon 25").
    for (const [i, weekday] of WEEKDAYS.entries()) {
      const day = new Date(targetMonday.getTime() + i * DAY_MS).getUTCDate();
      await expect(main.getByRole("button", { name: `Add meal, ${weekday} ${day}`, exact: true })).toBeVisible();
    }
    await expect(chooseWeek).toHaveAccessibleName(`Choose week: ${range(targetMonday)}`);
    if (testInfo.project.name === "mobile") {
      // M3: the button, the arrows and "This week" under it stay 8 px
      // apart, with the date field open too.
      const switcher = main.getByRole("link", { name: "Previous week" }).locator("..");
      await expectTargetsApart(switcher);
      await chooseWeek.click();
      await expect(main.getByLabel("Show the week of")).toBeVisible();
      await expectTargetsApart(switcher);
      await expectNoHorizontalOverflow(page);
      await chooseWeek.click();
    }

    // "This week" is the way back.
    await main.getByRole("link", { name: "This week" }).click();
    await expect(chooseWeek).toHaveAccessibleName(`Choose week: ${range(thisMonday)}`);
    await expect(main.getByRole("link", { name: "This week" })).toHaveCount(0);
  } finally {
    // Ten weeks out is near enough to today that other specs page through
    // it, so the meal doesn't outlive the test.
    await withDb((client) =>
      client.query(
        `DELETE FROM "MealPlanEntry" WHERE "freeformName" = $1
           AND "mealPlanId" IN (SELECT id FROM "MealPlan" WHERE "householdId" = $2)`,
        [name, E2E_HOUSEHOLD.id],
      ),
    );
  }
});

test("a date typed into the field waits for Enter", async ({ page, browserName }, testInfo) => {
  // The keys below drive Chromium's segmented date field (month, day, year
  // for en-US), which both the desktop and mobile projects use. WebKit's
  // field takes typing differently, so the nightly iphone run leaves it out.
  test.skip(browserName !== "chromium", "Chromium's segmented date field");
  await page.goto("/dashboard/meal-planning");
  const main = page.getByRole("main");
  const chooseWeek = main.getByRole("button", { name: /^Choose week/ });
  await expectHydrated(chooseWeek);
  await expectRouterPatched(page);
  await chooseWeek.click();
  const field = main.getByLabel("Show the week of");
  await expect(field).toBeFocused();
  const start = await field.inputValue();
  if (testInfo.project.name === "mobile") {
    // The platform's picker opened over the field (useful on a phone);
    // a tap on the month part closes it and leaves that part focused, as
    // for someone with a keyboard attached to a tablet.
    await field.click({ position: { x: 16, y: 10 } });
  }

  // Arrowing a segment changes the value but doesn't leave the week or
  // close the field.
  await field.press("ArrowUp");
  await expect(field).not.toHaveValue(start);
  await expect(field).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]week=/);
  // Nor does typing, which used to go on the "1" of "12" (January).
  await field.pressSequentially("12252027");
  await expect(field).toHaveValue("2027-12-25");
  await expect(field).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]week=/);

  // Enter goes to the week of the typed date.
  await field.press("Enter");
  const monday = mondayOf(new Date(Date.UTC(2027, 11, 25)));
  await expect(page).toHaveURL(new RegExp(`[?&]week=${key(monday)}`));
  await expect(chooseWeek).toHaveAccessibleName(`Choose week: ${range(monday)}`);
  await expect(main.getByLabel("Show the week of")).toHaveCount(0);
});

test("the date field closes again without leaving the week", async ({ page }, testInfo) => {
  await page.goto("/dashboard/meal-planning");
  const main = page.getByRole("main");
  const chooseWeek = main.getByRole("button", { name: /^Choose week/ });
  await expectHydrated(chooseWeek);
  await chooseWeek.click();
  const field = main.getByLabel("Show the week of");
  await expect(field).toBeFocused();
  if (testInfo.project.name === "desktop") {
    // With a keyboard: Escape, and focus goes back to the button.
    await field.press("Escape");
    await expect(chooseWeek).toBeFocused();
  } else {
    // On a phone (where the platform's picker opens over the page): the
    // button again.
    await chooseWeek.click();
  }
  await expect(main.getByLabel("Show the week of")).toHaveCount(0);
  await expect(chooseWeek).toHaveAttribute("aria-expanded", "false");
  await expect(page).not.toHaveURL(/[?&]week=/);
});
