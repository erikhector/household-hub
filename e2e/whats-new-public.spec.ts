import { expect, test } from "@playwright/test";
import releases from "../src/lib/release-notes/releases.json";
import { dismissCookieNotice, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

// The public What's new page and the version link in every public page's
// footer (LegalFooter).
test.use({ storageState: { cookies: [], origins: [] } });

const latest = releases[0].version;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the landing footer shows the version and opens the release history", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("contentinfo").getByRole("link", { name: `What's new · v${latest}` });
  // innerText is the rendered text, so it catches a space the layout drops
  // (the accessible name doesn't).
  expect(await link.evaluate((el: HTMLElement) => el.innerText)).toBe(`What's new · v${latest}`);
  await link.click();
  await expect(page).toHaveURL(/\/whats-new$/);
  await expect(page.getByRole("heading", { level: 1, name: "What's new" })).toBeVisible();
  await expect(page.getByText(`The latest version is ${latest}.`)).toBeVisible();
  const newest = page.getByRole("listitem").first();
  await expect(newest.getByRole("heading", { name: `Version ${latest}` })).toBeVisible();
  await expect(newest.getByText("Latest", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(releases.length);
  await expectNoHorizontalOverflow(page);
});

test("the public release history is in Swedish with the Swedish cookie", async ({ page, context, baseURL }) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await page.goto("/login");
  await page.getByRole("contentinfo").getByRole("link", { name: `Nyheter · v${latest}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nyheter" })).toBeVisible();
  await expect(page.getByText(`Senaste versionen är ${latest}.`)).toBeVisible();
});
