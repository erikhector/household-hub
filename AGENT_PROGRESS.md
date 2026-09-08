# Task N: End-to-end golden-path smoke test — progress

- [x] Read PRODUCTION_READINESS.md for context
- [x] Read src/lib/actions/auth.test.ts fully (established mocking conventions)
- [x] Read src/lib/actions/household.test.ts fully (established mocking conventions)
- [x] Read src/lib/actions/auth.ts (signupAction, verifyEmailAction, loginAction)
- [x] Read household creation action(s) / src/lib/session.ts (requireHousehold/requireUserId)
- [x] Locate inventory action(s) (src/app/dashboard/inventory/actions.ts)
- [x] Locate shopping list action(s) (src/app/dashboard/shopping-list/actions.ts)
- [x] Locate budget/transaction action(s) (src/app/dashboard/budget/actions.ts)
- [x] Design minimal stateful in-memory fake Prisma covering only delegates touched
- [x] Write src/lib/actions/golden-path.test.ts driving the full sequence
- [x] Run test, iterate until passing
- [x] Deliberately break the chain (wrong user id via requireHousehold mock) and confirm test fails
- [x] Revert the deliberate break, confirmed passing again
- [x] npm run lint (clean)
- [x] npx next typegen && npx tsc --noEmit (clean; had to run `npx prisma generate`
      first — this fresh worktree had no src/generated/prisma client checked out,
      a pre-existing worktree setup gap unrelated to this change, which caused
      cascading `any`/module-not-found errors across the whole repo until generated)
- [x] npm run test (379/379 passed — 378 pre-existing + 1 new)
- [ ] Commit work with required Co-Authored-By trailer
- [ ] Final report
