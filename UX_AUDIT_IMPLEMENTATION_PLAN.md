# UX audit implementation plan — Sep 2026

Source: the full-app UX audit (auth/onboarding/household, inventory/shopping
list, meal planning/tasks, household+personal budget, profile/notifications/
PWA/legal, plus a cross-cutting nav/theme shell pass), five parallel
code-read reviews synthesized into one report. This plan turns every actionable
finding from that audit into file-scoped work packages, grouped so the
independent ones can run at the same time.

**How to execute this plan** (same model `UX_FRICTION_PROGRESS.md` and
`UX_CONSISTENCY_BACKLOG.md` already used on this repo): each Wave 2 scope is
disjoint in the *feature* files it touches and gets its own git worktree/
branch and subagent. The one shared-file risk across every scope is
`src/lib/i18n/dictionaries/en.ts`/`sv.ts` — nearly every finding adds copy,
and `satisfies Dictionary` fails the build if a key is missing in either
locale. Treat that as additive risk, not a blocker: scopes add their own new
keys under their own nested object, so real collisions are rare. One
orchestrator merges each worktree branch into the integration branch
**sequentially**, running `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`
after each merge, and hand-resolving the rare dictionary-file conflict before
moving to the next scope. Do not fan out more than the checklist below — two
agents editing the same file at the same time is exactly what this grouping
exists to prevent.

Status legend: `[ ]` not started · `[~]` in progress (agent dispatched) ·
`[x]` merged to integration branch · `[!]` blocked / needs a human decision.

---

## Wave 1 — quick wins, no worktree needed (do first, directly on the integration branch)

Small, single-purpose, no design judgment calls. Land these before Wave 2
branches are cut so nobody's worktree carries a stale copy of
`src/app/dashboard/page.tsx` or the dictionary files.

- [ ] **1.1 Low-stock threshold inconsistency** — `src/app/dashboard/shopping-list/actions.ts:153` (`generateFromLowStockAction`) and `src/app/dashboard/page.tsx:98-99` (Overview's low-stock widget) both still inline `quantity <= lowStockThreshold`; both should import and use `getStockStatus()` from `src/lib/stock-status.ts` instead, matching the strict-`<` fix already shipped there.
- [ ] **1.2 Privacy Policy & Terms contradict shipped self-service features** — `src/app/privacy/page.tsx` (~208-216, "Your rights…") and `src/app/terms/page.tsx` (~151-163, "Ending your account") both tell users to email the household owner for data export/account deletion; rewrite both to point at Profile's actual "Export my data" and "Delete account" controls.
- [ ] **1.3 "Copy" gives no confirmation** — `src/components/shopping/share-list-button.tsx:91-97` and `src/components/household/invite-button.tsx:79-86`; add a `toast.success()` or a 2-second "Copied" button-label swap to both.
- [ ] **1.4 Data-export heading precision** — Profile's "Export your data" heading/dict string could read as "everything"; retitle to something like "Export your account data" (copy-only).
- [ ] **1.5 Task-toggle aria-label wrong when un-completing** — `en.ts`/`sv.ts` `toggleCompleteAriaLabel` ("Mark {title} as done") used unconditionally at `src/components/tasks/tasks-client.tsx:128` even when the click will un-complete; add a second string selected by `task.completed`.

---

## Wave 2 — parallel feature scopes

Eight scopes below are file-disjoint from each other (aside from the shared
dictionary files, handled per the merge process above). Each is sized to be
one subagent's worktree.

### Scope A — Auth, invites & household management
**Files:** `src/lib/actions/auth.ts`, `src/lib/email.ts`, `src/components/auth/*`, `src/proxy.ts`, `src/lib/actions/household.ts`, `src/components/household/*` (member-list, join-signup-form, accept-invite-form, invite-button already covered by 1.3), `src/app/join/[token]/page.tsx`, `src/components/dashboard/getting-started.tsx`, `src/app/dashboard/page.tsx` (household-step wiring only — land after 1.1 merges to avoid touching the same file mid-flight)

| # | Finding | Severity |
| --- | --- | --- |
| A1 | 3 of 4 verification-email send paths silently claim success when the send failed (`signupAction`, `resendVerificationEmailForLoginAction`, `joinViaInviteSignupAction`) — check `{ error }` the same way the 4th path already does | **Now** |
| A2 | No password-visibility toggle on any password field | Next |
| A3 | Signup / join-signup have no password-confirmation field (Reset Password does) | Next |
| A4 | Resend-verification confirmation message has no retry without a full reload | Next |
| A5 | No redirect-back (`next`/`callbackUrl`) param anywhere in auth — deep links lost on sign-in | Next |
| A6 | Accepting an invite states no consequence (leave/remove copy does) | Next |
| A7 | Invalid/expired invite page has no navigation anywhere | Next |
| A8 | "Log in first, then reopen this invite link" is a footnote under a competing primary button — depends on A5's fix landing first for the real solution; at minimum make the two paths visually equal | Next |
| A9 | Sole owner can complete "Delete household" confirmation only to be told it's blocked at the last step; sole-owner "leave" has no button and no explanation | Next |
| A10 | Owner vs. Contributor role difference never explained in the UI | Later |
| A11 | Getting-started household step can't be dismissed for a deliberately solo household, contradicting its own "or skip it" copy | Next |

### Scope B — Inventory
**Files:** `src/components/inventory/last-updated-cell.tsx`, `inventory-table.tsx`, `starter-kit-picker.tsx`

| # | Finding | Severity |
| --- | --- | --- |
| B1 | "Last updated by" is hover-only (`title` attribute) — unreachable on touch devices | Next |
| B2 | Starter-kit chips are ~24-28px touch targets in a first-run mobile flow | Later |

### Scope C — Shopping list
**Files:** `src/components/shopping/*`, `src/app/dashboard/shopping-list/*`, `src/app/share/shopping-list/*`

| # | Finding | Severity |
| --- | --- | --- |
| C1 | "Complete list" has no confirmation, and its only recovery path (Archive → Unarchive) uses unrelated vocabulary with nothing in the UI naming it as "undo" | **Now** |
| C2 | Public share-list page never tells an anonymous visitor that checking a box changes real household inventory | **Now** |
| C3 | "Add low stock items" gives zero success/failure feedback | Next |
| C4 | `ResolveMappingsDialog` vs `RegisterReceiptDialog` handle an unpicked "existing item" selection two different silent ways (drop the row vs. create a duplicate) | Next |
| C5 | Disabled "Scan receipt" gives no reason (tooltip) | Later |

### Scope D — Meal planning
**Files:** `src/components/meal-planning/*`, `src/app/dashboard/meal-planning/*`

| # | Finding | Severity |
| --- | --- | --- |
| D1 | Deleting a meal-plan entry has no confirmation (recipe/task delete both do) | Next |
| D2 | Deleting a cooked entry leaves its inventory decrement in place with no trace/warning | Next |
| D3 | "Add to plan" can silently save outside the week currently shown in the Planner tab | Next |
| D4 | Custom (non-recipe) meal entries can never be marked cooked, with no explanation why | Later |
| D5 | Unit-mismatch is silently treated as "fully missing" in Missing Ingredients, unlike the identical case in Mark Cooked | Later |
| D6 | Sub-recipes ("components") have no explanation of their cross-flow effect | Later |
| D7 | Meal-variety recap dismiss doesn't persist across navigation | Later |
| D8 | No "jump to today" in the mobile week planner | Later |

### Scope E — Tasks
**Files:** `src/components/tasks/*`, `src/app/dashboard/tasks/*` (recurrence, actions) — 1.5 already lands the aria-label fix in Wave 1; this scope is everything else

| # | Finding | Severity |
| --- | --- | --- |
| E1 | A recurring task's next-due date is never shown; a reopened task loses its "last done by" history with no trace | Next |
| E2 | Weekly task recap dismiss doesn't persist across navigation | Later |

### Scope F — Household + personal budget (kept as one scope: nearly every finding here touches both sides of the link)
**Files:** `src/components/budget/*`, `src/components/personal-budget/*`, `src/app/dashboard/budget/*`, `src/app/dashboard/personal-budget/*`, `prisma/schema.prisma` + a new migration

| # | Finding | Severity |
| --- | --- | --- |
| F1 | "View in {household} Budget" can silently open the *active* household instead of the one the shared bill actually belongs to | **Now** |
| F2 | A recurring template's saved split is silently dropped the moment the bill is logged ("Log as-is" creates no split rows at all; "Log transaction" opens with the split checkbox unchecked) | **Now** |
| F3 | Shared rows never label the amount as "your share" — the `yourShare` dict string exists but is dead code | Next |
| F4 | "Log payment" opens pre-filled with the full bill amount, unlabeled, not the user's share | Next |
| F5 | Three independent entry points can log the same recurring bill with no duplicate-period guard | Next |
| F6 | "Split this bill" on a *template* never states it also broadcasts into every splittee's Personal Budget | Next |
| F7 | "Mark accounted for" clears a shared template for every member with no attribution — needs a schema change (`RecurringTemplateAck.createdByUserId`) and migration; do this first within the scope since everything else in F is additive | Next |
| F8 | "Everyone's settled up" overclaims — balances reset silently every month, copy doesn't say so | **Now** (money-trust issue) |
| F9 | Personal Budget has no CSV export, unlike Household Budget | Later |
| F10 | Deleting a category with an active recurring template (but no transactions) fails with only a generic error, on both budget and personal-budget delete actions | Next |
| F11 | New transactions default to today's date even while browsing a different month | Next |

### Scope G — Profile, notifications & PWA
**Files:** `src/components/profile/*`, `src/app/dashboard/profile/*`, `src/components/notifications/*`, `src/lib/service-worker.js`, `src/app/layout.tsx` (service-worker registration only)

| # | Finding | Severity |
| --- | --- | --- |
| G1 | Changing your email doesn't reset verification status or send a new verification email | **Now** |
| G2 | Dismissing a notification is inseparable from navigating away (no per-row dismiss, no bulk-dismiss from the bell dropdown) | Next |
| G3 | "Install app" implies offline resilience the app doesn't have — the service worker only handles push, has no fetch/caching, and is registered from only one place (the Push Notifications card), so most installers get no SW at all | Next |
| G4 | Push-permission denial can show a generic *and* a specific error message simultaneously | Later |

### Scope H — Nav shell: toggle labeling convention
**Files:** `src/components/dashboard/sidebar.tsx`, `src/components/dashboard/bottom-nav.tsx`

| # | Finding | Severity |
| --- | --- | --- |
| H1 | Theme toggle shows *current* state as its label; the locale toggle right next to it shows *target* state — pick one convention for both | Next |

---

## Explicitly no action (logged for completeness, not a work item)

- Getting-started steps have no partial-credit state (auth audit item, informational only — watch for step-flicker in practice, not a confirmed bug).
- Notifications living only inside the mobile "More" menu instead of a dedicated bottom-bar icon — this is stated as a deliberate space-saving decision in `notification-bell.tsx`'s own code comments, not an oversight. Leave as-is unless product wants to revisit the tradeoff.

---

## Suggested merge order

Wave 1 lands first (single orchestrator, no worktrees). For Wave 2, scopes
**A, B, C, D, E, G, H** have zero file overlap with each other and can be
dispatched to worktrees simultaneously. **Scope F** (budget) is the largest
and includes the one schema migration in this plan — start it in parallel
with the others but expect it to take longest and merge it last, after
confirming its migration applies cleanly on top of whatever the other
branches already changed in `prisma/schema.prisma` (none of them touch it,
so this should be a non-issue, but verify).

After all scopes merge: full suite (`npx eslint .`, `npx tsc --noEmit`,
`npx vitest run`, `npx next build`) on the integration branch, then a PR to
`master`.
