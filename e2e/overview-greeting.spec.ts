import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-72: the overview greets by the clock in the user's own time zone, with
// the first name only. The server runs in UTC, so 12:30 in Stockholm (10:30
// UTC in summer) used to say "Good morning". The seeded user is "E2E Tester".

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.describe("in Stockholm", () => {
  test.use({ timezoneId: "Europe/Stockholm" });

  test("at 12:30 the heading says good afternoon, by first name", async ({ page }) => {
    // 10:30 UTC is 12:30 CEST; a UTC-hour greeting would say "morning".
    await page.clock.setFixedTime(new Date("2026-07-01T10:30:00Z"));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Good afternoon, E2E" })).toBeVisible();
  });

  test("just before midnight UTC it is already evening", async ({ page }) => {
    // 20:30 UTC is 22:30 CEST.
    await page.clock.setFixedTime(new Date("2026-07-01T20:30:00Z"));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Good evening, E2E" })).toBeVisible();
  });
});

test.describe("in Los Angeles", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("the same instant is still morning", async ({ page }) => {
    // 10:30 UTC is 03:30 PDT.
    await page.clock.setFixedTime(new Date("2026-07-01T10:30:00Z"));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Good morning, E2E" })).toBeVisible();
  });
});
