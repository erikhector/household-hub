import { expect, test, type Browser, type Page } from "@playwright/test";
import { STORAGE_STATE_SV } from "./seed";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// GAP-65: on a shared list each line says who added it ("Added by Anna"),
// except the viewer's own lines. The seeded household has two members: the
// English user (E2E Tester) and the Swedish one (E2E Testare), so each adds
// a uniquely named line through the UI in their own browser context and then
// reads the list as the other, which covers both locales at once.
const LIST_URL = `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`;
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

const lineCheckbox = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
// The row (swipe wrapper) that holds a given line, so a label is asserted on
// that line and not on the rows earlier runs left on the shared list.
const lineRow = (page: Page, name: string) =>
  page.locator("[data-swipe-row]").filter({ has: lineCheckbox(page, name) });

async function addLine(page: Page, name: string) {
  await page.goto(LIST_URL);
  const addBox = page.getByRole("combobox", { name: /Add to the list|Lägg till på listan/ });
  await addBox.fill(name);
  await addBox.press("Enter");
  // Wait for the row before moving on: the add runs in a transition and a
  // navigation that races it drops the request.
  await expect(lineCheckbox(page, name)).toBeVisible();
}

async function asSwedishUser(browser: Browser, baseURL: string, page: Page) {
  const width = page.viewportSize()?.width ?? 1280;
  const context = await browser.newContext({
    storageState: STORAGE_STATE_SV,
    baseURL,
    viewport: page.viewportSize() ?? undefined,
    hasTouch: width < 640,
  });
  await dismissCookieNotice(context, baseURL);
  return context;
}

test("a shared list says who added each line, never on your own", async ({ page, browser, baseURL }) => {
  const byEnglish = unique("Oats en");
  const bySwedish = unique("Havre sv");

  await dismissCookieNotice(page.context(), baseURL!);
  await addLine(page, byEnglish);
  const svContext = await asSwedishUser(browser, baseURL!, page);
  const svPage = await svContext.newPage();
  await addLine(svPage, bySwedish);

  // The Swedish user sees the English user's line labelled, and not their own.
  await svPage.reload();
  await expect(lineRow(svPage, byEnglish).getByText("Tillagd av E2E Tester")).toBeVisible();
  await expect(lineCheckbox(svPage, bySwedish)).toBeVisible();
  await expect(lineRow(svPage, bySwedish).getByText(/Tillagd av/)).toHaveCount(0);
  await expectNoHorizontalOverflow(svPage);
  await svContext.close();

  // The English user sees the mirror image.
  await page.reload();
  await expect(lineRow(page, bySwedish).getByText("Added by E2E Testare")).toBeVisible();
  await expect(lineCheckbox(page, byEnglish)).toBeVisible();
  await expect(lineRow(page, byEnglish).getByText(/Added by/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
