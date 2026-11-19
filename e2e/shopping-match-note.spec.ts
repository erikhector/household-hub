import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTouchTargets, gotoRevealed } from "./ui";

// UX-168: typed (unlinked) rows keep only their "Match item" chip; the
// explanation is one dismissible note per list, with a "Match all" action.
// The list is written straight to Postgres and removed afterwards (only this
// worker's household's rows).
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux168-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

// A list with two typed (unmatched) rows; returns its id.
async function insertListWithTwoUnmatched(): Promise<string> {
  const t = tag();
  const listId = `e2e-ux168-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Match note ${t}`,
  ]);
  for (const [i, name] of [`Quark ${t}`, `Kefir ${t}`].entries()) {
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased) VALUES ($1, $2, $3, 'pcs', false)`,
      [`e2e-ux168-item-${t}-${i}`, listId, name],
    );
  }
  return listId;
}

const NOTE_TEXT = "2 items aren't in your pantry yet. Match them so buying updates your stock.";

test("two unmatched rows share one explanation, which can be acted on or hidden", async ({ page, isMobile }) => {
  const listId = await insertListWithTwoUnmatched();
  await page.goto(`/dashboard/shopping-list/${listId}`);

  // Each row keeps its chip; the sentence appears once, with the count.
  await expect(page.getByRole("button", { name: "Match item", exact: true })).toHaveCount(2);
  const note = page.getByRole("main").getByText(NOTE_TEXT);
  await expect(note).toHaveCount(1);
  await expect(page.getByText("New to your pantry")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  if (isMobile) await expectTouchTargets(page);

  // "Match all" opens the batch matcher.
  const matchAll = page.getByRole("button", { name: "Match all" });
  await expectHydrated(matchAll);
  await matchAll.click();
  const dialog = page.getByRole("dialog", { name: "Match items to inventory" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Hide this note" }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Match item", exact: true })).toHaveCount(2);
});

// UX-186: at 200% text the note kept its sentence, "Match all" and × on one
// row, so the sentence shrank to a word per line and "Match all" was drawn
// over it. The actions now drop under the sentence when it would get
// narrower than a readable column.
test("at 200% text the note's actions drop under its sentence", async ({ page, isMobile }) => {
  test.skip(!isMobile, "text size is a phone setting");
  const listId = await insertListWithTwoUnmatched();
  await gotoRevealed(page, `/dashboard/shopping-list/${listId}`);
  // After navigation so it survives hydration (as in text-size.mobile.spec).
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const note = page.getByRole("main").getByRole("note");
  const text = note.getByText(NOTE_TEXT);
  const matchAll = note.getByRole("button", { name: "Match all" });
  await expect(text).toBeVisible();
  await expect(matchAll).toBeVisible();

  const noteBox = (await note.boundingBox())!;
  const textBox = (await text.boundingBox())!;
  const buttonBox = (await matchAll.boundingBox())!;
  const intersects =
    textBox.x < buttonBox.x + buttonBox.width &&
    buttonBox.x < textBox.x + textBox.width &&
    textBox.y < buttonBox.y + buttonBox.height &&
    buttonBox.y < textBox.y + textBox.height;
  expect(intersects, "the sentence and Match all overlap").toBe(false);
  expect(textBox.width / noteBox.width, "the sentence's share of the note's width").toBeGreaterThanOrEqual(0.6);
  await expectNoHorizontalOverflow(page);
});

test("at normal text on a wide screen the note stays one row", async ({ page, isMobile }) => {
  test.skip(isMobile, "one row is the wide-screen layout");
  const listId = await insertListWithTwoUnmatched();
  await gotoRevealed(page, `/dashboard/shopping-list/${listId}`);
  const note = page.getByRole("main").getByRole("note");
  await expect(note).toBeVisible();
  const textBox = (await note.getByText(NOTE_TEXT).boundingBox())!;
  const buttonBox = (await note.getByRole("button", { name: "Match all" }).boundingBox())!;
  const closeBox = (await note.getByRole("button", { name: "Hide this note" }).boundingBox())!;
  // Same row: each action starts above the sentence's bottom edge, to its right.
  for (const box of [buttonBox, closeBox]) {
    expect(box.y).toBeLessThan(textBox.y + textBox.height);
    expect(box.x).toBeGreaterThanOrEqual(textBox.x + textBox.width);
  }
});
