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
| `ux` | `UX-` | The daily design audit: see "The `ux` lens" below. | New `### UX` subsection in Phase 1 (create once) |
| `production` | `BUG-` | Only if a Sentry connector/token is available: unresolved issues from the last 7 days with ≥ 2 events. Otherwise reply "no production signal source" and stop. | New `### Bugs` subsection at the top of Phase 1 (create once) |
| `deps` | `DEPS-` | `npm outdated --json` and `npm audit --omit=dev --json`, summarised. One item per major upgrade or advisory; group patch/minor bumps into one item. | New `### Dependencies` subsection in Phase 1 (create once) |

## The `ux` lens: a daily design audit

The owner wants the UI to be what sets Squirrel apart, so this lens runs
every day and looks the way a senior product designer would: every
page, every action, every device class. It has three parts. Spend most
of the run on part 2.

**1. Broad sweep: every page, every device (each run).** Run
`npm run build`, then both committed sweeps. Don't write your own
crawler.

- `E2E_SCREENSHOT_DIR=<scratchpad>/shots npm run test:e2e:screenshots`
  photographs every route in `e2e/routes.ts` in `en` and `sv` on these
  projects:
  - `desktop`;
  - `mobile` (Pixel 7, dark);
  - `landscape` (863×393);
  - `tablet` (810×1080, touch).

  Any failing test there is already a finding.
- `E2E_AUDIT_DIR=<scratchpad>/audit npm run test:e2e:audit`
  (`playwright.audit.config.ts`) adds these projects:
  - `small-phone` (320 px);
  - `light` theme;
  - `text-200` (200% text);
  - `iphone` (WebKit, only when `E2E_WEBKIT=1`; run
    `npx playwright install webkit` first if the environment allows it,
    and say in the PR that WebKit was skipped if not);
  - `dialogs-mobile` and `dialogs-desktop`, which open every popup and
    close it with Escape.

  It writes `<project>.json` next to the screenshots. Read the JSON
  first and confirm each hit in its screenshot before believing it:
  overflow, offscreen, clipped, tinyText, smallFields, errors, and for
  popups offViewport, smallTargets, fields under 16 px (only when
  `phone` is true), missing
  `autoComplete`, and `escapeCloses: false`. Base UI's `aria-hidden`
  hidden inputs are already filtered out.

Look at the pictures, not just the numbers: misalignment, cramped rows,
washed-out light-theme controls, broken hierarchy and Swedish strings
that don't fit only show in the image. Delegate screenshot review to
sub-agents (at most `max_parallel_subagents`), one device set each. Tell
each one to return findings with file name, location, severity and fix.

**2. Deep dive: one area, every action (rotates).** Pick the area by the
weekday in Europe/Stockholm:

| Day | Area |
|---|---|
| Mon | Inventory and item pages |
| Tue | Shopping lists, shopping mode, the share page |
| Wed | Meal planning and recipes |
| Thu | Tasks, household, members and invites |
| Fri | Household and personal budgets |
| Sat | Overview, navigation shell, profile, notifications, what's new |
| Sun | Public, auth and legal pages, and the first-run flow (signup → first item → first list) |

For the area:

- **Drive every action through the UI** on Pixel 7 and on the 320 px
  phone: add, edit, delete, tick, undo, move, scan entry points, share,
  error paths (submit invalid data), empty, loading and long-name
  states, Swedish.
  - Use a throwaway Playwright script in the scratchpad against the
    seeded worker-0 household (`e2e/seed-data.ts`). Mutating it is fine.
  - Never commit the script.
- **Check each action against DESIGN.md**:
  - pending, then result feedback;
  - confirm or undo for destructive actions;
  - errors next to the field, keeping input;
  - the back gesture closes sheets;
  - Save reachable with the keyboard open;
  - right keyboard and autofill;
  - targets 44 × 44 px with 8 px gaps.
- **Read the area's components** (`src/components/<area>/`,
  `src/app/dashboard/<area>/`) for what screenshots can't show:
  - hover-only affordances;
  - missing `aria-label`s;
  - truncation whose full text is only in `title`;
  - hardcoded strings;
  - raw colours;
  - optimistic updates that don't roll back.

**3. State of the art (one idea per run, at most).**
- Compare the area with the best consumer apps doing the same job
  (Bring!, AnyList, Todoist, Things, Copilot Money, YNAB, Paprika, or
  whatever leads the category). A short web search is allowed.
- Ask what would make this area feel native and delightful on a phone
  that the competition already does: motion, gestures with visible
  equivalents, haptics, sheets, instant feedback, offline, charts,
  empty states.
- File it only if it's concrete and buildable, and not already a
  `UX-` item.
- Put larger ones in Phase 3. If it needs a product call (new
  scope, art, a paid service), mark it `[!]` under "Needs a decision".

**Choosing what to file.**
- Within `max_new_items_per_scout_run`, rank: hard-rule breaks (M1–M10)
  and visual bugs on any device class first, then platform issues (iOS,
  Android, tablet), then polish, then the state-of-the-art idea.
- Before writing, grep the open `UX-` titles and search open PRs for the
  same screen. A daily lens must not refile what yesterday's run, or an
  open PR, already covers. Extend an existing item only if it's
  unbuilt and the addition is small; otherwise skip.
- Every item cites the screenshot file or route, the device class and
  the file:line, names the principle or rule it breaks, and has an
  acceptance line an `e2e/` test could assert. That includes which
  Playwright project (`mobile`, `landscape`, `tablet`, `iphone`) the
  test should run in.
- Zero items is a fine result on a clean day: say so in the report and
  don't open a PR.

**Report.** The PR body lists each item. The final reply also gives the
day's area, and the device classes and themes swept. Then one line on
anything that needs a real device (iOS keyboard, decimal comma, push)
that only the owner can check.

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
Don't wait on or watch the PR; it's a proposal for a human. Start the PR
body with `🤖 autopilot-scout`. Report the PR link and a last line
`Owner action needed: none` (or what only the owner can do, e.g. a
connector the lens needs).
