import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Scope: unit tests against pure functions and mocked-I/O server actions —
// see REQUIREMENTS.md's "Testing" section for what's covered and why. No
// component rendering is needed yet, so this intentionally skips jsdom /
// @testing-library/react / @vitejs/plugin-react; add them (per
// node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md) if/when a
// future task adds component tests.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
