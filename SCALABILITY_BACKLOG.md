# Scalability backlog — 2026-09-15 review

Source: an architecture/performance/security review (2026-09-15) focused on whether this
app holds up under many more users/households, covering the DB access layer, request-time
compute, auth/session model, and multi-tenant authorization. A dedicated audit of every
server action in `src/lib/actions/**` and `src/app/dashboard/**/actions.ts` found **no
authorization (IDOR) gaps** — every mutation is already correctly scoped by the caller's
household/user id. The items below are the concrete performance/scale/security findings
from that review, broken into tasks scoped the same way `PRODUCTION_READINESS.md` and
`MAINTENANCE_BACKLOG.md` were — each is self-contained enough to hand to an isolated
subagent in its own git worktree/branch with no other context from the review.

Status legend: `[ ]` not started · `[~]` in progress (agent dispatched) ·
`[x]` merged to master · `[!]` blocked / needs a human decision.

Explicitly out of scope for this backlog (already fully documented, just needs
credentials/config at deploy time, not a code change — see `DEPLOYMENT.md`):
turning on the existing Upstash Redis rate-limit backend, and putting a connection
pooler (PgBouncer / a managed provider's pooled endpoint) in front of Postgres. Both
are required before this app runs on more than one instance or serverless — see
`DEPLOYMENT.md` sections 3 and 6 for the exact steps. Neither needs a code change.

## Wave 1 — independent, parallel (disjoint files, no schema changes)

- [ ] **A. Batch the per-row inventory lookup in `addMissingIngredientsToShoppingListAction`**
      — `src/app/dashboard/meal-planning/cooking-actions.ts:213-228`. The `for (const row of
      rows)` loop calls `findOrCreateInventoryItem(household.id, row.name)` (a query, and
      sometimes a create) followed by a separate `shoppingListItem.create`, once per row —
      2 round trips per ingredient instead of a single batched pass. Change it to: one
      `findOrCreateInventoryItem`-equivalent batch lookup (`prisma.inventoryItem.findMany({
      where: { householdId, name: { in: rows.map(r => r.name) } } })` to find existing
      matches in one query, then a single `createMany` for the names that don't already
      exist), followed by a single `shoppingListItem.createMany` for every row not already
      on the list (the existing `alreadyOnListIds` dedupe logic must still apply). Preserve
      current behavior exactly (same dedupe against `alreadyOnListIds`, same
      `addedAutomatically: true` flag). Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`.

- [ ] **B. Batch ingredient/component resolution in recipe save** —
      `src/app/dashboard/meal-planning/recipe-actions.ts`. Two separate N+1 patterns in the
      same file: `parseIngredientRows` (~line 73) runs `Promise.all(rows.map(...
      findOrCreateInventoryItem...))` — N parallel query pairs for N ingredients — and
      `parseComponentRows` (~line 121-150) runs a sequential `for` loop doing
      `prisma.recipe.findFirst` + `wouldCreateCycle` per component row — N sequential round
      trips for N components. Batch `parseIngredientRows` the same way as item A (one
      `findMany` + one `createMany` instead of N lookup/create pairs, preserving
      insertion order for the returned `data` array). For `parseComponentRows`, replace the
      per-row `prisma.recipe.findFirst` with a single `prisma.recipe.findMany({ where: { id:
      { in: ids }, householdId } })` up front, then look up each id from an in-memory Map
      inside the loop — but leave `wouldCreateCycle`'s per-row call as-is (it's a graph
      check, not a flat lookup; don't attempt to batch it in this task). Verify with
      `npm run lint`, `npx tsc --noEmit`, `npm run test`.

- [ ] **C. Batch shopping-list mapping resolution and receipt-scan apply** —
      `src/app/dashboard/shopping-list/actions.ts`. Two separate loops issue 2-3 DB writes
      per item inside a `$transaction`: `resolveShoppingListMappingsAction` (~line 500-542)
      loops over `resolutions` doing a conditional `inventoryItem.findFirst`/`create` plus a
      `shoppingListItem.update` per item, and `applyReceiptScanAction` (~line 669-690) loops
      over `validMatches` doing a `shoppingListItem.update` plus a conditional
      `inventoryItem.update` and `priceHistory.create` per match. In both cases the target
      rows already exist in the `items`/`itemsById` map fetched before the transaction — the
      writes are what's per-row, not the reads, and each row's write data differs, so this
      can't collapse into a single `updateMany`. Instead, parallelize the per-row writes
      inside each transaction with `Promise.all` (Prisma's interactive `$transaction`
      callback supports concurrent queries on the same `tx` client) instead of sequential
      `await`s in a `for` loop, cutting wall-clock transaction hold time roughly in half to a
      third depending on the row. Do not change the actual data written or the dedupe/
      validation logic — this is purely reducing sequential round trips within the existing
      transaction. Verify with `npm run lint`, `npx tsc --noEmit`, `npm run test`.

- [ ] **D. Batch the recipe-graph fetch in `expandRecipeIngredients`** —
      `src/app/dashboard/meal-planning/recipe-expansion.ts:35-75`. This recursively calls
      `prisma.recipe.findUnique` once per recipe node (including once per sub-recipe
      component), so a meal plan with N entries each pulling in sub-recipes issues roughly
      N×(1+number of components) queries. Since a household's total recipe count is small
      and bounded, change this to fetch the household's entire recipe graph once per call
      into this module (all recipes + their `ingredients`/`components` for the household,
      via `prisma.recipe.findMany({ where: { householdId }, include: { ingredients: {
      include: { inventoryItem: true } }, components: { select: { componentRecipeId: true,
      quantity: true } } } })`) into an in-memory `Map<recipeId, Recipe>`, then have the
      existing recursive expansion walk that in-memory map instead of hitting Prisma per
      node. This needs `householdId` threaded into `expandRecipeIngredients` (it isn't a
      parameter today — check every call site, both in `cooking-actions.ts`'s preview
      actions) since the map must be scoped per-household. Keep the existing
      `MAX_COMPONENT_DEPTH`/`ancestry` cycle-guard logic unchanged — this is purely about
      where the data comes from, not the recursion/cycle logic. Verify with `npm run lint`,
      `npx tsc --noEmit`, `npm run test`.

- [ ] **E. Rate-limit `sendInviteEmailAction`** —
      `src/lib/actions/household.ts:74-95`. This lets any authenticated household member
      trigger an outbound email to an arbitrary address with no throttle — a cost/abuse
      vector (spamming arbitrary inboxes via this app's sending domain) once there are many
      real accounts. Mirror the existing pattern in the same file
      (`JOIN_SIGNUP_RATE_LIMIT`/`JOIN_SIGNUP_RATE_LIMIT_WINDOW_MS` at line 157-158, and the
      `checkRateLimit` call at line 185): add a rate limit keyed on the *sender*
      (`invite-email:${household.userId}` — use whatever identifier `requireHousehold()`
      returns for the acting user) of something like 10 invite emails per hour, returning
      `{ error: "Too many invite emails sent. Please wait a while and try again." }` when
      exceeded. Add a test in this file's existing test suite covering both the
      under-limit and over-limit cases (see `src/lib/actions/household.test.ts`'s existing
      style). Verify with `npm run lint`, `npx tsc --noEmit`, `npm run test`.

- [ ] **F. Bound the budget transactions query to a period instead of fetching all-time** —
      `src/app/dashboard/budget/page.tsx:58-62`. `prisma.transaction.findMany({ where: {
      householdId: household.id }, ... })` fetches every transaction the household has ever
      logged, unbounded — this grows every month a household keeps using the app,
      independent of total user count, and will eventually slow down every load of this
      page. Default the query to the current calendar month (mirror the precedent already
      set by `src/app/dashboard/budget/export/route.ts`, which scopes its CSV export to the
      current calendar month) and add a way to navigate to a different month (prev/next
      month controls, or a month picker — check whether `budget/page.tsx` already has any
      period-related UI state before designing new UI from scratch). Check whether any
      other logic on this page (summary totals, safe-to-spend calc, recurring-template
      status) depends on seeing *all* transactions rather than just the selected month's —
      if so, either give that logic its own narrower query or flag it back rather than
      silently changing its behavior. This one has a product-facing UI surface, not just a
      backend change — if the exact navigation UX is ambiguous, make a reasonable call and
      flag it rather than guessing indefinitely. Add English + Swedish copy for any new UI
      text (`src/lib/i18n/dictionaries/en.ts` / `sv.ts` — `satisfies Dictionary` fails the
      build if a key is missing in either). Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, and a manual check in the browser that a household with transactions
      across multiple months still shows the right ones per month.

## Wave 2 — sequential (both touch `prisma/schema.prisma`)

Run one at a time, each rebased on the previous one's merge, to avoid Prisma
migration-numbering conflicts (same reasoning `PRODUCTION_READINESS.md`'s Wave 2 used).

- [ ] **G. Add composite indexes for date/expiry range queries** —
      `prisma/schema.prisma`. `Transaction` is indexed on `householdId` and `categoryId`
      separately, but budget queries filter by `householdId` *and* order/filter by `date`
      (see item F above); `InventoryItem` is indexed on `householdId` but the
      "expiring soon" query (`src/lib/notifications.ts`'s `syncExpiringSoonNotifications`)
      filters by `householdId` *and* `expiresAt`. Add `@@index([householdId, date])` to
      `Transaction` and `@@index([householdId, expiresAt])` to `InventoryItem`, generate the
      migration (`npx prisma migrate dev` locally, name it descriptively), and confirm
      `npx prisma migrate deploy` would apply cleanly. No application code changes needed —
      this is a schema/migration-only task. Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, `npm run build`.

- [ ] **H. Invalidate JWT sessions on password change** — currently, `resetPasswordAction`
      (`src/lib/actions/auth.ts:318`) and `updatePasswordAction`
      (`src/app/dashboard/profile/actions.ts:124`) both update `passwordHash` but do nothing
      to the JWT session model (`src/lib/auth.config.ts` — `session: { strategy: "jwt" }`),
      so a stolen session cookie survives a password reset/change. This is a known,
      previously-documented gap (see `PRODUCTION_READINESS.md`'s task K note) — this task
      closes it. Concrete design (already worked out, follow it rather than redesigning):
      1. Add `passwordChangedAt DateTime?` to `User` in `prisma/schema.prisma` +
         migration.
      2. In `resetPasswordAction` and `updatePasswordAction`, set
         `passwordChangedAt: new Date()` in the same `prisma.user.update` call that sets
         `passwordHash` (both already do exactly one such update — find it and add the
         field).
      3. In `src/lib/auth.ts`'s `authorize()` callback (~line 22-28), the `user` row is
         already fetched in full from Prisma — include `passwordChangedAt` in the object
         returned to NextAuth (currently just `{ id, email, name }`) so it's available to
         the `jwt` callback at sign-in.
      4. In `src/lib/auth.config.ts`'s `jwt` callback (~line 11-14), stash it:
         `if (user) token.pwdChangedAt = user.passwordChangedAt?.getTime() ?? null;`
         alongside the existing `token.id = user.id`. This config is shared by both the
         Edge-safe `proxy.ts` and the full `auth.ts` — this is fine since it only *reads*
         the `user` object NextAuth already gives it, no new Prisma call in the Edge path.
      5. In `src/lib/session.ts`'s `requireHousehold` and `requireUserId` (both already run
         Node-side with Prisma access — `requireHousehold` already queries the DB, so this
         adds no *new* query there; `requireUserId` currently does zero DB queries, so this
         does add one there), after `auth()` returns a session, fetch the user's current
         `passwordChangedAt` and compare it against `token.pwdChangedAt` from the session
         (`session.user` needs `pwdChangedAt` piped through the `session` callback in
         `auth.config.ts` the same way `id` already is, at line 15-18). If the DB value is
         newer than what's embedded in the token, treat it as an invalid session — call
         `redirect("/login")` exactly like the existing "no session" branches do.
      6. Existing users have `passwordChangedAt: null` — treat `null` as "never
         changed, any token is valid" (no forced logout for the entire existing user base
         on deploy).
      Add tests covering: a session issued before a password change is rejected by
      `requireHousehold`, a session issued after is accepted, and a user who has never
      changed their password (`passwordChangedAt: null`) is unaffected — matching this
      repo's existing mocked-Prisma vitest style (see `src/lib/session.test.ts` if it
      exists, otherwise create one). Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, `npm run build`, and a manual live check: log in, reset the password
      from another tab/session, confirm the original session is now rejected on its next
      request.

## Wave 3 — independent of Waves 1-2, isolated due to size/risk (own PR)

- [ ] **I. Move notification background-sync off the read path** —
      `src/lib/notifications.ts`. `getActiveNotifications(householdId)` (line 276) currently
      calls `syncMealNotLoggedNotifications` and `syncExpiringSoonNotifications`
      synchronously on *every* call — i.e. every time a household's notification bell is
      fetched. Both scan for overdue meal-plan entries / expiring inventory items and,
      for each new one found, create a `Notification` row and fire a push notification
      (`sendPushToHousehold`) — so viewing the bell can trigger an unbounded number of
      writes and push sends on what should be a read. Change this to a scheduled job
      instead of a request-time side effect:
      1. Add a new route `src/app/api/cron/sync-notifications/route.ts` (`GET` handler)
         that iterates every household (`prisma.household.findMany({ select: { id: true }
         } })`) and runs `syncMealNotLoggedNotifications`/`syncExpiringSoonNotifications`
         for each. Protect it with a shared secret: require a `CRON_SECRET` env var and
         reject (401) any request whose `Authorization: Bearer <token>` header doesn't
         match it — unlike `/api/health`, this route both writes data and sends push
         notifications, so it must not be publicly callable. Add `CRON_SECRET` to
         `.env.example` with a short comment (mirror the existing `UPSTASH_REDIS_REST_*`/
         `VAPID_*` comment style there).
      2. Remove the two sync calls from `getActiveNotifications` — it should become a pure
         read (`prisma.notification.findMany(...)` only, no writes, no push sends), so
         opening the bell never has side effects.
      3. Document the scheduler setup in `DEPLOYMENT.md` (a new section, following its
         existing style): for Vercel, a `vercel.json` `crons` entry hitting this route
         (suggest every 15 minutes as a starting interval, note it's tunable); for
         platforms with their own scheduler (Railway, Render), the equivalent cron/
         scheduled-job config pointed at the same route with the `CRON_SECRET` header set.
      4. Add tests for the new route: rejects a missing/wrong `CRON_SECRET`, and — with a
         valid one — calls both sync functions (mock them, don't require a real DB) for
         every household returned by the household query. Match this repo's existing
         mocked-Prisma vitest style.
      Note: this changes real user-facing behavior (a new out-of-stock/expiring/
      meal-not-logged notification will now appear on a delay of up to the cron interval,
      not instantly on next bell-open) — call this out explicitly when done rather than
      treating it as a pure refactor. Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, `npm run build`, and a manual check: temporarily hit the new route
      with `curl` locally (correct and incorrect `CRON_SECRET`) and confirm the bell still
      shows existing notifications correctly with the sync calls removed from its path.

## Notes for any agent resuming a task after an interruption

Follow `PRODUCTION_READINESS.md`'s own convention: each task's worktree should get its
own `AGENT_PROGRESS.md` at its root reflecting true current progress and next steps, for
anyone (human or agent) resuming after an interruption.
