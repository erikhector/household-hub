# UX friction backlog — delegation & progress tracker

Tracks execution of `UX_FRICTION_BACKLOG.md` on branch
`claude/ux-friction-backlog-delegation-jmg5gv`. Update this file as each
item lands so work can resume after an interruption (rate limit, session
restart) without re-deriving what's done.

## Legend
`todo` → `in-progress` → `done` (or `deferred` with a reason)

## Assignment (to avoid overlapping edits)

| # | Item | Files | Owner | Status |
|---|------|-------|-------|--------|
| 1 | Email verification banner dismiss | `email-verification-banner.tsx`, `dashboard/layout.tsx`, dictionaries, Profile page | subagent A | done (merged) |
| 2 | Needs-mapping inline hint at add-time | `shopping-list-client.tsx`, `shopping-list/actions.ts`, dictionaries | subagent B | done (merged) |
| 3 | Cost analyzer empty-state hint copy | dictionaries (`en.ts`/`sv.ts` `costAnalyzer.noSpendingData`/`noTrendData`) | orchestrator (direct) | done |
| 4 | At-threshold restock badge (`<=` → `<`) | `stock-status.ts`, `stock-status.test.ts` | orchestrator (direct) | done |
| 5 | Meal planning in primary mobile nav | `nav-items.ts` (swapped Household budget → Meal planning; product call made per backlog's own reasoning) | orchestrator (direct) | done |
| 6+7 | Starter categories + persistent "Manage categories" entry | `budget-onboarding.tsx`, `starter-category-picker.tsx` (new), `budget-tabs.tsx`, `budget/actions.ts`, dictionaries | subagent C | done (merged) |
| HK | Next.js dev-mode build-activity indicator overlap | `next.config.ts` (`devIndicators: false`) | orchestrator (direct) | done |
| 8 | Manual purchase-price collection | — | deferred: needs a product decision per backlog's own note, revisit once item 3 has shipped and there's usage signal | deferred |

## Final status

All 7 actionable Wave 1/2 items + housekeeping are merged into
`claude/ux-friction-backlog-delegation-jmg5gv`. Item 8 (Wave 3) is
deferred per the backlog's own note — it explicitly needs a product
decision, to be revisited once item 3's cheap fix has had time to show
whether receipt scanning alone gets households populating price data.

Verified together on the integrated branch:
- `npx eslint .` — clean.
- `npx vitest run` — 46 files / 640 tests passing.
- `npx next build` — full pipeline green (compile, typecheck, page data
  collection, static generation for all 24 routes).
- **Not verified**: an actual browser/Playwright run of the new UI. This
  sandbox has no running Postgres (`docker` has no daemon available) to
  bring up the app against, so the golden-path/action test suite is the
  evidence for correctness here — the UI itself has not been visually
  confirmed working. Flagging this explicitly rather than claiming a
  browser check that didn't happen.

## Pre-existing issue found during verification — fixed

`next build`'s TypeScript pass was failing on `prisma7.config.ts(13,5)`:
`directUrl` doesn't exist on the installed `@prisma/config@7.10.0`'s
`Datasource` type (only `url`/`shadowDatabaseUrl` are declared there). This
predated this branch — already on `origin/master` as of commit `9a93cd5`
("Fix migrate deploy P1002 timeout by wiring DIRECT_URL into Prisma
config") — and would have failed the repo's own CI (`.github/workflows/ci.yml`
runs `npm run build` on every push/PR). Out of scope for the UX backlog,
but confirmed with the user and fixed here since it blocks a green build
for this PR (and every future one) otherwise.

Root-caused before touching anything: `directUrl` genuinely works at
runtime (`npx prisma validate`/`generate` both accept it fine) — it's
purely a stale/incomplete type declaration in this Prisma version.
Confirmed the schema-level alternative (`directUrl` inside
`schema.prisma`'s `datasource` block, the pre-config-file v6 pattern) is
explicitly rejected by `prisma validate` ("no longer supported in schema
files. Move connection URLs to `prisma.config.ts`") — so the config file is
the only place this can live. Fix: assign the datasource object through a
separately-typed `const` in `prisma7.config.ts` instead of an inline object
literal, which sidesteps TypeScript's excess-property check without
changing the runtime value at all. No behavior change — `DATABASE_URL`/
`DIRECT_URL` wiring for `migrate deploy` is identical to before.

## Notes
- Items 2 and 3 do NOT overlap in practice: item 2's fix lives entirely in
  `shopping-list-client.tsx` (an inline hint next to the unresolved-item
  row), item 3's fix is copy-only in `cost-analyzer.tsx`. No shared file.
- Items 6 and 7 DO overlap (both touch the budget onboarding banner /
  category manager / tabs), so they're one assignment done together by a
  single subagent to avoid conflicting edits.
- Each subagent works in its own git worktree, commits there, and the
  orchestrator merges each worktree branch into
  `claude/ux-friction-backlog-delegation-jmg5gv` sequentially, running
  lint/typecheck/tests after each merge before moving to the next.
- Final step: full test suite + build on the integrated branch, then a PR
  from this branch to `master` (not a direct push to master) so it goes
  through normal review/CI rather than bypassing it.
