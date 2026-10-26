import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/seed";

// End-to-end tests against a running app and a real (local or CI service)
// Postgres. Unit tests stay in Vitest; these cover what they can't —
// pages actually rendering, forms actually submitting. See the "End-to-end
// tests" section of REQUIREMENTS.md.
//
// By default this starts `next start`, so run `npm run build` first. Set
// E2E_BASE_URL to test an already-running server (a dev server or a
// preview deploy) instead.
// Pick up DATABASE_URL etc. from .env the same way `next start` does, so
// `npm run test:e2e` works without exporting anything first. CI sets them
// in the environment instead and has no .env.
try {
  process.loadEnvFile();
} catch {}

// DEPS-4: the web sandbox ships one prebuilt Chromium under
// PLAYWRIGHT_BROWSERS_PATH and `playwright install` isn't allowed there, so
// after a Playwright bump the build it asks for (chromium_headless_shell-N)
// can be missing while an older full Chromium sits right beside it. When
// the expected headless shell isn't installed, launch that Chromium by
// path instead of failing. Anywhere the expected browser exists (CI, a
// normal local install) this returns undefined and Playwright finds its own.
function fallbackChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root) || existsSync(chromium.executablePath())) return undefined;
  const full = readdirSync(root).filter((e) => /^chromium-\d+$/.test(e)).sort().pop();
  const exe = full && path.join(root, full, "chrome-linux64", "chrome");
  return exe && existsSync(exe) ? exe : undefined;
}
const executablePath = fallbackChromium();
const launchOptions = executablePath ? { executablePath } : {};

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// UX-32: the real iPhone engine. WebKit is a separate browser download (and
// `--with-deps` needs root), so the `iphone` project is opt-in: CI sets
// E2E_WEBKIT=1 after `npx playwright install --with-deps webkit`; the
// `ci:local` gate and local runs skip it unless it's set the same way once
// WebKit is installed. Without it the project is NOT defined and this says
// so, rather than the run failing on a missing browser or silently looking
// like it covered iOS. Playwright loads this config in the runner and again
// in every worker; TEST_WORKER_INDEX is set only in workers, so the warning
// prints once per run.
const withWebkit = process.env.E2E_WEBKIT === "1";
if (!withWebkit && !process.env.TEST_WORKER_INDEX) {
  console.warn(
    "[playwright] E2E_WEBKIT is not set: the `iphone` (WebKit) project is skipped. Set E2E_WEBKIT=1 after `npx playwright install webkit` to run it.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Each worker gets its own seeded household and users (e2e/seed-data.ts),
  // so spec files run in parallel without racing on the same rows. Tests
  // inside a file still run in order, since some build on the one before.
  // Three, because the one `next start` process is the bottleneck, not the
  // browsers: on 4 cores, 1 worker took 10.1 min, 2 took 6.6, 3 took 5.6
  // and 4 took 5.4 but queued requests long enough that a 5 s wait timed
  // out. E2E_WORKERS overrides the count, like `--workers`.
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS) || 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Terse locally (agents read this output), HTML report in CI for humans.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    launchOptions,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Every spec runs twice, once per viewport: a desktop browser and a
  // phone. Squirrel is mostly used on phones, and the dashboard shell is a
  // different layout there (bottom bar instead of sidebar, only `main`
  // scrolls), so desktop-only coverage misses a whole class of bugs.
  // `*.desktop.spec.ts` / `*.mobile.spec.ts` are for the few checks that
  // only make sense at one size (e.g. which navigation is showing). Pixel 7
  // is the always-on phone: Chromium is all that's installed by default,
  // and the viewport and touch emulation are what matter for layout. The
  // `iphone` WebKit project below is opt-in (E2E_WEBKIT=1, set in CI).
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
      testIgnore: /\.mobile\.spec\.ts$/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
      testIgnore: /\.desktop\.spec\.ts$/,
    },
    // UX-7: the in-between sizes. Any touch device wider than `sm` (640 px)
    // gets the desktop shell, which used to scroll sideways, hide most of
    // the sidebar behind a tiny inner scroll and squeeze the inventory
    // table to one row there. A phone in landscape (short: the sidebar
    // has to scroll as a whole) and a portrait tablet (narrow: the
    // content column must not grow past the screen). Only the checks
    // about layout and touch sizing (UX-8) run here: every page renders
    // without overflow and with 44 px targets (`smoke`), the sidebar reaches
    // every section (navigation) and fields stay 16 px (form-control-sizes).
    {
      name: "landscape",
      use: { ...devices["Pixel 7"], viewport: { width: 863, height: 393 }, storageState: STORAGE_STATE },
      dependencies: ["setup"],
      testMatch: /(smoke|navigation\.desktop|form-control-sizes\.mobile)\.spec\.ts$/,
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        isMobile: true,
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
      // ux-141: the inventory is the card list at this width, not the table.
      testMatch: /(smoke|navigation\.desktop|form-control-sizes\.mobile|ux-141)\.spec\.ts$/,
    },
    // UX-32: iOS Safari renders and zooms differently from Chromium
    // (16 px field zoom, 100vh, number inputs, safe areas), so the Pixel 7
    // run above can't catch those. Every page renders (`smoke`), the main
    // user flows (`flows`) and the 16 px field-zoom check
    // (`form-control-sizes`, the zoom only iOS does) run in WebKit with an
    // iPhone 15. Only these three specs, to keep the extra runtime small.
    ...(withWebkit
      ? [
          {
            name: "iphone",
            use: { ...devices["iPhone 15"], storageState: STORAGE_STATE },
            dependencies: ["setup"],
            testMatch: /(smoke|flows|form-control-sizes\.mobile)\.spec\.ts$/,
          },
        ]
      : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // `next start` treats localhost as untrusted without this, and
        // Auth.js then rejects the login callback with a config error.
        // CRON_SECRET lets a spec call /api/cron/sync-notifications
        // (e2e/tonights-dinner-nudge.spec.ts), which reads the same fallback.
        env: { AUTH_TRUST_HOST: "true", CRON_SECRET: process.env.CRON_SECRET || "e2e-cron-secret" },
      },
});
