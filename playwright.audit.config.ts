import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/seed";

// The design-audit sweep (`npm run test:e2e:audit`), run daily by the
// autopilot-scout `ux` lens. Not a test gate: it never fails on what it
// finds. It photographs and measures the views the normal suite doesn't,
// so a human or the scout can review them against DESIGN.md:
//
// - `small-phone`: the narrowest phone still in use (iPhone SE 1st gen,
//   320 px). Pixel 7 at 412 px hides a whole class of squeezed rows.
// - `light`: Pixel 7 in the light theme. The app defaults to dark, so
//   light gets the least attention (washed-out disabled buttons, chart
//   colours as text).
// - `text-200`: Pixel 7 with the root font at 200%, the "Larger text"
//   setting many people use on Android and iOS.
// - `dialogs-mobile` / `dialogs-desktop`: every dialog, menu and select
//   on every page opened, photographed, measured and closed with Escape.
// - `iphone`: the same page sweep in real WebKit, only with E2E_WEBKIT=1
//   (see playwright.config.ts for why it's opt-in).
//
// Desktop, Pixel 7 dark, landscape and tablet screenshots come from
// `npm run test:e2e:screenshots` instead, so they aren't repeated here.
//
// One worker: the sweep only reads, and one seeded household (worker 0's)
// keeps the file names and the seed stable. Run `npm run build` first.
try {
  process.loadEnvFile();
} catch {}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const withWebkit = process.env.E2E_WEBKIT === "1";
const pixel7 = { ...devices["Pixel 7"], storageState: STORAGE_STATE };

export default defineConfig({
  testDir: "./e2e-audit",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  // A page with a dozen popups takes a while to open and close each one.
  timeout: 300_000,
  use: { baseURL, locale: "en-US" },
  projects: [
    { name: "setup", testDir: "./e2e", testMatch: /auth\.setup\.ts/ },
    {
      name: "small-phone",
      use: { ...devices["iPhone SE"], defaultBrowserType: "chromium", storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
    { name: "light", use: { ...pixel7, colorScheme: "light" }, dependencies: ["setup"] },
    { name: "text-200", use: pixel7, dependencies: ["setup"] },
    { name: "dialogs-mobile", use: pixel7, dependencies: ["setup"] },
    { name: "dialogs-desktop", use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE }, dependencies: ["setup"] },
    ...(withWebkit
      ? [{ name: "iphone", use: { ...devices["iPhone 15"], storageState: STORAGE_STATE }, dependencies: ["setup"] }]
      : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { AUTH_TRUST_HOST: "true" },
      },
});
