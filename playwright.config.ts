import { defineConfig, devices } from "@playwright/test";
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

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

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
  // rather than an iPhone: the iPhone presets need WebKit, and only
  // Chromium is installed here and in CI; the viewport and touch
  // emulation are what matter for layout.
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
      testMatch: /(smoke|navigation\.desktop|form-control-sizes\.mobile)\.spec\.ts$/,
    },
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
        env: { AUTH_TRUST_HOST: "true" },
      },
});
