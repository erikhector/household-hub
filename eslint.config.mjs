import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A leading underscore marks a parameter that is there on purpose but
    // unused: a `vi.fn(async (_args: unknown) => …)` mock needs it so
    // `mock.calls` is typed. Without this each one is a warning, and they
    // were most of the count the weekly retro tracks, hiding the real ones.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // MAINT-108: a spec reaches Postgres and names its rows through
    // e2e/db.ts. Each spec used to carry its own copy of the client wrapper
    // and the name suffix, so a fix to the pattern had to be made forty
    // times and the weaker copies kept spreading to every new spec.
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Client']",
          message: "Open the database with withDb from e2e/db.ts, not a Client of the spec's own.",
        },
        {
          selector:
            ":matches(FunctionDeclaration, VariableDeclarator)[id.name=/^(withClient|withDb|mondayOf|unique|uniqueId|uniqueTag|suffix)$/]",
          message: "Import this helper from e2e/db.ts instead of defining a copy in the spec.",
        },
      ],
    },
  },
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
