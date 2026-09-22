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
| A | Auth, invites & household management | dispatched | — | |
| B | Inventory | merged | `02c581b` → merge commit in this branch | B1, B2 both done |
| C | Shopping list | dispatched | — | |
| D | Meal planning | dispatched | — | |
| E | Tasks | dispatched | — | |
| F | Household + personal budget (schema migration) | dispatched | — | merge last, after confirming migration applies cleanly |
| G | Profile, notifications & PWA | dispatched | — | |
| H | Nav shell: toggle labeling convention | merged | `14b4f25` → merge commit in this branch | H1 done, target-state convention |

Merge order once agents report back: A, B, C, D, E, G, H in any order
(zero file overlap besides dictionaries), then F last. After each merge:
`npx eslint .`, `npx tsc --noEmit`, `npx vitest run`, hand-resolving any
dictionary-file conflicts. Full suite + `npx next build` after all scopes
are in.

## Environment notes for this sandbox

- Local Postgres 16 cluster is running (`sudo pg_ctlcluster 16 main start`),
  db `household_hub`, user `household`/`household`. `.env` at repo root
  (gitignored) has `DATABASE_URL` pointed at it and `AUTH_SECRET` set.
  All migrations up to `20260921070000_add_recurring_template_splits` are
  applied.
- `.env` and `node_modules` are gitignored, so a fresh `git worktree` does
  not inherit them — each worktree needs its own `npm install` and its own
  `.env` (copy `.env.example`, set the same `DATABASE_URL`).
