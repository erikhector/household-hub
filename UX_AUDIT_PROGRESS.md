# UX audit implementation — delegation & progress tracker

Tracks execution of `UX_AUDIT_IMPLEMENTATION_PLAN.md` on branch
`claude/ux-audit-plan-sl3f0u`. Update this file as each scope lands so work
can resume after an interruption without re-deriving what's done.

## Legend
`todo` → `dispatched` → `merged` (or `deferred` with a reason)

## Wave 1 — quick wins

Merged directly to the integration branch (commits `87b4211`, `ac125a3`).
Items 1.1–1.5 all done. Verified: `npx eslint .` clean, `npx tsc --noEmit`
clean, `npx vitest run` 712/712 passing, `npx next build` green (25 routes).

## Wave 2 — parallel feature scopes

| Scope | Area | Status | Branch/worktree | Notes |
|---|---|---|---|---|
| A | Auth, invites & household management | merged | `2271718` → merge commit in this branch | A1-A11 all done; subagent hit a session rate limit mid-task, orchestrator finished it directly in its worktree (fixed a lint error + stale test fixtures/assertions) |
| B | Inventory | merged | `02c581b` → merge commit in this branch | B1, B2 both done |
| C | Shopping list | merged | `ed475cc` → merge commit in this branch | C1-C5 all done |
| D | Meal planning | merged | `de7633e` → merge commit in this branch | D1-D8 all done |
| E | Tasks | merged | `b55456f` → merge commit in this branch | E1, E2 both done |
| F | Household + personal budget (schema migration) | merged | `e4915e0` → merge commit in this branch | F1-F11 all done; subagent hit a session rate limit mid-task, orchestrator finished it directly in its worktree (missing dict keys + test-mock gaps) |
| G | Profile, notifications & PWA | merged | `855ce8a` → merge commit in this branch | G1-G4 all done; added new file `src/components/pwa/service-worker-registration.tsx` |
| H | Nav shell: toggle labeling convention | merged | `14b4f25` → merge commit in this branch | H1 done, target-state convention |

All 8 Wave 2 scopes are merged into this branch. Each merge was a clean
auto-merge (no manual dictionary-conflict resolution needed) and verified
with `npx eslint .` / `npx tsc --noEmit` / `npx vitest run` immediately
after. Final full-suite verification (including `npx next build`) recorded
below once complete.

## Environment notes for this sandbox

- Local Postgres 16 cluster is running (`sudo pg_ctlcluster 16 main start`),
  db `household_hub`, user `household`/`household`. `.env` at repo root
  (gitignored) has `DATABASE_URL` pointed at it and `AUTH_SECRET` set.
  All migrations up to `20260921070000_add_recurring_template_splits` are
  applied.
- `.env` and `node_modules` are gitignored, so a fresh `git worktree` does
  not inherit them — each worktree needs its own `npm install` and its own
  `.env` (copy `.env.example`, set the same `DATABASE_URL`).
