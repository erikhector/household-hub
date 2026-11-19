import { expect, test, type Locator } from "@playwright/test";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets, gotoRevealed, LOCALES } from "./ui";

// UX-196 (DESIGN.md principle 3, hierarchy): in a possible-duplicates group
// each candidate reads as one unit. Its name used to sit about 12 px below
// its "Keep" radio, and its detail line ("2 pcs") fell between that row's
// controls and the next row's, so "Merge" read as belonging to neither
// item, on a screen where ticking the wrong row merges the wrong item away.
// Measured on the seeded pair (e2e/seed.ts: "Crème fraiche" in pcs and
// "crème fraiche" in dl), which no spec merges or dismisses. It also runs
// on the `tablet` project (playwright.config.ts), where the page has the
// desktop shell with touch-sized controls.
const SEEDED_KEEPER = "Crème fraiche";

async function box(target: Locator) {
  const rect = await target.boundingBox();
  expect(rect, "the element is laid out").not.toBeNull();
  return rect!;
}

for (const locale of LOCALES) {
  test.describe(`possible duplicates (${locale})`, () => {
    // Signed in, the language comes from the account (see smoke.spec.ts).
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("each row's name lines up with its Keep control, and its details stay in the row", async ({ page }, testInfo) => {
      await gotoRevealed(page, "/dashboard/inventory/items?filter=duplicates");
      const group = page.getByRole("listitem", { name: SEEDED_KEEPER, exact: true });
      await expect(group).toBeVisible();
      const rows = group.getByRole("listitem");
      await expect(rows).toHaveCount(2);

      const measured = [];
      for (const row of await rows.all()) {
        measured.push({
          keep: await box(row.getByRole("radio")),
          name: await box(row.getByRole("link")),
          // The detail line is the only text in a row that starts with a
          // number (the quantity): "2 pcs", "0 dl · never stocked".
          details: await box(row.getByText(/^\d/)),
        });
      }

      for (const [index, { keep, name, details }] of measured.entries()) {
        const offset = Math.abs(keep.y + keep.height / 2 - (name.y + name.height / 2));
        expect(offset, `row ${index + 1}: the name's centre is this far from its Keep radio's`).toBeLessThanOrEqual(4);
        // The details belong to this row: under its own name…
        expect(details.y, `row ${index + 1}: the details start under the name`).toBeGreaterThanOrEqual(name.y + name.height - 1);
        // …and finished before the next row's Keep control starts.
        const next = measured[index + 1];
        if (next) expect(details.y + details.height, `row ${index + 1}: the details end above the next row's Keep`).toBeLessThanOrEqual(next.keep.y);
      }

      await expectNoHorizontalOverflow(page);
      // M3 is a touch rule; the desktop project, with a mouse, is denser.
      if (testInfo.project.name !== "desktop") {
        await expectTouchTargets(page);
        await expectTargetsApart(group);
      }
    });
  });
}
