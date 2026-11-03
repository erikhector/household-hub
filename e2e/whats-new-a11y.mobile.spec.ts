import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { gotoRevealed } from "./ui";

// UX-175 (axe `scrollable-region-focusable`): on phones <main> is the only
// scroll region, and What's new has nothing focusable in it, so a keyboard
// user couldn't scroll the release list.
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

test("What's new has no scrollable-region-focusable violation on phones", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/whats-new");
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const result = await window.axe.run(document, { runOnly: ["scrollable-region-focusable"] });
    return result.violations.map((v: { id: string; nodes: { html: string }[] }) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.html.slice(0, 80)),
    }));
  });
  expect(violations).toEqual([]);
});
