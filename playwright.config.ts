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
  // Specs share one seeded household, so run them one at a time rather
  // than risk two specs racing on the same rows.
  fullyParallel: false,
  workers: 1,
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
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
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
