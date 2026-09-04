# AGENT_PROGRESS.md — Test framework setup + smoke tests

Branch: `feature/test-framework`

## Checklist

- [x] Pick test stack + install devDependencies (vitest@^3.2.7 pinned — see
      below for why not the latest v5; vite-tsconfig-paths@^6.1.1)
- [x] `vitest.config.ts`
- [x] `test` script in `package.json` (+ `test:watch`)
- [x] `format`/`plural` tests (`src/lib/i18n/format.ts`)
- [x] `session.ts` cookie-fallback tests (`requireHousehold`, mocked deps)
- [x] `auth.ts` Zod schema tests (via `signupAction`/`loginAction`, mocked deps)
- [x] `household.ts` Zod schema tests (via `createHouseholdAction`/`joinViaInviteSignupAction`, mocked deps)
- [x] Document test-file convention + stack in `REQUIREMENTS.md`
- [x] `REQUIREMENTS.md` new subsection, remove "tests" from "Not yet built"
- [x] `npx tsc --noEmit -p tsconfig.json` passes (0 errors)
- [x] `npx eslint src` passes (0 errors/warnings)
- [x] `npm run build` passes
- [x] All tests pass (`npm test` → 34/34 passed, 4 test files)
- [x] Final commit, everything checked off

## Decisions

- **Stack**: Vitest — confirmed via `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`,
  the only testing guide shipped in this Next.js version's docs (no Jest/Playwright guide present).
  Since scope here is pure functions / server actions with mocked deps (no component rendering
  needed), skipping `jsdom` / `@testing-library/react` / `@vitejs/plugin-react` — only `vitest` +
  `vite-tsconfig-paths` (for the `@/*` import alias) are needed as devDependencies.
- **Vitest version pin**: latest `vitest@5.0.0` requires `@types/node@^22 || >=24` as a peer, but
  this project pins `@types/node@^20` (shared across the app, out of scope to bump here) — used
  `vitest@^3.2.7` instead, whose peer range (`^18 || ^20 || >=22`) is compatible. Installed cleanly,
  no `--legacy-peer-deps`/`--force` needed.
- **`next-auth` in tests**: the real `next-auth` package's entrypoint imports `next/server`, which
  Vitest's Node test environment can't resolve outside an actual Next.js build/runtime. Worked
  around by `vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }))` in the
  two test files that need it (`auth.test.ts`, `household.test.ts`) — both the source file under
  test and the test itself import the same mocked class, so `error instanceof AuthError` checks
  still work correctly.
- **Environment**: `node` (vitest default) — no DOM needed.
- **File convention**: colocated `*.test.ts` next to the source file it tests (not a `__tests__/`
  tree) — e.g. `src/lib/i18n/format.test.ts`. Documented in REQUIREMENTS.md.
- **DB isolation**: no tests touch the real database. `session.ts`'s `requireHousehold` and the
  Zod-schema-bearing actions in `auth.ts`/`household.ts` are tested by mocking `@/lib/prisma`,
  `@/lib/auth`, `next/headers`, `next/navigation`, `next/cache` via `vi.mock` — the shared dev
  Postgres is never touched by `npm test`.
- Did not modify `src/lib/actions/auth.ts` or `src/lib/actions/household.ts` (out of scope per
  task's Primary files) — their Zod schemas are module-private, so they're exercised indirectly
  through the exported Server Actions (validation-error paths + one success path per schema) with
  all I/O (prisma, next-auth, next/headers, next/navigation) mocked.

## Flags / out-of-scope notes

(none yet)
