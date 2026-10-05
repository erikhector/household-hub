---
name: autopilot-scout
description: Autonomous scout for household-hub. Examines the app through one lens (competitors, code, ux, production, deps) and adds a few well-scoped items to BACKLOG.md via a PR. Never writes app code. Use when a routine says "run autopilot-scout <lens>".
---

# Autopilot scout

Find improvements, record them. **Never change app code.** Output is at
most a handful of BACKLOG.md entries in one small `docs:` PR.

## 0. Gate (stop early, spend nothing)

1. Read `AUTOPILOT.md`. If `enabled` or `scouts_enabled` is false, reply
   "autopilot disabled" and stop.
2. If an open PR titled `docs(backlog): <lens> scan` already exists, stop:
   one pending scan per lens.

## 1. Know what's already known

`grep -n '\*\*[A-Z]\+-[0-9A-Z]\+\.' BACKLOG.md` lists every open item in one
call. Read nothing else from BACKLOG.md except the section you'll write to.
Only add items not already covered there or in REQUIREMENTS.md's headings
(`grep -n '^#' REQUIREMENTS.md`), and none PRODUCT.md's "Decision log"
already turned down.

## 2. Look through your lens

| Lens | Prefix | How | Where it goes |
|---|---|---|---|
| `competitors` | `GAP-` | Web search 2–3 competitor apps from the "Competitive gap scan" intro; compare to REQUIREMENTS.md headings. | New dated `### YYYY-MM-DD scan` under "Competitive gap scan" |
| `code` | `SEC-`/`PERF-`/`MAINT-` | Rotate by ISO week number mod 3: security, performance, maintainability. Grep for smells (unscoped `prisma.*.findMany`, missing `requireHousehold`, `any`, N+1 loops, files > 800 lines); read only the hits. | Matching Phase 1 subsection |
| `ux` | `UX-` | `npm run build`, then `E2E_SCREENSHOT_DIR=<scratchpad>/shots npm run test:e2e:screenshots`: the committed UI suite (`e2e/smoke.spec.ts`, `e2e/public.spec.ts`) visits every page in `e2e/routes.ts` on desktop (1280×720) and mobile (Pixel 7, 412 px) in `en` and `sv`, and saves `<desktop\|mobile>-<locale>-<route>.png`. Don't write your own crawler. Any failing test there (overflow, console error, error boundary) is already a finding. Then read DESIGN.md and review the screenshots against it, mobile first: the seven UX principles (user-centricity, consistency, hierarchy, context, user control, accessibility, usability), Squirrel's design principles, the hard Mobile UX rules (M1–M10) and the "UI review checklist". A Mobile UX rule break in existing UI is always worth an item; name the rule (e.g. "breaks M3"). Hunt for overflow, untranslated text, empty states that don't explain the next step, unclear buttons, more than one primary action, inconsistent patterns between sibling pages, missing loading/error states, missing feedback or undo, unlabelled or too-small controls. Each item names the principle it breaks. Also note user-visible behaviour with no `e2e/` spec covering it. | New `### UX` subsection in Phase 1 (create once) |
| `production` | `BUG-` | Only if a Sentry connector/token is available: unresolved issues from the last 7 days with ≥ 2 events. Otherwise reply "no production signal source" and stop. | New `### Bugs` subsection at the top of Phase 1 (create once) |
| `deps` | `DEPS-` | `npm outdated --json` and `npm audit --omit=dev --json`, summarised. One item per major upgrade or advisory; group patch/minor bumps into one item. | New `### Dependencies` subsection in Phase 1 (create once) |

## 3. Write items

At most `max_new_items_per_scout_run` (AUTOPILOT.md). Fewer strong items
beat many weak ones; zero is a valid result. Match the existing format:

```
- [ ] **UX-4. Short imperative title** (impact: high|med|low, effort: S|M|L) —
      what's wrong and who it hurts, with file:line or route evidence.
      Acceptance: the observable result that means it's done (for UI: what
      an e2e test would assert).
```

Next ID = highest existing number for that prefix + 1. Anything that needs
a product call (new feature scope, pricing, third-party accounts) gets
`[!]` and goes under "Needs a decision before building" instead.

## 4. Ship

Branch `autopilot/scout-<lens>-<date>`, commit only BACKLOG.md, open PR
titled `docs(backlog): <lens> scan <date>` with label `autopilot` and a
one-line summary per item. No release note (docs PRs don't release).
Don't wait on or watch the PR; it's a proposal for a human.
