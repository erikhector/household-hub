# Backlog

The single list of open work for Squirrel. Everything here is **not built
yet**; everything already shipped is documented in
[REQUIREMENTS.md](./REQUIREMENTS.md), and the planning docs that produced it
are kept for their design rationale in [`docs/archive/`](./docs/archive/)
(code comments still cite them by item).

**Picking an item:** one `MAINT-` item titled `Flaky: …` goes first,
then `UX-` items, whatever their phase (see AUTOPILOT.md, "What the
builder may pick"). Otherwise take the lowest phase you can. Within Phase 1, anything
can run in parallel except the file conflicts listed at the top of that phase. Phase 2
items each add a Prisma migration, so land them **one at a time**, each
rebased on the previous one's merge, to avoid migration-ordering conflicts.
Phase 3 items are large enough to deserve their own PR. The last section
needs a product decision before anyone builds anything: the
`autopilot-product` routine takes the ones AUTOPILOT.md delegates to it
and leaves the rest for the owner (see PRODUCT.md).

**Finishing an item:** document what shipped in the relevant REQUIREMENTS.md
section (as every feature so far has), then **delete the item from this
file** rather than ticking it — this file only ever holds open work. If a
design rationale is worth keeping beyond REQUIREMENTS.md, cite the ID in the
commit message.

Status legend: `[ ]` not started · `[~]` in progress · `[!]` blocked / needs
a decision.

IDs are prefixed by area so they stay stable as items move between phases:

| Prefix | Area | Origin |
|---|---|---|
| `AUTO-` | Shopping list & inventory automation — "make it feel like magic" | `docs/archive/AUTOMATION_BACKLOG.md` (design review, Sep 2026) |
| `BUDGET-` | Sharing code between the household and personal budgets | `docs/archive/PERSONAL_BUDGET_UNIFICATION.md` (design spike) |
| `PRICE-`, `INFRA-` | Open product decisions | `docs/archive/UX_FRICTION_BACKLOG.md`, `docs/archive/JOY_GAP_BACKLOG.md`, REQUIREMENTS.md |
| `GAP-` | Feature gaps vs. competing household/grocery/budget apps (AnyList, Bring!, Grocy, Listonic, Splitwise, Cozi, …) | recurring daily competitive scan, logged as dated entries below |
| `SEC-`, `PERF-`, `MAINT-` | Security, performance and maintainability | Three-way code audit, 2026-09-26 (this file is the only record) |
| `UX-`, `BUG-`, `DEPS-` | UX problems, production errors, dependency upgrades | Autopilot scouts (see AUTOPILOT.md); `SEC-`/`PERF-`/`MAINT-`/`GAP-` scouts reuse those prefixes |

Before any item: run lint → typegen → tsc → test → build (see AGENTS.md)
before calling it done, and add every new user-facing string to both
`en.ts` and `sv.ts`.

---

## Guardrails

**For every item:** everything in AGENTS.md's Conventions still applies —
`requireHousehold()` tenancy, no household id from the client, i18n in both
dictionaries, new browser storage goes through `cookie-inventory.ts`.

**For `AUTO-` items** — these came out of the automation review and
constrain *how* each one is built. The goal is to minimize how often a
household member has to type anything at all:

- **Suggest, don't silently mutate.** Anything that changes an inventory
  quantity or money (a `Transaction`, a `PriceHistory` row) is either an
  explicit user action or a one-tap-to-accept suggestion — never an
  invisible side effect. This is the same reasoning "Mark meal as cooked"
  uses in REQUIREMENTS.md for not auto-decrementing from the calendar.
  Filling in *defaults* on a row the user is about to save (a category, a
  unit, a price, an estimated expiry) is fine; changing stored numbers
  behind their back is not.
- **Every automation is correctable, and corrections stick.** If the app
  guesses a category/unit/shelf-life and the user changes it, that choice
  wins from then on for that item — the app never re-guesses over a human
  correction.
- **Undo over confirm.** Prefer doing the likely thing immediately with an
  "Undo" on the toast (the `MarkCookedDialog` pattern) over a confirmation
  dialog up front. Confirmation dialogs are for destructive, hard-to-undo
  actions only.
- **Works with no AI key configured.** Anything using the Gemini/Anthropic
  chain (`src/lib/actions/inventory-scan.ts`'s `resolveAttempts`) must have
  a deterministic, keyless path that still removes most of the typing. AI
  is the long tail, not the foundation. Any new AI call sends the minimum
  data needed (item names only — never quantities, prices or household
  info), is rate-limited per household with `checkRateLimit`, and is
  disclosed the same way AI shelf scan's is.
- **Predictions stay out of the bell.** Suggestions ("you usually buy
  coffee about now") live *inside* the shopping list as dismissible chips,
  not as notifications — the Joy Gap backlog's rule that a bell badge must
  mean something is actually wrong still applies.
- **Nothing new in the browser without the inventory.** Any new cookie/
  localStorage key goes through `src/lib/cookie-inventory.ts` (AGENTS.md).
  Prefer server-side storage for anything learned, so it's shared across a
  household's devices anyway.

Also carried over from the Joy Gap memo: no streaks or loss-aversion on
money, no member-vs-member leaderboards, and positive notifications stay rare
enough to trust.

---

## Phase 1 — independent, no schema changes

Parallel-safe except where noted.

### Bugs

### Dependencies

### Performance

### Maintainability

- [ ] **MAINT-12. ESLint 10** (low, S, own PR — touches `package.json`/lockfile) `[!]` —
      the rest of MAINT-12 is done (REQUIREMENTS.md, "Migration drift and
      tooling pins"). Waiting on `eslint-config-next`'s plugins:
      `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0 and
      `eslint-plugin-jsx-a11y` 6.10.2 (still the latest on 2026-11-10)
      declare `eslint` peers up to `^9`, so 10 only installs by overriding
      them. When all three accept 10, bump `eslint` + `eslint-config-next`
      and drop the `eslint` ignore in `.github/dependabot.yml`.
- [ ] **MAINT-74. Flaky: a phone dialog's comboboxes aren't there yet when `form-field-room` measures them** (low, S) `[!]` —
      `e2e/form-field-room.mobile.spec.ts:89` ("the shopping edit item dialog gives every combobox room on a phone") and `:98` ("the new recipe dialog gives the ingredient row room on a phone"), `mobile` project. Seen on release commit b13ba5e (2026-11-01). Line 89 failed in the local `ci:local` gate with `dialog has at least one combobox` expected `> 0`, received `0` (`expectComboboxesHaveRoom`, line 30) and passed on a re-run; line 98 failed once in the GitHub e2e job and passed on its retry. The helper measures the comboboxes once, right after the dialog opens, so it can run before the dialog's fields have rendered. Wait for the fields (`expect(...).not.toHaveCount(0)` or the dialog's heading and a field) before measuring, and check the click on the row's ⋯ menu is hydrated first (`expectHydrated`).
      The fix is in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Further sighting (2026-11-14, UX-191 builder run on 47d2ee9, PR #1429): line 89 failed once in the full locked `ci:local` run with the same `dialog has at least one combobox` error. It passed `--repeat-each=10` (52 passed) on clean `next` d52d120 and in the next full gate on the same commit.
      Further sighting (2026-11-15, release PR #1449 on 57e93f4, carrying #1446 and #1447, neither of which touches the shopping list or this spec): line 89 failed once in the reviewer's locked `ci:local` run with the same `dialog has at least one combobox` expected `> 0`, received `0` (`expectComboboxesHaveRoom`, line 30). It passed in a re-run of the spec on the same commit (`npx playwright test e2e/form-field-room.mobile.spec.ts --project=mobile`, 7 passed) and in the GitHub e2e job.
      Further sighting (2026-11-18, PR #1581 (UX-203) on 58d2867, which touches neither the shopping list nor this spec): line 89 failed once on `mobile` in the builder's locked `ci:local` (the shopping edit dialog had 0 comboboxes). It passed when re-run alone, and a second full `ci:local` on the same commit was clean.
      Further sighting (2026-11-24, PR #1727 (UX-210) on 5e8807d, which touches only the auth and first-run household forms, not the shopping list or this spec): line 89 failed once on `mobile` in the builder's locked `ci:local` with the same `dialog has at least one combobox` expected `> 0`, received `0`. It passed when re-run alone (`--repeat-each=3`, 17 passed), and a second full `ci:local` on the same commit was clean.
      Acceptance: `npx playwright test e2e/form-field-room.mobile.spec.ts --project=mobile --repeat-each=30` passes 30/30.
- [ ] **MAINT-77. Flaky: the chunk-retry tap doesn't open Add inventory item on desktop** (low, S) `[!]` —
      `e2e/inventory-lazy-dialogs.spec.ts:52` ("a failed chunk load › says so, and the next tap retries"), `desktop` project. In the GitHub e2e job on release commit b13ba5e (2026-11-01) it failed on both attempts (the retry limit, 7.7 s and 8.6 s) at line 95: `getByRole("dialog", { name: "Add inventory item" })` not visible within 5 s after the retry tap. It passed on a local re-run of the same commit. This is a new shape: MAINT-66 hardened this spec for `mobile` (merged in the same release as #968, which pre-fetches the chunks the abort refused), and MAINT-69 and MAINT-71 covered the history race and the route harness. Desktop still fails, so look at what differs there: chunks the retry needs that the abort never refused (so they are not warmed), or the dialog opening and being closed again by a history rewrite. Start from the failing run's trace.
      Seen again on release commit 2f0ac69 (2026-11-04): it failed once in the local `ci:local` gate on the `mobile` project (so mobile is not fully fixed either) and passed on a re-run of the same commit; the GitHub e2e job was green.
      It also failed once on the `mobile` project in the local `ci:local` run on d31e8ac (2026-11-01) and passed on re-run, so the fix covers both.
      Further sighting (2026-11-02, release PR #1061 on commit 059436759a9e): `mobile` project, line 95 again (`getByRole("dialog", { name: "Add inventory item" })` not visible within 5 s), in the local `ci:local` run only; it passed on a re-run of the same commit. It was also seen failing once in #1059's own `ci:local` run. Third mobile sighting after d31e8ac, so MAINT-66's hardening has not closed it.
      Further sighting (2026-11-03, GAP-69 builder run on b6238113): `mobile` project, failed once in the full local `ci:local` run and passed on the rerun and 32/32 with `--repeat-each=10`.
      Further sighting (2026-11-08, release PR #1222 on 25d14b4): `mobile` project, failed once in the full local `ci:local` run at line 95 (dialog not visible within 5 s) and passed on a re-run of the same commit; the GitHub e2e job was green.
      The fix is in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/inventory-lazy-dialogs.spec.ts --project=desktop --project=mobile --repeat-each=30` passes 30/30.
      Further sighting (2026-11-08, builder run): `mobile` project too. Failed once in a full `ci:local` on the GAP-79 head (7e3afdc) and once on the UX-178 head (9137847), each passing on the re-run; 32/32 and 38/38 in isolation.
      Further sighting (2026-11-11, release PR #1315 on 86ae1b0): `mobile` project, failed once in the full local `ci:local` run (dialog not visible within 5 s) and passed on a `--project=mobile` re-run of the same commit; the GitHub e2e job didn't run (docs-only release).
      Further sighting (2026-11-12, release PR #1352 on 1599687): `mobile` project, failed once in the full local `ci:local` run (`Add inventory item` dialog not visible within 5 s) and passed on a `--project=mobile` re-run of the same commit; the GitHub e2e job was green.
      Further sighting (2026-11-12, UX-184 builder run on d39f82f): `mobile` project, failed once in the full local `ci:local` run (`Add inventory item` dialog not visible in time) and passed on a focused re-run and on a second full run of the same commit.
      Further sighting (2026-11-13, release PR #1382 on 80cc114): `desktop` project again, in the GitHub e2e job (run 43409406202): the first attempt failed at line 95 (`Add inventory item` dialog not visible within 5 s) and passed on the retry in 3.7 s. The full local `ci:local` run of the same commit was green.
      Further sighting (2026-11-13, release PR #1392 on 3fd5a0e, GitHub run 43461814529, job 132010436927): `desktop` project again, in the GitHub e2e job: the first attempt failed at line 95 (`Add inventory item` dialog not visible within 5 s) and passed on its retry, so the job was green. That is two release runs in a row on 2026-11-13 where `desktop` failed its first attempt, so desktop is not fixed.
      Further sighting (2026-11-13, MAINT-92 builder run on 3b2fb5b, PR #1390): `mobile` project, failed once in the full local `ci:local` run (`Add inventory item` dialog not visible within 5 s) and passed on a second full run of the same commit.
      Further sighting (2026-11-13, release PR #1399 on ccaa00e): `mobile` project, failed once in the reviewer's full local `ci:local` run at line 95 (`Add inventory item` dialog not visible within 5 s) and passed on a focused re-run of the spec on the same commit; the GitHub e2e job was green.
      Further sighting (2026-11-14, MAINT-97 builder run on a5fc3e8, PR #1418): `mobile` project, failed once in the second full local `ci:local` run (`Add inventory item` dialog not visible within 5 s) and passed on a locked `--project=mobile --repeat-each=10` rerun of the spec on the same commit (32 passed).
- [ ] **MAINT-112. Flaky: the page is still on Tasks 5 s after a scripted push to Profile on iphone** (low, S) —
      `e2e/flows.spec.ts:57` ("an edit still shows after navigating away and back"), `iphone` project (WebKit), GitHub `End-to-end (Playwright)` job only. Third sighting, the first since #1487 added the `waitForDialogHistory(page)` wait before the push: release PR #1506 on b66e4ce, 2026-11-16, job 133437206856, failed its first attempt and passed on retry #1. Fourth sighting: release PR #1518 on fa83d4c, 2026-11-16, job 133656933989, same step and same URL, passed on retry #1 (local `ci:local` has no `iphone` project and was clean). Failing step: `:81`, `expect(page).toHaveURL(/\/dashboard\/profile/)` after `window.next.router.push("/dashboard/profile")`; the page was still on `http://localhost:3000/dashboard/tasks` after the 5000 ms timeout. Desktop and mobile passed first time, locally and on GitHub. The first two sightings: release PR #1425 on 138ae29, 2026-11-14, job 132417142477, and release PR #1484 on f77b161, 2026-11-16, job 133033346476 (already with the MAINT-103 repair). With the dialog's history settled before the push, the pending `history.back()` is ruled out as the cause; the remaining candidate is a slow first client navigation to `/dashboard/profile` in a cold WebKit (the route's RSC payload not prefetched yet). Start from a trace of an `iphone` run (keep one with `--trace on` in the GitHub job, or wherever WebKit installs), and check whether the push is issued but the navigation is slow (then wait on the navigation, e.g. on Profile's heading, with a timeout that fits a cold compile, rather than the URL's default 5 s) or never issued at all (an app bug in the router hand-off, fix in the app).
      Fix merged (#1573, built without WebKit; the GitHub job kept no trace, since it uploads the report only when the job fails and these runs passed on retry): it waits for the push's RSC request, then for Profile's heading with 20 s, before the URL check. Don't build it a second time. The item is done when the fallback acceptance below holds on a `master` that has it; if `[iphone] › e2e/flows.spec.ts:57` still fails there, and at the new request wait, the push never went out: look at the router hand-off in the app.
      The fix is in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `E2E_WEBKIT=1 npx playwright test e2e/flows.spec.ts --project=iphone --repeat-each=30` passes 30/30 (where WebKit can't be installed, the next two **Nightly e2e** runs (`e2e-nightly.yml`, which since #1579 is the only GitHub run of the `iphone` project) list `[iphone] › e2e/flows.spec.ts:57` passed on the first attempt, not `flaky`).
- [ ] **MAINT-124. Flaky: the URL still has `?add=1` 5 s after the palette's "Add to shopping list" on iphone** (low, S) —
      `e2e/command-palette.spec.ts:288` ("Add to shopping list focuses the add box of the list in use"), `iphone` project (WebKit). First sighting: **Nightly e2e** run 44715652293 (job 136218234858) on `next` at 08ea77d, 2026-11-20: failed its first attempt and passed on retry #1. Desktop and mobile passed first time there, in the release PR #1642 shards on d6e6db7 and in a local `ci:local` on the same commit. Failing step: `:295`, `expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/?]+$/)` received `…/dashboard/shopping-list/<id>?add=1` after the 5000 ms timeout, so on WebKit the page reached the list but the `?add=1` hand-off query wasn't stripped (yet). Start by checking how the shopping-list page consumes `add=1` (focus, then `router.replace` without the query): whether WebKit's replace is slow on a cold route or the strip never runs when the box is focused before hydration. If the strip can legitimately land late, wait on the add box being focused first and then on the URL with a timeout that fits; if it never runs, fix it in the app.
      Fix merged (#1645, built without WebKit: the proxy blocks Playwright's WebKit download): it waits for the add box's focus, then for the `router.replace()` strip's own RSC request, then for the stripped URL with 20 s. The strip is in the same effect as the focus and the router writes the URL only once the list's server render arrives, so a cold WebKit can legitimately take over 5 s. Don't build this a second time. The item is done when the fallback acceptance below holds on a `master` that has it; if `[iphone] › e2e/command-palette.spec.ts:288` still fails there at the new request wait, the strip never went out: look at SmartAddBar's effect and the palette dialog's history hand-off in the app.
      The fix is in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `E2E_WEBKIT=1 npx playwright test e2e/command-palette.spec.ts --project=iphone --repeat-each=30` passes 30/30 (where WebKit can't be installed, the next two **Nightly e2e** runs list `[iphone] › e2e/command-palette.spec.ts:288` passed on the first attempt, not `flaky`).

---

## Phase 2 — schema changes, one at a time

Each item adds a migration (`npx prisma migrate dev --name <name>`, local
only — production only ever runs `migrate deploy`), so land them one at a
time. None open.

## Phase 3 — larger items, own PR each

### State-of-the-art UI (2026-10-04 design audit)

The owner wants the UI itself to be what sets Squirrel apart (benchmarks:
Bring!, AnyList, Todoist, Things, Copilot Money). Motion, swipe actions,
drag-to-dismiss sheets and offline ticks and adds have shipped.

- [ ] **UX-43. Visual regression screenshots in CI** (M) `[!]` needs a decision on
      how baselines are made — Keep the polish
      from rotting. Add Playwright `toHaveScreenshot` baselines for the ten
      most-used screens:
      - dashboard, inventory, shopping list and detail, meal planner,
        tasks, budget overview, and the add-item, add-transaction and
        recipe sheets;
      - in light and dark, en and sv, on mobile and desktop;
      - with masked timestamps and a tolerance threshold.

      A diff fails the PR until a human approves the new baseline.

      **Blocked (autopilot-build, 2026-10-28): baselines can't be made
      deterministic from an agent session.** `toHaveScreenshot` compares
      pixels, so the PNGs must come from the same Chromium build and font
      set as the GitHub `ubuntu-latest` runner. The agent sandbox has a
      different prebuilt Chromium (`/opt/pw-browsers`, `playwright.config.ts`
      falls back to it) and a different font set, and `playwright install`
      isn't allowed there, so baselines committed from it would fail on
      the first CI run (or force a loose tolerance that hides real
      regressions). Also open: seeded data is date-relative (greetings,
      weekday headers, due dates), so more than timestamps need masking
      or a frozen clock.
      **Question for the owner:** OK to generate baselines on the runner
      itself? Proposed: a `workflow_dispatch` "Update screenshots"
      workflow (a human-only edit to `.github/workflows/`) that runs
      `playwright test --update-snapshots` on the e2e job's image and
      commits the PNGs to the PR branch; a normal e2e run then compares,
      only on PRs into `master`, in a separate `visual` project with
      `maxDiffPixelRatio` ~0.01, `page.clock` frozen, `animations:
      "disabled"` and masks. Keeping the set small (10 screens x
      light/dark x en/sv x mobile/desktop is 80 PNGs; suggest desktop+mobile
      en light plus sv/dark on mobile only, about 30) keeps runtime and
      repo size reasonable. Once decided, this is a buildable M.
      Recommendation (2026-11-23): yes to the runner-made baselines and the
      ~30-screen set; the owner adds the `workflow_dispatch` workflow
      (`.github/workflows/` is human-only). See #1703.

---

### Server caching (2026-10-22 review)

Today nothing is cached across requests: every dashboard page renders
fresh per request, `React.cache()` only dedupes within one request, and
the 31 action files invalidate with `revalidatePath` (46 calls for
`"/dashboard"` alone), which mostly just clears the browser's router cache.

**PERF-22 spike findings (2026-11-03, Next 16.4.3).** The spike ran on a
throwaway branch and merged nothing. The follow-ups below are the work it
leaves.

- **Turning `cacheComponents: true` on fails the whole build, in two
  layers.** First, five route handlers export
  `dynamic = "force-dynamic"`, which Next rejects outright under the flag
  ("not compatible with `nextConfig.cacheComponents`"):
  `api/health`, `api/calendar/[token]`, `api/digest/unsubscribe/[token]`,
  `api/cron/sync-notifications` and `api/cron/weekly-digest`. Second, with
  those removed, every page fails prerender: all 27 `page.tsx` routes plus
  `/_not-found`, with "uncached or runtime data outside `<Suspense>`". One
  cause covers them all: `src/app/layout.tsx` reads `cookies()` (locale,
  theme) and runs Prisma through `getLocale()`/`getUserPrefs`, above any
  Suspense boundary. `src/app/dashboard/layout.tsx` adds `requireHousehold()`
  and the cookie reads. Nothing below the root layout can be judged until
  that is fixed, so this spike can't say how many routes fail for their own
  queries on top. The build also warns that `partialPrefetching` must be set.
- **The Home pilot works, with one constraint.** The page's parallel batch
  (`dashboard/page.tsx:67-142`, household queries plus
  `loadHouseholdSafeToSpend`) went behind `"use cache"` with
  `cacheTag("household:<id>:home")`, taking `householdId`, `userId` and a
  day key as arguments. It needed `experimental.useCache` rather than the
  app-wide flag, so it could be built and served. The page also reads three
  cookie-backed helpers (`dashboard/page.tsx:182-184`, outside that batch):
  `isHouseholdStepSkipped`, `isGettingStartedDismissed` and
  `isGettingStartedCelebrated` (per-device cookies). `cookies()` throws inside
  a cached function, so they must stay outside the cache, read by the page
  and passed in where the cached part needs them. The rest (tasks, inventory,
  lists, budget, planner, batches, incoming stock) cached cleanly.
- **Pilot timings.** Production build, `next start`, local Postgres with one
  household of 400 inventory items, 60 tasks, 40 list rows and 310
  transactions, driven by a throwaway route calling the same batch with and
  without the directive (3 rounds of 40-60 requests after warm-up). Server
  time for the batch: uncached median 26-34 ms, p90 56-94 ms, min 15-20 ms;
  cached (hit) median about 2 ms, p90 2-3 ms. Treat these as indicative only:
  the machine was shared with other builds (hence the wide uncached spread),
  Postgres was on localhost with ~0 ms round trip, and the data is small.
  Production pays a network round trip per query (roughly 15 queries, some
  sequential inside safe-to-spend), so the uncached figure there will be
  higher and the cached one the same. No production timing was taken.
- **Does Vercel need `"use cache: remote"`? Yes, for hits to be reliable.**
  Per the Next 16 docs (`use-cache.md` "Runtime caching considerations",
  `use-cache-remote.md`, `self-hosting.md`), plain `"use cache"` stores in
  per-instance memory, and on serverless "cache entries typically don't
  persist across requests (each request can be a different instance)".
  `"use cache: remote"` stores via a configured `cacheHandlers` backend shared
  by all instances, at the cost of a handler lookup per hit and the storage.
  Entries never survive a deploy (the key includes the build or deployment
  id). Multi-instance tag invalidation also needs the handler's
  `refreshTags()`. The repo already has Upstash Redis, so a Redis-backed
  handler is the natural fit, but a Redis REST round trip is itself a few
  milliseconds to tens of milliseconds, which eats into the gain for a
  15-query batch only when the DB is close.
- **Go/no-go: conditional go, staged.** Not worth it as a bulk migration.
  Worth doing as PERF-31 first (it is the gate and also unlocks static
  shells), then PERF-32 (helper, remote handler, Home) with a production
  measurement before any more areas. Stop after PERF-32 if the Home batch's
  production saving behind the remote handler is under ~50 ms. The risk is
  correctness rather than speed: a missed `updateTag` shows a stale page to
  the household, which is why PERF-36 adds a guard.

Rules every follow-up keeps (from the original item):

- Cached functions take `householdId` (or `userId` for the personal budget)
  as an argument so it's in the cache key, and are only called after
  `requireHousehold()`. One helper builds every tag
  (`householdTag(id, "inventory")`), so no tag is ever unscoped.
- Every write clears the tags it touches: `updateTag` in Server Actions,
  `revalidateTag` in the cron routes and the share-link actions, which write
  outside a session.
- Never cache `requireHousehold()` / `requireUserId()`: their DB read is the
  SCALE-H revocation check. Keep the open shopping list uncached too (other
  members tick it live). Anything reading `cookies()` stays outside a cached
  function.

- [ ] **PERF-32b. Measure the Home cache in production** (S, owner) —
      PERF-32a shipped the tag helper, the Redis handler and Home's batch
      behind `HOME_CACHE`, off by default (REQUIREMENTS.md, "Home's
      household data can be cached"). The owner sets `HOME_CACHE=1` in
      Vercel (Upstash is already configured for the rate limiter),
      redeploys, and compares the Home batch's server time before and
      after, as DEPLOYMENT.md "Home cache (PERF-32)" describes. Stop if the
      saving is under ~50 ms: unset the flag and close PERF-33 to PERF-36.
      Otherwise keep it on and proceed to PERF-33..36. Owner-only: a build
      session has no production access or Upstash credentials (#1704).
- [ ] **PERF-33. Cache inventory and closed shopping lists** (M) — cached
      reads for the inventory list and item pages (tags
      `householdTag(id, "inventory")`) and for completed shopping lists. The
      open list stays uncached. Every inventory, stock and list write in
      `inventory/actions.ts` and `shopping-list/actions.ts` calls `updateTag`.
      Depends on PERF-32b.
- [ ] **PERF-34. Cache tasks and meal planning** (M) — the same for
      `dashboard/tasks` and `dashboard/meal-planning` (recipes, planner,
      prepared batches), with day-keyed arguments so "today" never goes
      stale across midnight. Depends on PERF-32b.
- [ ] **PERF-35. Cache the household and personal budgets** (M) — budget
      pages and `loadHouseholdSafeToSpend`/`loadPersonalBudgetPosition`,
      tagged by household and (personal) by `userId`, invalidated by every
      transaction, template, planned-expense and split write, including the
      recurring-template acks. Depends on PERF-32b.
- [ ] **PERF-36. Invalidate from the writers outside a session, and guard it**
      (M) — `revalidateTag` in `api/cron/sync-notifications` and
      `api/cron/weekly-digest` (no `updateTag` there: it is Server Actions
      only; the share-link tick is a Server Action and already clears Home,
      PERF-32a), plus a unit test that
      fails when a Server Action calls a Prisma write on a cached model
      without a matching tag call. Ship together with the first area that
      lands after PERF-32b.

## Competitive gap scan

A running log, appended to at most once a day, of feature gaps found by
comparing Squirrel against competing single-purpose apps (AnyList, Bring!,
Listonic, Out of Milk for shopping lists; Grocy for pantry/inventory;
Mealime/Plan to Eat for meal planning; Splitwise for expense splitting;
Cozi for family-organizer/calendar features). Each dated entry is capped at
10 items and only adds items not already covered elsewhere in this file.
Treat these the same as any other backlog item once picked up: move it into
the right phase section above (or straight into a PR) rather than leaving
it here, and delete it from this section when it ships. An entry that turns
out to be a product-scope question rather than a scoped task should move to
"Needs a decision" instead, `[!]`-tagged, the same as any other item.

### 2026-09-23 scan

- [ ] **GAP-10. Voice-assistant shopping list integration (Alexa/Google Assistant)** `[!]` —
      needs a product decision, not just an estimate. AnyList and Bring!
      both support hands-free "add milk to my shopping list" via Alexa/Google
      Assistant skills — materially different from the in-app Web
      Speech API mic button, since it requires building and maintaining a
      third-party voice-platform skill/action, account-linking OAuth, and
      ongoing certification with Amazon/Google. Belongs alongside the
      `INFRA-` items as something clearly valuable but gated on
      infrastructure/credentials only the product owner can provision, not
      on engineering effort alone.

### 2026-09-24 scan

- [ ] **GAP-19. Geofenced "you're near the store" reminder** `[!]` — needs
      a product decision before scoping. Bring! prompts a push notification
      when it detects you're near a saved store, using the phone's
      background location. This app has zero geolocation code today and the
      always-on household list (AUTO-8, shipped — see REQUIREMENTS.md) already covers
      most of the same need without asking for a location permission at
      all. Real background geofencing on iOS Safari PWAs is unreliable
      without a native wrapper (`INFRA-3`), and even a foreground-only
      version (checking location when the app is opened, prompting "add
      items to this trip?") is a privacy-sensitive feature this app hasn't
      needed to reason about before — worth deciding whether it's in scope
      at all before estimating it.

- [ ] **GAP-20. A "we're away" pause on automation** `[!]` — needs a
      product decision. Several of this app's automations assume normal
      household rhythm — expiring-soon alerts, meal-not-logged nudges, and
      AUTO-8's auto-add-to-list and AUTO-10's repurchase suggestions
      all fire on a schedule that doesn't know the household is
      on vacation. Cozi-style family organizers don't solve this either, so
      there's no single pattern to copy. Options range from a single
      `Household.pausedUntil` date that every sync function
      (`getActiveNotifications`, the low-stock crossing helpers) checks and
      no-ops against, to doing nothing until AUTO-8/AUTO-10 have seen real use
      and it's clear which automations are annoying enough while away to be
      worth the added state. Recommend deferring the decision until at
      least one of those Phase 2 items has real usage.

---

### 2026-09-25 scan

- [ ] **GAP-26. "Someone's shopping now" presence on a shared list** `[!]` —
      needs an infrastructure decision before scoping. Bring! and AnyList
      show a live indicator when another household member has the same list
      open, which matters for exactly the moment this app doesn't yet handle
      well: two people at the same store both working off
      `ShoppingListShareLink`/the household's own list. Today updates only
      reach other viewers via `revalidatePath` on the next Server Action
      (`src/app/share/shopping-list/actions.ts`) — there's no polling or
      push between household members' own open tabs, so a stale list is
      silently possible for as long as nobody taps anything. A real presence
      indicator needs either short-interval polling (cheap, but a genuine
      new request pattern for a page that's otherwise fully
      Server-Action-driven) or a push channel (WebSocket/SSE — no such
      infrastructure exists in this app today, `web-push` only sends
      one-shot OS notifications). Worth deciding the mechanism before
      committing, rather than treating it as a routine feature slice.

### 2026-09-26 scan

- [ ] **GAP-36. "Give every dollar a job" zero-based budgeting** `[!]` —
      needs a product decision. YNAB's defining feature is requiring the
      month's income to be fully assigned across categories (a
      "To be budgeted" figure that must reach zero), a materially
      different philosophy from the envelope-style `monthlyLimit`/
      `rolloverEnabled` system already built (GAP-12/GAP-21,
      `BudgetCategory`/`PersonalBudgetCategory`) — that system caps
      category spending, but nothing requires or tracks whether *all*
      income has a category. Adopting it would mean reconciling a new
      "unassigned" figure against `computeSafeToSpend`
      (`src/lib/safe-to-spend-calc.ts`), which already answers a similar
      but distinct question ("what's left to spend"); worth deciding
      whether the app wants two budgeting philosophies side by side
      before scoping either the schema or the math.

- [ ] **GAP-37. Splitting an expense with someone outside the household** `[!]` —
      needs a product decision. Splitwise's core model is splitting a bill
      with any "friend," not just people who share your account.
      `TransactionSplit` (`prisma/schema.prisma`) is keyed to
      `HouseholdMember`, so every split participant must already be a full
      household member — there's no way to record "the trip to Ikea, split
      three ways with a friend who isn't on Squirrel." Supporting it breaks
      the tenancy assumption every domain row here relies on (a split
      party scoped by `householdId` via its member), and would need a real
      design for a non-member participant's identity (a name-only row with
      no login, most likely) before it's a scoped task rather than an
      open-ended one.

### 2026-09-27 scan

- [ ] **GAP-38. Per-transaction currency for expenses paid in a different currency** `[!]` —
      needs a product decision. Splitwise records each expense in whatever
      currency it was actually paid in and offers currency conversion on
      top; Squirrel's whole money model is one `Household.currencyCode`
      (GAP-13, `src/lib/currency.ts`) that every `Transaction` and
      `TransactionSplit` is assumed to be denominated in — there's no
      per-transaction currency field or exchange rate anywhere in
      `prisma/schema.prisma`. This bites hardest exactly where household
      expense splitting is most useful (`TransactionSplit`/
      `MemberSettlement`, `src/lib/settle-up-calc.ts`): a shared trip
      abroad, where the bill was paid in a currency the household doesn't
      use day to day, today has no honest way to be logged. Supporting it
      means deciding whether to store a frozen FX rate at entry time or
      convert live, and whether `computeBillPositions`/the settle-up
      balances stay single-currency internally with only the display layer
      converting — a currency-model change, not a UI tweak.

### 2026-09-28 scan

- [ ] **GAP-41. Itemized expense splitting (assign receipt lines, not just the total)** `[!]` —
      needs a product decision. Splitwise's itemization lets a group split
      a bill by who actually had which line item, not just an even or
      fixed-share split of the total. `TransactionSplit`
      (`prisma/schema.prisma`) only ever divides one flat
      `Transaction.amount` per member (`amountOwed`/`amountPaid`) — there's
      no link from a split row to the individual `PriceHistory` rows or
      shopping-list items a receipt produced, so `SplitEditor`
      (`src/components/budget/split-editor.tsx`) can't offer "Alex had the
      wine, Sam had the snacks" today. This touches the money-computing
      surface AUTOPILOT.md flags as human-only (`*split*`, `*transaction*`),
      and needs decisions the flat-split feature didn't: whether
      itemization only makes sense off the receipt-scan flow
      (`applyReceiptScanAction`) where line items already exist, how it
      reconciles with tax/fees that aren't tied to one item, and whether
      per-item assignment replaces or layers on top of the existing
      share/paid model — a schema and UX design question, not a routine
      slice.

### 2026-10-31 scan

- [ ] **GAP-68. Store loyalty-card numbers on a shopping store** `[!]` —
      Bring! lets members save loyalty cards in the app and show the
      barcode at the till, one of its most-used extras, and Squirrel
      already knows each household's stores (price history, trip
      receipts). A card number is new personal data stored per member
      (and a barcode render), so it needs the owner's call on whether
      it is in scope, who can see a card (own only vs household), and
      the privacy page wording. Recommended: keep not doing it; a
      wallet app does this better and the data is sensitive.
      Acceptance (if approved): a per-user card on a store, shown as a
      Code 128/EAN barcode at full brightness on `mobile`, never
      visible to other members and never in logs.

### 2026-11-25 scan

Checked Bring!, Listonic and OurHome, plus Copilot Money and Monarch for
budgets. Most of what they ship is already here or already turned down:
who added an item (GAP-65), urgent items (GAP-86), aisle order, smart
suggestions, task rotation, loyalty cards (GAP-68), and chore points
(REQUIREMENTS.md "Household tasks" rules them out). Two gaps were left:
GAP-89 (tell the household you're going shopping), since built (see
REQUIREMENTS.md, "Tell the household you're going shopping"), and one
money question filed under "Needs a decision before building":

- GAP-90 (refunds against an expense category) needs a product call, so
  it is under "Needs a decision before building".

### 2026-11-27 scan

Checked Grocy, Paprika, Plan to Eat, AnyList's 2026 meal-plan release,
Tody and Cozi. Nearly all of it is already here: freezing and opened
dates (GAP-44), use-it-up recipes, recipe scaling (GAP-11), saved menus
(GAP-52), substitution hints (GAP-25), the Cook soon queue (GAP-51),
sort by times cooked (GAP-80), meal notes (GAP-81), chores due relative
to when they were last done, and birthdays as yearly events (GAP-35).
The two gaps left are in the household calendar, which is newer than the
rest. Cozi charges for exactly these (Cozi Gold: events past 30 days,
month view; calendar import on every tier):

- [ ] **GAP-91. See calendar events past the 60-day agenda** (impact: med,
      effort: S) — `/dashboard/calendar` only ever loads
      `AGENDA_DAYS = 60` (`src/lib/household-events.ts:27`,
      `src/app/dashboard/calendar/page.tsx:24`) and has no way to look
      further. A one-off event saved for a date three months out (a
      wedding, a passport renewal, next summer's trip) disappears from
      the page as soon as the sheet closes, so the save looks like it
      failed (DESIGN.md: every action shows its result), and the only
      way to check it or edit it is the calendar feed. Add a
      "Show later" / "Visa senare" button under the agenda that loads
      the next 60 days (a `?until=` search param read by `page.tsx`,
      capped at a year or two, passed to the existing
      `loadUpcomingEvents(householdId, today, days)`), and make the
      "Nothing in the next 60 days" line offer the same button when
      later events exist. After saving an event past the loaded window,
      the toast says which day it was saved for and offers "Show"
      (opening the agenda far enough to include it). No schema change.
      Acceptance: `e2e/calendar.spec.ts` (`mobile` and `desktop`) adds
      a one-off event 90 days ahead, sees the toast with its date, taps
      Show later and sees the row under its day heading; after a reload
      of the extended URL it is still there.

- [ ] **GAP-92. Import events from a calendar file (.ics)** (impact: med,
      effort: M) — households already have the school term, the sports
      club's fixtures or a family member's shifts as an `.ics` file or
      export, and today each event has to be typed into
      `EventFormDialog` one at a time. Cozi, Google and Apple Calendar
      all import a file. Add "Import from file" beside Add event (in a
      ⋯ menu; the page has none yet): pick an `.ics` file
      (`accept=".ics,text/calendar"`, a size
      cap such as 256 KB), see a review list ("12 events, 3 already in
      the calendar") with a checkbox per event, then import. That's two
      actions in `src/app/dashboard/calendar/actions.ts`: a preview
      action that parses the file and returns the rows with their
      duplicate flags, and an import action that gets the file again
      with the ticked rows' indexes and parses it again on the server,
      so the client's copy of the rows is never trusted. Both parse with
      a small, unit-tested parser (VEVENT `SUMMARY`, `DTSTART`/`DTEND` as
      a date or a local time, `DESCRIPTION` into notes cut at 500).
      `RRULE` becomes a Squirrel repeat only where it lands on exactly
      the same days as `expandEventOccurrences`
      (`src/lib/household-events.ts`), which clamps a day the month
      lacks to the month's last day where RFC 5545 skips that month: so
      `FREQ=WEEKLY` with no `BYDAY` or a single `BYDAY` equal to
      DTSTART's weekday (how Google and Apple write a weekly event);
      `FREQ=MONTHLY` on day 1–28; `FREQ=YEARLY` on any date but
      29 February; and the clamped forms Squirrel's own feed writes
      (`eventRrule`):
      `FREQ=MONTHLY;BYMONTHDAY=28,…,<DTSTART's day>;BYSETPOS=-1` and
      `FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1`. Anything else imports as a one-off on its DTSTART:
      a `COUNT` or `UNTIL`, an `INTERVAL` above 1, any other `BY…` part,
      a plain `FREQ=MONTHLY` starting on the 29th–31st, or a plain
      `FREQ=YEARLY` starting on 29 February. Every row goes through the
      same validation as `createEventAction`, an event whose title and
      date are already there is skipped, and the rows are written in one
      `createMany` scoped by `requireHousehold()`, with
      `createdByMemberId` set to the importing member as
      `createEventAction` does (from the session, never the form) and no
      "for" member. Times with a zone (`Z` or `TZID`) convert to the
      importer's time zone cookie, since `HouseholdEvent` times are
      floating. A one-time import only: subscribing to a URL that keeps
      syncing would need a fetch job and stored URLs, so it's a product
      call and not part of this item. Acceptance: parser tests cover
      each accepted RRULE above (weekly with and without a matching
      `BYDAY`, monthly on the 15th, both BYSETPOS forms, yearly) and each
      refused one importing as a one-off (`COUNT`, `UNTIL`, a `BYDAY`
      list or a weekday other than DTSTART's, plain monthly on the 31st,
      plain yearly on 29 February), all-day vs timed, and zoned times;
      the action tests cover tenancy, `createdByMemberId` from the
      session, the import re-parsing rather than trusting client rows,
      and the duplicate skip; a new `e2e/calendar-import.spec.ts`
      (`mobile` and `desktop`) uploads a fixture with three events (one
      weekly), unticks one, imports, and sees the other two in the
      agenda with the repeat badge on the weekly one, and a second
      import of the same file adds nothing.

## Needs a decision before building

- [ ] **AUTO-13. Receipts that arrive by themselves** `[!]` needs a product
      decision — ICA, Hemköp and Willys already deliver digital receipts
      (via Kivra), which would remove the photo step entirely. Options:
      - **Recommended first step:** a per-household inbound email address
        (e.g. via Resend inbound) that accepts a forwarded/auto-forwarded
        receipt email or PDF and drops it into the existing
        `RegisterReceiptDialog` review pipeline as a pending receipt.
        Needs a decision on inbound email infrastructure and on storing
        receipt content temporarily.
      - **Direct integration** with Kivra or a store's API — not
        researched; no known public API. Investigate before promising
        anything.
      Either way, the output lands in the same review → apply flow
      (with AUTO-11's auto-accepted matches), never applied unseen.
      Decided 2026-10-20 by owner: option 1 (inbound address, pending
      review only). See #399. Stays `[!]` until the owner enables Resend
      inbound and accepts temporary storage of receipt content; once they
      say that's done, it becomes a buildable Phase 3 item.

- [ ] **PRICE-1. Should manual purchase-checking ever collect a price?** `[!]`
      The cheap version has shipped (an honest empty-state hint in Cost
      analyzer), and **AUTO-4 covers most of the need without a new field**:
      prices prefill from `lastKnownPrice` and are tappable to correct. So
      decide this only after AUTO-4 ships and there's a sense of whether
      prefilled estimates plus receipt scanning populate enough cost data.
      The bigger option: an optional, low-friction price field in the
      everyday "check item off" interaction (not just receipt scan/barcode
      lookup) so Cost analyzer and the Groceries auto-expense work for
      households that shop the old-fashioned way. This is explicitly a
      flow-design trade-off — every additional field on the fastest, most
      repeated interaction in the app (checking off a shopping item) has a
      real friction cost — so it needs a product decision on whether
      "sometimes-populated cost data" is worth it, not just an engineering
      estimate.

- [ ] **BUDGET-6. Shared action-layer abstraction for both budgets?** `[!]`
      Whether to also unify `src/app/dashboard/budget/actions.ts` and
      `.../personal-budget/actions.ts` behind a thin repository-style
      abstraction (an injected `{ findCategory, createCategory,
      deleteCategory, ... }` object per scope). The archived spike argues
      against merging the underlying Prisma models, but left this smaller
      question open. BUDGET-2 → BUDGET-5 (the merged components) have
      shipped, so the real prop surface is now known.

- [ ] **GAP-88b. Hour-scale reminders for calendar events** `[!]` —
      the rest of GAP-88 (split 2026-11-25): "the dentist, an hour
      before". `/api/cron/sync-notifications` runs once a day (`0 6 * * *`
      in `vercel.json`), because Vercel Hobby caps Cron Jobs at once a
      day and fails the deployment on a tighter schedule (DEPLOYMENT.md,
      "Scheduled jobs"). A reminder an hour or two before a timed event
      can't arrive on time from a daily run, so this needs a scheduler
      that runs every 15 minutes or so. Options:
      - **Recommended:** a Vercel Pro plan (or Railway/Render's own
        cron), with the existing sync route on `*/15 * * * *`; GAP-88a's
        sender then only gains offsets of minutes and hours.
      - An outside pinger (a scheduled GitHub Actions workflow or a free
        cron service) calling the route with `CRON_SECRET`. Free, but
        GitHub's schedules run late under load and it puts the secret
        in another place.
      - Keep reminders day-scale only (GAP-88a) and don't build this.
      Hosting plan and secrets are the owner's call (AUTOPILOT.md,
      `never_decide`). GAP-88a has shipped (`src/lib/event-reminders.ts`).

- [ ] **GAP-90. Record a refund against an expense category** `[!]` —
      Found in the 2026-11-25 competitors scan.
      Copilot Money and Monarch both treat a return as negative spending
      in the original category: return a 400 kr jacket and Clothes goes
      down by 400. Squirrel has nowhere to put it.
      `transaction-actions.ts:22` (and the personal budget's
      `actions.ts`) require `amount > 0`, and an expense category only
      takes expenses. Logged as income, the refund inflates income and
      Safe to spend, and the category stays over its limit, so the
      budget lies after every return. This needs a call on the
      representation, because every sum touches it (category
      limits, rollover, Safe to spend, Insights, CSV export, splits and
      settle-up). Recommended: a "This is a refund" switch on Add/Edit
      expense that stores a negative `amount` on an `EXPENSE` row, so
      every existing sum nets it out without new filters. This is the
      same reason planned bills avoided a status column. Shares on a
      split refund are the original split negated, so settle-up
      reverses who owes what. No migration is needed. Money code is
      human-only (AUTOPILOT.md). Acceptance (if approved): unit tests
      show a refund lowers category spend, rollover and Safe to spend,
      and that a 50/50 split refund reduces the other member's debt by
      half. An e2e test on `mobile` adds a refund and sees the
      category's spent amount drop and the row shown as a refund (a "+"
      amount, labelled "Refund").

### Infrastructure (moved from REQUIREMENTS.md's "Deferred" list)

Each is clearly valuable but needs a paid third-party service, developer
credentials only the product owner can provision, or an architecture call.

- [ ] **INFRA-1. Item photos on inventory** `[!]` — needs a blob-storage
      decision (S3 / Vercel Blob / Cloudinary / …). The app deliberately
      has zero file-storage infrastructure today (see the Profile avatar
      section in REQUIREMENTS.md for why) and shouldn't gain one ad hoc
      inside an unrelated task.
- [ ] **INFRA-2. Bank/account sync** `[!]` — needs a provider account
      (Plaid, or an EU open-banking aggregator for Swedish banks).
- [ ] **INFRA-3. Native mobile app** `[!]` — needs app store enrollment.
      The PWA is installable and has push today.
- [ ] **INFRA-4. Social login (Google/Apple)** `[!]` — needs OAuth consent
      screens / developer credentials.
- [ ] **INFRA-6. Backfill tags and GitHub Releases for versions cut
      while CI was paused** `[!]` — Actions runs again (`ci_gate:
      github` since 2026-10-13, after the 2026-10-04 to 2026-10-12
      stretch), so this is unblocked
      but needs someone with push access to tags. `release.yml` tags `vX.Y.Z`
      and creates a GitHub Release. Versions cut in-PR under the
      `ci_gate: local` stopgap got neither, so they exist only in
      `package.json` and `releases.json`. For each one below, tag the
      squash-merge commit on `master` that carries it, then run
      `gh release create vX.Y.Z` with the note from `releases.json`.
      Versions cut in-PR under the `ci_gate: local` stopgap from
      2026-10-12 join this list too. Delete the item once all of them
      are tagged. v0.47.5, v0.47.7 and v0.48.3 are deliberately left
      out: those PRs were released again by the workflow (v0.47.6,
      v0.47.8, v0.48.4, already tagged), so tagging them would publish a
      second Release for the same PR.

      | Version | PR | Merged | Cut in |
      |---|---|---|---|
      | v0.39.9 | #81 fix: recipe import DNS rebinding (SEC-2) | 2026-09-26 | #93 (catch-up) |
      | v0.40.0 | #92 feat: ingredient match review (MATCH-1) | 2026-09-27 | #93 (catch-up) |
      | v0.41.0 | #91 feat: ingredient parsing (MATCH-4) | 2026-09-27 | #93 (catch-up) |
      | v0.42.0 | #94 feat: untracked ingredients and aliases (MATCH-2) | 2026-09-27 | #93 (catch-up) |
      | v0.42.1 | #93 fix: long dialogs scroll on iOS | 2026-09-27 | #93 |
      | v0.43.0 | #95 feat: per-item unit conversions (MATCH-3) | 2026-09-27 | #95 |
      | v0.44.0 | #96 feat: item page (MATCH-6) | 2026-09-27 | #96 |
      | v0.45.0 | #98 feat: find and merge duplicate pantry items (MATCH-7) | 2026-09-27 | #98 |
      | v0.45.1 | #101 fix: drop push subscriptions on logout/password change (SEC-5) | 2026-09-28 | #101 |
      | v0.45.2 | #102 fix: item page back arrow returns to where you came from | 2026-09-28 | #102 |
      | v0.46.0 | #103 feat: remembered item names also link shopping lists and receipts (MATCH-5) | 2026-09-28 | #103 |
      | v0.46.1 | #107 fix: meet WCAG contrast in both themes and colour outcome toasts | 2026-09-28 | #107 |
      | v0.46.3 | #110 fix: count recurring income not yet logged as expected income | 2026-09-28 | #110 |
      | v0.46.2 | #108 fix: keep hand-split shared bills on the personal budget in future months | 2026-09-28 | #108 |
      | v0.46.4 | #109 fix: cap the action inputs that had no upper bound (SEC-7) | 2026-09-28 | #109 |
      | v0.46.5 | #112 fix: log only an excerpt of unparseable AI scan replies (SEC-11) | 2026-09-28 | #112 |
      | v0.46.6 | #113 fix: rate-limit the shopping-list share-token endpoints (SEC-13) | 2026-09-28 | #113 |
      | v0.46.7 | #114 fix: include notes, tasks, splits and settings in "Export my data" (SEC-10) | 2026-09-28 | #114 |
      | v0.46.8 | #118 perf: keep zod out of the meal-planning client bundle (PERF-7) | 2026-09-29 | #118 |
      | v0.46.9 | #119 fix: tell a new household what produces a notification (UX-3) | 2026-09-29 | #119 |
      | v0.46.10 | #120 fix: show the whole unit in the empty inventory's quick-add row (UX-1) | 2026-09-29 | #120 |
      | v0.46.11 | #121 fix: ellipsize Select trigger labels instead of clipping mid-word (UX-2) | 2026-09-29 | #121 |
      | v0.46.12 | #122 perf: move pushes and price-spike checks into after() (PERF-9) | 2026-09-29 | #122 |
      | v0.46.13 | #124 perf: pass only the used dictionary slices to the dashboard shell (PERF-5) | 2026-09-29 | #124 |
| v0.46.14 | #125 perf: batch the take-stock quantity update into a fixed number of queries (PERF-15) | 2026-09-29 | #125 |
      | v0.47.0 | #129 feat: choose the budget category shopping trips log to | 2026-09-30 | #129 |
      | v0.47.1 | #130 fix: show push as off when the server dropped this browser's subscription (SEC-14) | 2026-09-30 | #130 |
      | v0.47.2 | #131 perf: load inventory once per receipt instead of per unmatched line (PERF-16) | 2026-09-30 | #131 |
      | v0.47.3 | #132 perf: bound the recurring-template duplicate-period check to the current period (PERF-17) | 2026-09-30 | #132 |
      | v0.47.4 | #133 fix: make invite, reset and verification tokens single-use and hashed (SEC-8) | 2026-09-30 | #133 |
      | v0.58.0 | #183 feat: inventory mobile — one clear action, calmer rows (UX-20) | 2026-10-12 | #183 |
      | v0.58.1 | #186 fix: budget tabs scroll, no disabled primary, printed chart values (UX-23) | 2026-10-12 | #186 |
      | v0.58.2 | #187 fix: screen-reader and small-screen semantics (UX-31) | 2026-10-12 | #187 |
      | v0.59.0 | #193 feat: copy a recipe as plain text (GAP-43) | 2026-10-12 | #193 |
      | v0.59.1 | #191 fix: show server-action errors and dialog labels in the user's language (UX-16) | 2026-10-13 | #191 |
      | v0.59.2 | #192 fix: survive 200% text size without sideways scroll (UX-9) | 2026-10-13 | #192 |
      | v0.59.3 | #196 fix: survive a dropped pooled DB connection on page render (BUG-1) | 2026-10-13 | #196 |
      | v0.59.4 | #198 fix: touch-target overlaps, gaps and a wider M3 guard (UX-19) | 2026-10-13 | #198 |
      | v0.60.0 | #200 feat: freeze an expiring inventory item to extend its date (GAP-44) | 2026-10-13 | #200 |
      | v0.61.0 | #201 feat: offer to plan leftovers onto the next free dinner day (GAP-39) | 2026-10-13 | #201 |
- [ ] **INFRA-5. True offline support** `[!]` — PWA installability and
      push are built, but `src/lib/service-worker.js` only handles
      `push`/`notificationclick`: no `fetch` handler, no Cache API, so a
      navigation or Server Action with no network just fails. Needs a
      decision on what's safe to serve stale (e.g. inventory counts, a
      shopping list in a store with bad signal — the strongest use case)
      vs. what must always be fresh (auth, money).

