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
| 1 | Email verification banner dismiss | `email-verification-banner.tsx`, `dashboard/layout.tsx`, dictionaries, Profile page | subagent A | todo |
| 2 | Needs-mapping inline hint at add-time | `shopping-list-client.tsx`, dictionaries | subagent B | todo |
| 3 | Cost analyzer empty-state hint copy | `cost-analyzer.tsx`, dictionaries | orchestrator (direct) | todo |
| 4 | At-threshold restock badge (`<=` → `<`) | `stock-status.ts` | orchestrator (direct) | todo |
| 5 | Meal planning in primary mobile nav | `nav-items.ts` | orchestrator (direct) | todo |
| 6+7 | Starter categories + persistent "Manage categories" entry | `budget-onboarding.tsx`, `category-manager.tsx`, `budget-tabs.tsx`, `budget/page.tsx`, dictionaries | subagent C | todo |
| HK | Next.js dev-mode build-activity indicator overlap | `next.config.ts` | orchestrator (direct) | todo |
| 8 | Manual purchase-price collection | — | deferred: needs a product decision per backlog's own note, revisit once item 3 has shipped and there's usage signal | deferred |

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
