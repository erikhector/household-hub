# Agent Progress: Task I — Rate limiter durability

- [x] Read rate-limit.ts, rate-limit.test.ts, email.ts (precedent pattern), auth.ts/household.ts call sites, PRODUCTION_READINESS.md
- [x] Confirmed src/lib/logger.ts does NOT exist yet in this worktree (task F not merged here) -> used plain console.warn/console.error
- [x] Implemented optional Upstash Redis backend behind checkRateLimit (SET NX PX + INCR, fixed-window, matches in-memory semantics), activated only when both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set; in-memory remains default/fallback. checkRateLimit is now `async` (Promise<boolean>) since the Redis path needs network I/O — updated the 3 call sites in auth.ts/household.ts to add `await` (no other change to their logic).
- [x] Loud console.warn (once per process) when only in-memory limiter is active, gated to NODE_ENV==='production' only (to avoid dev/test noise); console.error + safe fallback to in-memory if a configured Redis call throws.
- [x] Extended rate-limit.test.ts to cover both backends: original 5 in-memory tests (now async) + a warning-noise test + a production-warning test, plus a parallel suite for the Redis path using vi.doMock("@upstash/redis") with a fake in-process store (no real Upstash calls), including a Redis-throws-falls-back-to-memory test. 13 tests total, all passing.
- [x] Added @upstash/redis (^1.38.4) to package.json dependencies; ran npm install (package-lock.json updated). Not using @upstash/ratelimit — implemented the fixed-window logic directly with plain SET NX PX / INCR to match the existing algorithm exactly.
- [x] Added additive block to .env.example for UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
- [x] Created DEPLOYMENT.md (did not exist yet in this worktree) with just my rate-limiter section
- [x] Found and fixed a bug during verification: my first draft added `import "server-only"` to rate-limit.ts copying the email.ts pattern, but that package was never actually a dependency of this project (not in package.json/package-lock, not in node_modules) — original rate-limit.ts never imported it either. Removed it; all tests pass.
- [x] Ran npm run lint — 1 pre-existing failure in src/components/theme/use-theme-cycle.ts, confirmed present on master via git stash (unrelated to this task)
- [x] Ran npx tsc --noEmit — 6 pre-existing PageProps/LayoutProps errors in unrelated page/layout files, confirmed present on master via git stash (unrelated to this task, looks like missing generated Next.js 16 route types)
- [x] Ran npm run test — 342/342 tests passed across 24 files
- [x] Commit work on current branch
- [x] Final report
