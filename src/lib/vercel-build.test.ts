import { describe, expect, it } from "vitest";
import { shouldRunMigrations } from "../../scripts/vercel-build.mjs";

describe("shouldRunMigrations", () => {
  it("migrates production builds", () => {
    expect(shouldRunMigrations({ VERCEL_ENV: "production" })).toBe(true);
  });

  // The regression: a PR's preview build migrated the production database
  // it shares, breaking production's budget pages.
  it("skips preview builds by default", () => {
    expect(shouldRunMigrations({ VERCEL_ENV: "preview" })).toBe(false);
  });

  it("skips development and non-Vercel builds", () => {
    expect(shouldRunMigrations({ VERCEL_ENV: "development" })).toBe(false);
    expect(shouldRunMigrations({})).toBe(false);
  });

  it("lets an environment with its own database opt in", () => {
    expect(shouldRunMigrations({ VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "1" })).toBe(true);
    expect(shouldRunMigrations({ VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "true" })).toBe(false);
  });
});
