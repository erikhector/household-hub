import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees (see the Agent tool's `isolation: "worktree"` option)
    // land under here as full nested checkouts of this repo, including
    // their own src/**. They're gitignored, but ESLint doesn't consult
    // .gitignore on its own — without this, `npm run lint` run from the
    // main checkout while any worktree exists recurses into every one of
    // them and reports their issues as if they were this checkout's own.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
