import { expect, test } from "@playwright/test";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  LOCALES,
  waitForDialogHistory,
} from "./ui";

// GAP-73: a task can carry a few lines of plain-text notes. They're edited in
// the sheet a tap on the title opens, shown as one truncated line under the
// title, and survive a reload.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

const COPY = {
  en: {
    add: "Add task",
    titleField: "Task title",
    notesField: "Notes",
    submit: "Add",
    save: "Save",
    edit: (title: string) => `Edit "${title}"`,
  },
  sv: {
    add: "Lägg till uppgift",
    titleField: "Uppgiftens titel",
    notesField: "Anteckningar",
    submit: "Lägg till",
    save: "Spara",
    edit: (title: string) => `Redigera "${title}"`,
  },
} as const;

for (const locale of LOCALES) {
  test.describe(`task notes (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });

    test("adds a note, reloads and finds it in the sheet and on the row", async ({ page, context, baseURL, isMobile }) => {
      const t = COPY[locale];
      await dismissCookieNotice(context, baseURL!);
      const title = unique("Replace the filter");
      const note = `Filter is under the sink, the 20x25 one ${unique("n")}`;

      await page.goto("/dashboard/tasks");
      const addButton = page.getByRole("button", { name: t.add });
      await expectHydrated(addButton);
      // MAINT-67: the Add sheet's history entry must land after Next patches
      // history, or the router's first commit rewrites it under the sheet.
      await expectRouterPatched(page);
      await addButton.click();
      await page.getByRole("textbox", { name: t.titleField }).fill(title);
      await page.getByRole("button", { name: t.submit, exact: true }).click();
      await waitForDialogHistory(page);

      // MAINT-94: the same window MAINT-93 closed in task-title-opens. On a
      // loaded phone run the edit sheet once never showed after this tap. The
      // Add sheet is gone and its back() has landed (above); also wait for
      // React to own the title button, so the tap opens the sheet the way a
      // person's later tap would.
      const main = page.getByRole("main");
      const titleButton = main.getByRole("button", { name: title, exact: true });
      await expectHydrated(titleButton);
      await titleButton.click();
      const sheet = page.getByRole("dialog", { name: t.edit(title) });
      const notes = sheet.getByRole("textbox", { name: t.notesField });
      await expect(notes).toHaveValue("");
      // 16 px on touch screens so iOS does not zoom the page on focus (the
      // Textarea steps down to 14 px for a mouse).
      if (isMobile) await expect(notes).toHaveCSS("font-size", "16px");
      await notes.fill(`  ${note}  `);
      await sheet.getByRole("button", { name: t.save, exact: true }).click();
      await waitForDialogHistory(page);

      await expect(main.getByText(note, { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.reload();
      await expect(main.getByText(note, { exact: true })).toBeVisible();
      // After the reload the row is server-rendered before it hydrates, and
      // the sheet's history entry needs the router's patch in place first.
      await expectHydrated(titleButton);
      await expectRouterPatched(page);
      await titleButton.click();
      await expect(
        page.getByRole("dialog", { name: t.edit(title) }).getByRole("textbox", { name: t.notesField }),
      ).toHaveValue(note);
    });
  });
}
