# Task C: CI pipeline — progress

- [x] Read AGENTS.md / PRODUCTION_READINESS.md, confirmed scope (task C only)
- [x] Read package.json scripts, README Node version requirement (Node 22+)
- [x] Read vitest.config.ts and *.test.ts files — confirmed Prisma is mocked
      (`vi.mock("@/lib/prisma", ...)` / hoisted mocks) in every test that
      touches persistence; no test imports a real PrismaClient. No DB
      service container needed for the test step.
- [x] Checked node_modules/next/dist/docs for Next.js 16 specifics —
      found `next typegen` (docs/01-app/03-api-reference/05-config/02-typescript.md)
      and confirmed empirically that `tsc --noEmit` needs `.next/types`
      (PageProps/LayoutProps helpers) which only `next dev`/`next build`/
      `next typegen` produce.
- [x] Locally run: npm run lint — FAILS (pre-existing, unrelated to CI task,
      see report / spawned follow-up task)
- [x] Locally run: npx next typegen && npx tsc --noEmit — passes, 0 errors
- [x] Locally run: npm run test — 24 files / 334 tests pass, no env vars set
- [x] Experimentally determined `npm run build` needs NO env vars at all
      (ran with DATABASE_URL/AUTH_SECRET fully unset, fresh .next dir,
      succeeded — all routes are dynamic (ƒ), none statically generated
      against the DB). No fake placeholder env vars added to the workflow.
- [x] Wrote .github/workflows/ci.yml (Node 22, npm cache, npm ci, lint,
      next typegen, tsc --noEmit, test, build — single job, no services:
      block, no env vars)
- [x] Re-verified locally with the exact commands/order the workflow runs
- [x] Commit work on current branch
- [x] Final report delivered
