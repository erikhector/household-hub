import { expect, test } from "@playwright/test";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { expectHydrated, LOCALES } from "./ui";

// UX-183: an empty name or quantity in the add-item sheet is worded under its
// field in the page's language (role="alert"), instead of the browser's own
// bubble. Focus moves to the field and what was typed elsewhere stays.
const MESSAGES = {
  en: { add: "Add item", name: "Name", quantity: "Quantity", noName: "Enter a name", noQuantity: "Enter a quantity" },
  sv: { add: "Lägg till vara", name: "Namn", quantity: "Antal", noName: "Ange ett namn", noQuantity: "Ange ett antal" },
} as const;

for (const locale of LOCALES) {
  test.describe(`add-item field errors (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    const t = MESSAGES[locale];

    test("an empty name and quantity are flagged under their fields", async ({ page }) => {
      await page.goto("/dashboard/inventory");
      const opener = page.getByRole("main").getByRole("button", { name: t.add, exact: true }).filter({ visible: true });
      await expectHydrated(opener);
      await opener.click();
      const dialog = page.getByRole("dialog");
      const submit = dialog.getByRole("button", { name: t.add, exact: true });

      await dialog.getByLabel(t.quantity).fill("");
      await submit.click();
      // Name is first in the form, so it gets the alert and focus.
      const name = dialog.getByLabel(t.name, { exact: true });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();

      await name.fill("Flour");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toHaveCount(0);
      await submit.click();
      const quantity = dialog.getByLabel(t.quantity);
      await expect(dialog.getByRole("alert").filter({ hasText: t.noQuantity })).toBeVisible();
      await expect(quantity).toHaveAttribute("aria-invalid", "true");
      await expect(quantity).toBeFocused();
      // The blocked submit didn't reset the form.
      await expect(name).toHaveValue("Flour");
    });
  });
}
