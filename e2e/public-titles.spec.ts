import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { PUBLIC_ROUTES } from "./routes";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_SHOPPING_LIST, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, LOCALES, setLocaleCookie } from "./ui";

// UX-64: every public page names itself in the tab ("Log in · Squirrel"),
// has exactly one <h1>, and the three pages people pass around (landing,
// invite, shared list) carry the og: tags a chat app builds its preview from.
test.use({ storageState: { cookies: [], origins: [] } });

const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`;
const inviteToken = `ux64-inv-${stamp}`;
const shareToken = `ux64-share-${stamp}`;

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await withDb(async (c) => {
    await c.query(`DELETE FROM "Invitation" WHERE "token" = $1`, [inviteToken]);
    await c.query(`DELETE FROM "ShoppingListShareLink" WHERE "token" = $1`, [shareToken]);
  });
}

test.beforeAll(async () => {
  await cleanup();
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt") VALUES ($1, $2, $3, now() + interval '1 day')`,
      [`inv-${inviteToken}`, E2E_HOUSEHOLD.id, inviteToken],
    );
    await c.query(
      `INSERT INTO "ShoppingListShareLink" ("id", "shoppingListId", "token") VALUES ($1, $2, $3)`,
      [`share-${shareToken}`, E2E_SHOPPING_LIST.id, shareToken],
    );
  });
});
test.afterAll(cleanup);

// The tab title each route shows, per language.
const TITLES: Record<string, { en: string; sv: string }> = {
  "/": { en: "Squirrel: the shopping list that keeps itself up to date", sv: "Squirrel: inköpslistan som sköter sig själv" },
  "/login": { en: "Log in · Squirrel", sv: "Logga in · Squirrel" },
  "/privacy": { en: "Privacy policy · Squirrel", sv: "Integritetspolicy · Squirrel" },
  "/terms": { en: "Terms of service · Squirrel", sv: "Användarvillkor · Squirrel" },
};

for (const locale of LOCALES) {
  test.describe(`titles and headings (${locale})`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
      await dismissCookieNotice(context, baseURL!);
    });

    for (const route of PUBLIC_ROUTES) {
      test(`${route.path} has a localised title and one h1`, async ({ page }) => {
        await page.goto(route.path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

        const title = await page.title();
        const expected = TITLES[route.pattern]?.[locale];
        if (expected) {
          expect(title).toBe(expected);
        } else {
          expect(title).toMatch(/ · Squirrel$/);
        }
      });
    }

    test("the invite page names the household in its title and preview", async ({ page }) => {
      await page.goto(`/join/${inviteToken}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const joinTitle = locale === "en" ? `Join ${E2E_HOUSEHOLD.name}` : `Gå med i ${E2E_HOUSEHOLD.name}`;
      await expect(page).toHaveTitle(`${joinTitle} · Squirrel`);
      await expectPreview(page, joinTitle);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
        "content",
        new RegExp(E2E_HOUSEHOLD.name),
      );
    });

    test("a shared list names the list in its title and preview", async ({ page }) => {
      await page.goto(`/share/shopping-list/${shareToken}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page).toHaveTitle(`${E2E_SHOPPING_LIST.name} · Squirrel`);
      await expectPreview(page, E2E_SHOPPING_LIST.name);
    });

    test("the landing page has a preview", async ({ page }) => {
      await page.goto("/");
      await expectPreview(page, TITLES["/"][locale]);
    });
  });
}

async function expectPreview(page: import("@playwright/test").Page, titleStart: string) {
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    new RegExp(`^${titleStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /\S/);
  // Crawlers need an absolute URL, so the layout's metadataBase must have
  // resolved the relative path.
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /^https?:\/\/.+\/icon-512-maskable\.png$/,
  );
}
