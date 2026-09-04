# AGENT_PROGRESS.md — Test framework setup + smoke tests

Branch: `feature/test-framework`

## Checklist

- [ ] Pick test stack + install devDependencies
- [ ] `vitest.config.ts`
- [ ] `test` script in `package.json`
- [ ] `format`/`plural` tests (`src/lib/i18n/format.ts`)
- [ ] `session.ts` cookie-fallback tests (`requireHousehold`, mocked deps)
- [ ] `auth.ts` Zod schema tests (via `signupAction`/`loginAction`, mocked deps)
- [ ] `household.ts` Zod schema tests (via `createHouseholdAction`/`joinViaInviteSignupAction`, mocked deps)
- [ ] Document test-file convention + stack in `REQUIREMENTS.md`
- [ ] `REQUIREMENTS.md` new subsection, remove "tests" from "Not yet built"
- [ ] `npx tsc --noEmit -p tsconfig.json` passes
- [ ] `npx eslint src` passes
- [ ] `npm run build` passes
- [ ] All tests pass (`npm test -- --run`)
- [ ] Final commit, everything checked off

## Decisions

- **Stack**: Vitest — confirmed via `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`,
  the only testing guide shipped in this Next.js version's docs (no Jest/Playwright guide present).
  Since scope here is pure functions / server actions with mocked deps (no component rendering
  needed), skipping `jsdom` / `@testing-library/react` / `@vitejs/plugin-react` — only `vitest` +
  `vite-tsconfig-paths` (for the `@/*` import alias) are needed as devDependencies.
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
