import { expect, test } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { sv } from "../src/lib/i18n/dictionaries/sv";
import { dismissCookieNotice, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

// UX-51: a first visit follows the system theme, logged-out pages have a
// theme control, the shortcuts name the setting in use, and the Profile has
// Language and Appearance controls with every choice visible.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

function themeColors(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content),
  );
}

test.describe("logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.describe("light system", () => {
    test.use({ colorScheme: "light" });

    test("a first visit renders the light theme and the footer toggle cycles it", async ({ page }) => {
      await page.goto("/login");
      await expect(page.locator("html")).not.toHaveClass(/dark/);
      // The browser chrome colour matches the page: light.
      await expect.poll(() => themeColors(page)).toContain("#fefcff");

      const toggle = page.getByRole("button", { name: new RegExp(en.theme.toggleLabel) });
      await expect(toggle).toContainText("Theme: System");
      await toggle.click(); // system -> light
      await toggle.click(); // light -> dark
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(toggle).toContainText("Theme: Dark");
      // The chosen scheme beats the (light) system one for the chrome too.
      await expect.poll(() => themeColors(page)).toEqual(["#0a0414", "#0a0414"]);
      await expectNoHorizontalOverflow(page);

      // Stored in this browser, so it survives a reload.
      await page.reload();
      await expect(page.locator("html")).toHaveClass(/dark/);
    });
  });

  test.describe("dark system", () => {
    test.use({ colorScheme: "dark" });

    test("a first visit renders the dark theme", async ({ page }) => {
      await page.goto("/login");
      await expect(page.locator("html")).toHaveClass(/dark/);
    });
  });

  test("the toggle is in the visitor's language", async ({ page, context, baseURL }) => {
    await setLocaleCookie(context, baseURL!, "sv");
    await page.goto("/login");
    await expect(page.getByRole("button", { name: new RegExp(sv.theme.toggleLabel) })).toContainText(
      "Tema: System",
    );
  });
});

test.describe("signed in", () => {
  test.use({ colorScheme: "light" });

  test("the shortcut shows the current theme and language", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    if (testInfo.project.name.startsWith("mobile")) {
      await page.getByRole("navigation").getByRole("button", { name: en.nav.more }).click();
      const theme = page.getByRole("menuitem", { name: "Theme: System" });
      await expect(theme).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Language: English" })).toBeVisible();
      // The menu stays open, so the next step is one tap away.
      await theme.click();
      await expect(page.getByRole("menuitem", { name: "Theme: Light" })).toBeVisible();
      await page.getByRole("menuitem", { name: "Theme: Light" }).click();
      await expect(page.getByRole("menuitem", { name: "Theme: Dark" })).toBeVisible();
      await expect(page.locator("html")).toHaveClass(/dark/);
      await page.getByRole("menuitem", { name: "Theme: Dark" }).click(); // back to system
    } else {
      const sidebar = page.getByRole("complementary");
      await expect(sidebar.getByRole("button", { name: /Theme: System|Switch theme/ })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Language: English|Switch language/ })).toBeVisible();
    }
  });

  test("Profile has Language and Appearance controls", async ({ page }) => {
    await page.goto("/dashboard/profile");
    const preferences = page.getByRole("region", { name: en.profile.sections.preferences });
    const appearance = preferences.getByRole("group", { name: en.theme.heading });
    const language = preferences.getByRole("group", { name: en.language.heading });

    await expect(appearance.getByRole("radio", { name: en.theme.system })).toBeChecked();
    await expect(language.getByRole("radio", { name: en.language.english })).toBeChecked();

    await appearance.getByText(en.theme.dark, { exact: true }).click();
    await expect(appearance.getByRole("radio", { name: en.theme.dark })).toBeChecked();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await appearance.getByText(en.theme.light, { exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await language.getByText(en.language.swedish, { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    const svPreferences = page.getByRole("region", { name: sv.profile.sections.preferences });
    await expect(
      svPreferences.getByRole("group", { name: sv.language.heading }).getByRole("radio", { name: sv.language.swedish }),
    ).toBeChecked();
    await expectNoHorizontalOverflow(page);

    // Put the worker's account back for the specs that follow.
    await svPreferences.getByRole("group", { name: sv.language.heading }).getByText(sv.language.english, { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await appearance.getByText(en.theme.system, { exact: true }).click();
    await expect(appearance.getByRole("radio", { name: en.theme.system })).toBeChecked();
  });
});
