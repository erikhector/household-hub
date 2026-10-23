import { expect, test, type Locator, type Page } from "@playwright/test";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-items";
import { en } from "../src/lib/i18n/dictionaries/en";
import { sv } from "../src/lib/i18n/dictionaries/sv";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

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

// A theme tap saves the choice to the account in the background
// (setThemeAction), and the account's theme is what the next visit opens
// with. The signed-in user is shared by every spec in the worker, so a test
// that ends, and closes its browser, with the last save unsent leaves a stale
// "light" or "dark" behind and the next run's "Theme: System" never appears
// (MAINT-44). Wait for each save to come back.
async function clickAndWaitForSave(page: Page, target: Locator) {
  const saved = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && "next-action" in request.headers();
  });
  await target.click();
  await saved;
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

      // Both footer buttons name the setting in use, not the one a tap picks.
      await expect(page.getByRole("button", { name: new RegExp(en.language.toggleLabel) })).toHaveText(
        "Language: English",
      );
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

    test("a chosen theme keeps the browser chrome when the system scheme flips", async ({ page }) => {
      await page.goto("/login");
      const toggle = page.getByRole("button", { name: new RegExp(en.theme.toggleLabel) });
      await toggle.click(); // system -> light
      await toggle.click(); // light -> dark
      await expect(toggle).toContainText("Theme: Dark");
      await expect(page.locator("html")).toHaveClass(/dark/);

      // The phone goes light (automatic switching at sunrise): the page stays
      // dark, so the chrome must too, including the light-scheme tag the
      // browser now applies.
      await page.emulateMedia({ colorScheme: "light" });
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect.poll(() => themeColors(page)).toEqual(["#0a0414", "#0a0414"]);
    });
  });

  test("the toggle is in the visitor's language", async ({ page, context, baseURL }) => {
    await setLocaleCookie(context, baseURL!, "sv");
    await page.goto("/login");
    await expect(page.getByRole("button", { name: new RegExp(sv.theme.toggleLabel) })).toContainText(
      "Tema: System",
    );
    await expect(page.getByRole("button", { name: new RegExp(sv.language.toggleLabel) })).toHaveText(
      "Språk: Svenska",
    );
  });

  test("the footer language button shows it is busy until the change is saved", async ({ page }) => {
    await page.goto("/login");
    // Hold the language change on its way to the server: the tap must show
    // before the answer comes back (M5).
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/login", async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) await held;
      await route.continue();
    });
    const button = page.getByRole("button", { name: new RegExp(en.language.toggleLabel) });
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    // Dimmed, so a sighted visitor sees the tap registered.
    await expect(button).toHaveCSS("opacity", "0.6");
    release();
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await page.unroute("**/login");
  });
});

test.describe("signed in", () => {
  test.use({ colorScheme: "light" });

  test("the shortcut shows the current theme and language", async ({ page, context, baseURL }, testInfo) => {
    // Expanded, the sidebar's buttons are named by their visible text; collapsed
    // they are icons named "Switch theme", which proves nothing here.
    await context.addCookies([{ name: SIDEBAR_COOKIE, value: "1", url: baseURL! }]);
    await page.goto("/dashboard");
    if (testInfo.project.name.startsWith("mobile")) {
      // The menu opens through React handlers, so a tap before hydration does
      // nothing and the menu never appears (MAINT-44, as MAINT-27 and MAINT-34).
      const more = page.getByRole("navigation").getByRole("button", { name: en.nav.more });
      await expectHydrated(more);
      await more.click();
      const theme = page.getByRole("menuitem", { name: "Theme: System" });
      await expect(theme).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Language: English" })).toBeVisible();
      // The menu stays open, so the next step is one tap away.
      await clickAndWaitForSave(page, theme);
      await expect(page.getByRole("menuitem", { name: "Theme: Light" })).toBeVisible();
      await clickAndWaitForSave(page, page.getByRole("menuitem", { name: "Theme: Light" }));
      await expect(page.getByRole("menuitem", { name: "Theme: Dark" })).toBeVisible();
      await expect(page.locator("html")).toHaveClass(/dark/);
      await clickAndWaitForSave(page, page.getByRole("menuitem", { name: "Theme: Dark" })); // back to system
    } else {
      const sidebar = page.getByRole("complementary");
      await expect(sidebar.getByRole("button", { name: "Theme: System", exact: true })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: "Language: English", exact: true })).toBeVisible();
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

    // Hold the language change on its way to the server: the tap must show
    // before the answer comes back (M5), with the group busy until then.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/dashboard/profile", async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) await held;
      await route.continue();
    });
    await language.getByText(en.language.swedish, { exact: true }).click();
    await expect(language.getByRole("radio", { name: en.language.swedish })).toBeChecked();
    await expect(language.getByRole("radio", { name: en.language.english })).toBeDisabled();
    release();
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await page.unroute("**/dashboard/profile");
    const svPreferences = page.getByRole("region", { name: sv.profile.sections.preferences });
    await expect(
      svPreferences.getByRole("group", { name: sv.language.heading }).getByRole("radio", { name: sv.language.swedish }),
    ).toBeChecked();
    await expectNoHorizontalOverflow(page);

    // Put the worker's account back for the specs that follow.
    await svPreferences.getByRole("group", { name: sv.language.heading }).getByText(sv.language.english, { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await clickAndWaitForSave(page, appearance.getByText(en.theme.system, { exact: true }));
    await expect(appearance.getByRole("radio", { name: en.theme.system })).toBeChecked();
  });
});
