import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// UX-212: on touch devices body's radial gradient is sized to the root box,
// one screen tall (`html` is `h-dvh`), and `background-attachment: fixed`
// is deliberately off there (the iOS standalone-PWA safe-area quirk in
// globals.css). A page that scrolls showed a hard horizontal seam one screen
// down, where the gradient stopped and the flat `--gradient-end` fill began.
// The gradient now fades to that fill by the bottom of the first screen, so
// the colour just above and just below that line is the same.
//
// Sampled in a live viewport, not a full-page screenshot (whose stitching
// with a fixed background has its own artefacts), with the page's content
// hidden so only the background is measured. Both schemes and both
// orientations: the seam was widest in the dark scheme and on a short
// landscape screen, where the bottom edge's middle sat well inside the
// gradient (before the fix: 21,13,33 above vs 11,6,20 below). Also runs on
// the `tablet` project (playwright.config.ts), the other touch shell;
// ux-212.desktop guards the fine-pointer rule.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

type Rgb = [number, number, number];

/** The background colour at the left edge and the middle, just above and
 * just below one viewport height of the document, read from a screenshot of
 * the live viewport after scrolling there; null on a page that fits one
 * screen. */
async function sampleAroundFirstScreen(page: Page): Promise<Record<"left" | "middle", { above: Rgb; below: Rgb }> | null> {
  // Hide the content without changing the layout, so the samples see only
  // the page ground.
  await page.addStyleTag({ content: "body * { visibility: hidden !important; }" });
  const { vw, vh, max } = await page.evaluate(() => ({
    vw: window.innerWidth,
    vh: window.innerHeight,
    max: Math.floor(document.scrollingElement!.scrollHeight - window.innerHeight),
  }));
  // A page that fits on one screen has no seam to look for.
  if (max <= 6) return null;
  // To the bottom first (the item's acceptance), then back to where the
  // first screen ends, so that line is in view on a page of any length.
  // Retried: the router can still restore the scroll position just after
  // load, undoing a single scrollTo.
  const scrollTo = (y: number) =>
    expect
      .poll(() =>
        page.evaluate((top) => {
          window.scrollTo(0, top);
          return Math.round(window.scrollY);
        }, y),
      )
      .toBe(y);
  await scrollTo(max);
  const target = Math.round(Math.min(max, vh / 2));
  await scrollTo(target);
  const boundary = vh - target;
  const png = await page.screenshot({ scale: "css", animations: "disabled" });
  const pixels = await page.evaluate(
    async ({ b64, points }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
    },
    {
      b64: png.toString("base64"),
      points: [2, Math.round(vw / 2)].flatMap((x) => [
        [x, Math.round(boundary) - 3],
        [x, Math.round(boundary) + 3],
      ]),
    },
  );
  return {
    left: { above: pixels[0] as Rgb, below: pixels[1] as Rgb },
    middle: { above: pixels[2] as Rgb, below: pixels[3] as Rgb },
  };
}

const maxChannelDiff = (a: Rgb, b: Rgb) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} scheme`, () => {
    test.use({ colorScheme });

    for (const path of ["/", "/signup"]) {
      test(`${path} has no seam one screen down`, async ({ page }) => {
        // The project's own (portrait) screen, then the same device turned
        // sideways. Upright, the gradient's outer edge is close to the fill
        // colour already; on a short landscape screen the seam was widest.
        const upright = page.viewportSize()!;
        const sideways = { width: upright.height, height: upright.width };
        let seen = 0;
        for (const [orientation, size] of [
          ["portrait", upright],
          ["landscape", sideways],
        ] as const) {
          await page.setViewportSize(size);
          await gotoRevealed(page, path);
          await page.waitForLoadState("load");
          // A touch device: the fine-pointer rule that pins the gradient on
          // desktop doesn't apply here, and must not.
          expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(false);
          expect(await page.evaluate(() => getComputedStyle(document.body).backgroundAttachment)).not.toContain(
            "fixed",
          );

          const samples = await sampleAroundFirstScreen(page);
          if (!samples) continue;
          seen++;
          for (const [where, { above, below }] of Object.entries(samples)) {
            expect(maxChannelDiff(above, below), `${orientation}, ${where}: ${above} vs ${below}`).toBeLessThanOrEqual(
              2,
            );
          }
        }
        // Sideways, both pages are taller than the screen.
        expect(seen, "orientations where the page scrolls").toBeGreaterThan(0);
      });
    }
  });
}
