# REQUIREMENTS.md

Single source of truth for what Squirrel is and how it's built — for AI
coding agents (including any future autonomous build loop) and humans alike.
Update this file whenever product decisions change, and keep it in sync with
what's actually implemented.

## Product summary

Squirrel tracks a household's grocery/pantry inventory, flags items
that are running low, auto-generates shopping lists from what's missing,
plans weekly meals, analyzes grocery cost trends, and tracks general
household income/expenses (one-time and recurring). It's built as a
multi-tenant product — any number of independent households can sign up and
use it, each fully isolated from the others.

## Stack

TypeScript end-to-end, chosen for being well-known, well-documented, and
easy for AI coding agents to work in correctly:

- **Next.js** (App Router) — UI + API via Server Actions / Route Handlers
- **PostgreSQL** via **Prisma** — schema in `prisma/schema.prisma`. Local dev
  runs Postgres via `docker-compose.yml`; point `DATABASE_URL` at any Postgres
  (e.g. Supabase, Neon, RDS) for other environments.
- **Auth.js (next-auth v5)** — email/password (Credentials provider), JWT
  sessions. Config is split: `src/lib/auth.config.ts` holds the Edge-safe
  parts (session/callbacks, no providers) used by `src/proxy.ts`;
  `src/lib/auth.ts` adds the Prisma-backed Credentials provider and is only
  imported from Node-runtime code (Server Actions, Route Handlers). Don't
  import `src/lib/auth.ts` from `proxy.ts` — Prisma's driver adapter doesn't
  run in the Edge runtime.
- **Tailwind CSS + shadcn/ui** — component library. This project's shadcn
  setup uses **Base UI**, not Radix: compose components with the `render`
  prop (e.g. `<DialogTrigger render={<Button>Add item</Button>} />`), never
  Radix's `asChild` — `asChild` silently leaks through as a DOM attribute and
  produces nested `<button>` hydration errors instead of failing loudly.
  A `Button` whose `render` element carries an `href` (a `Link` or `<a>`)
  exposes `role="link"`, not Base UI's default `role="button"`, so a
  screen reader announces a link for something that navigates (UX-68); e2e
  finds these with `getByRole("link", …)`. A `role` passed at the call
  site still wins.
- **react-hook-form + Zod** are installed for future complex forms; the
  current auth/inventory/shopping forms use React's `useActionState` +
  native `<form action={...}>` directly, which is enough for their shape.
- Prisma's client generator is the new `prisma-client` (Prisma 7), which
  **requires an explicit driver adapter** — see `src/lib/prisma.ts`
  (`@prisma/adapter-pg`). A bare `new PrismaClient()` throws at runtime.
  `src/lib/prisma.ts` builds its own `pg.Pool` (rather than letting
  `PrismaPg` construct one) so it can set `max` (20 by default, overridable
  with `DATABASE_POOL_MAX` — the budget page alone fires ~14 queries in
  parallel) and a 10s `idleTimeoutMillis`, and registers that pool with
  `attachDatabasePool()` from `@vercel/functions` so an idle client doesn't
  leak past a suspended Fluid compute instance (a documented no-op off
  Vercel). See DEPLOYMENT.md §3 ("Connection pooling") for how this
  interacts with the pooler `DATABASE_URL` must point at in production.
  **Dropped connections (BUG-1)**: the pool also has a 10s
  `connectionTimeoutMillis` and an `error` listener that reports an idle
  client dying (via `reportError`, so it reaches Sentry) and lets pg discard
  it, rather than crashing the process. The exported client is extended
  (`src/lib/db-retry.ts`) so a *read* (`find*`, `count`, `aggregate`,
  `groupBy`, `$queryRaw`) that fails with "Connection terminated
  unexpectedly" is retried once on a fresh connection; writes are never
  retried, since they may already have been applied.
- **Sentry is kept out of the root bundle (PERF-8).** The browser SDK is
  only ever loaded through a dynamic `import("@sentry/nextjs")` behind a
  `NEXT_PUBLIC_SENTRY_DSN` check, in `src/instrumentation-client.ts`
  (`init` and `onRouterTransitionStart`) and `src/lib/sentry-client.ts`
  (`captureClientException`, used by `error.tsx` and `global-error.tsx`).
  The DSN is inlined at build time, so with none set no Sentry chunk is
  emitted and `/login` etc. no longer carry ~130 KB gzipped of it. Never add
  a static `@sentry/nextjs` import to client code. With a DSN set, the SDK
  loads async, so an error in the first moments before the chunk arrives
  isn't captured. `withSentryConfig` (applied only when `SENTRY_DSN` is set)
  also passes `bundleSizeOptimizations` (debug statements, tracing and
  Session Replay code excluded; `tracesSampleRate` is 0 and Replay is never
  enabled).
- **Server-side errors go through `reportError` (MAINT-11).** Caught
  failures in cron routes, `/api/health`, the digest unsubscribe route,
  `weekly-digest.ts`, `push.ts` and the Redis fallback in `rate-limit.ts`
  call `reportError(message, error, { householdId? })`
  (`src/lib/report-error.ts`): one redacted `logger.error` line plus
  `Sentry.captureException`, tagged with `householdId` when the failure
  belongs to one household. No server code calls `console.error`/`warn`
  directly (only `logger.ts` does). Rejected cron requests and the
  missing-`AUTH_SECRET` skip use `logger.error` alone, since they aren't
  exceptions.
- **next-themes** drives the light/dark theme toggle; **a hand-rolled
  cookie + dictionary system** (not a routing library like `next-intl`)
  drives English/Swedish translation. See "Theming" and
  "Internationalization" below.

## Internationalization

English and Swedish are both fully supported; there's no locale-prefixed
routing (no `app/[lang]/...`) — every route stays where it is, and the
active locale is a `locale` cookie (`src/lib/i18n/locales.ts`), read
server-side, the same pattern already used for `active_household` and
`sidebar_expanded`. This was a deliberate simplification over the
`app/[lang]` structure Next's own i18n guide leads with: this app has no
SEO/static-export need for locale-prefixed URLs, and restructuring every
existing route under `[lang]` would have been a much larger, riskier change
for the same user-facing result. **Don't "fix" this into `[lang]` routing or
`next/root-params`** without a real reason (e.g. a future requirement for
locale-specific URLs) — it's a considered tradeoff, not an oversight.

- **Dictionaries**: `src/lib/i18n/dictionaries/en.ts` is the source of
  truth; `type Dictionary = typeof en`. `sv.ts` is typed
  `satisfies Dictionary`, so TypeScript fails the build if a key is missing
  or a nested shape drifts between locales. Values are plain strings (or
  `{ one, other }` plural pairs) — never functions — so the whole dictionary
  is serializable and safe to pass as a prop across the Server/Client
  Component boundary.
- **Reading the dictionary**: `getDictionary()` / `getLocale()`
  (`src/lib/i18n/get-dictionary.ts`, `"server-only"`, wrapped in React's
  `cache()`) read the `locale` cookie. Every Server Component that needs
  translated text calls `getDictionary()` itself — there's no `[lang]` param
  to thread through layouts, so `cache()` is what dedupes the repeated
  `cookies()` read within one request instead. Locale precedence: signed-in
  account locale, then the `locale` cookie, then the browser's
  `Accept-Language` (`negotiateLocale()` in `locales.ts`, primary-subtag
  match, q-values honoured), then `en`.
- **Signup stores the language it was shown in (UX-56)**: `signupAction`
  and `joinViaInviteSignupAction` create the user with `locale` set to
  `getLocale()` (the pre-auth cookie or browser language). Without it the DB
  default `en` applied, and since the account locale outranks the cookie, a
  Swedish signup met an English dashboard on first login (and English
  reset/digest emails). `e2e/signup-locale.spec.ts` covers it.
- **Signup explains household name and points invitees away (UX-60)**:
  `/signup` opens with "Joining someone's household? Open the invite link
  they sent you." (someone whose partner already uses Squirrel would
  otherwise create a second, empty household), and "Household name" has
  helper text (`aria-describedby`) saying everyone you invite sees this
  name, since the placeholder vanishes on focus.
  `e2e/signup-household-hint.spec.ts` covers it.
- **A warm join page (UX-62)**: `/join/[token]` opens like `/signup`: the
  brand badge, an h1 "{inviter} invited you to {household} on Squirrel", a
  one-line pitch, then the same icon-in-field styling as signup. The
  inviter comes from `Invitation.invitedById` (set by `createInviteAction`,
  `ON DELETE SET NULL`); a link made before the column existed, or whose
  inviter deleted their account, reads "You're invited to {household} on
  Squirrel". The page is public, so `getInvitationForDisplay` selects the
  inviter's display name only (never id or email), and only for a valid
  token. A dead link offers "Go to Squirrel" and "Log in" (a signed-in
  visitor gets "Go to dashboard"), since the invitee may never have had an
  account. `e2e/ux-62.spec.ts` covers it.
- **Server-action errors and shared labels (UX-16)**: what an action
  returns as `{ error }` is in the request's language. `dict.errors` holds
  the shared messages; `fail("itemNotFound")`, `zodFail(parsed.error)` and
  `toFriendlyError(error)` (all in `src/lib/actions/errors.ts`, all async)
  resolve them with `getDictionary()`. A Zod schema is a module-level
  constant and can't know the language, so its messages are `errors` keys
  wrapped in `v("nameRequired")` (a typo is a compile error), and
  `zodFail` translates the first issue; Zod's own English text is never
  shown, it falls back to `errors.invalidInput`. `errorText` falls back to
  English when the dictionary can't be read, so a failure path never throws
  a second error. `dict.common` (`loading`, `close`, from
  `src/lib/i18n/common.ts`) labels the loading skeletons and the dialog
  Close buttons; `components/ui/dialog.tsx` has no `dict` prop, so it reads
  `commonCopy[getDocumentLocale()]` (the page's `<html lang>`, which also
  covers an account locale that has no cookie on this device yet). `global-error.tsx` follows the cookie
  locale and the OS colour scheme, using the globals.css tokens instead of
  hex. Guarded by `src/lib/actions/error-strings.test.ts`, which fails on a
  string-literal `error:` in any action file that isn't on its `PENDING`
  list (the files MAINT-7 still has to convert; a file that becomes clean
  must be removed from the list), and by `e2e/localised-errors.spec.ts`.
- **Public language toggle**: `LegalFooter` (rendered by every logged-out
  page) carries a `PublicLanguageToggle` button that names the language in
  use ("Language: English", UX-51) and switches to the other, calling
  `setLocaleAction` like the dashboard toggle (via `useLocaleToggle`, whose
  async transition keeps the button disabled, dimmed and `aria-busy` until
  the refreshed page arrives).
  The `locale` cookie is already in `cookie-inventory.ts` as a preference.
  Covered by `e2e/public.spec.ts`.
- **Passing translations to Client Components**: the convention is to pass
  a named sub-object (e.g. `dict.household.invite`) as a `dict` prop, or a
  `Pick<Dictionary, …>` slice when a component reads several namespaces —
  not the **whole `Dictionary`** and not hand-picked individual strings. A
  client prop is serialized into the document and every
  layout-re-rendering action response, and the full dictionary is ~87 KB.
  The dashboard layout follows this (PERF-5): `Sidebar` and `BottomNav`
  take `ShellDictionary` (`nav`, `notifications`, `language`, `theme`,
  defined in `nav-items.ts`) and `HouseholdSwitcher` takes
  `dict.household.switcher`. `src/lib/i18n/format.ts` exports `format(template, vars)`
  (`"{key}"` interpolation) and `plural(count, { one, other })`, both plain
  functions usable from Server or Client Components, for the handful of
  strings that need a count or a name substituted in.
- **Dates and numbers follow the locale too (UX-15)**: anything formatted
  for display takes the viewer's `locale` (from `getLocale()`, passed down
  as a prop) and goes through `Intl.DateTimeFormat`/`Intl.NumberFormat` or
  `createMoneyFormat` — never `toLocaleDateString()` with no locale (the
  runtime's default, which is English on the server) and never
  `toFixed(2)` for on-screen text. So the budget month reads
  "oktober 2026", the meal planner's week "28 sep.–4 okt. 2026"
  (`formatRange`, in UTC since week keys are UTC dates, so server and
  browser agree), split warnings and "Your share" use the household's
  money format, and the cost analyzer's price change is a locale percent
  ("+12,5 %"). A list the user didn't name is called
  `datedName(prefix, locale)` (`src/lib/i18n/format.ts`), e.g.
  "Inköpslista — 5 okt. 2026"; the shopping-list and receipt dialogs'
  name placeholders use the same helper so they match what gets saved.
  Number *inputs* stay `type="number"` with dot-decimal values.
- **Units are shown in the viewer's language (UX-44)**: stored units are
  free text ("pcs", "tbsp"), but every place that displays one goes
  through `unitLabel(unit, labels)` (`src/lib/units.ts`), which looks the
  unit's `canonicalUnit()` up in the dictionary's `units` map, so a
  Swedish user sees "6 st" for "pcs" and "msk" for "tbsp" (or
  "tablespoon"), and an unknown unit ("glug") shows as stored. Server
  Components call it with `dict.units`; Client Components use
  `useUnitLabel()` from `UnitsProvider` (`src/components/units-provider.tsx`),
  which the dashboard layout and the public share page fill from
  `dict.units`, instead of threading the map through ~26 components'
  props. Display only: stored values, unit inputs and comboboxes (which
  list and accept the stored spelling), and every comparison and
  conversion (`canonicalUnit`, `classifyUnits`) are unchanged. A
  synonym is shown as its canonical unit's label in English too ("pieces"
  reads "pcs"). A new known unit needs an entry in both dictionaries.
- **Switching locale**: `setLocaleAction` (`src/lib/actions/locale.ts`) sets
  the cookie and calls `revalidatePath("/", "layout")`; the client-side
  `useLocaleToggle` hook (`src/components/language/use-locale-toggle.ts`)
  calls it then `router.refresh()` so the current tab updates immediately
  without a full navigation. The toggle lives in the sidebar (desktop) and
  the bottom nav's "More" menu (mobile) — see "Navigation & responsive
  layout".
- **Tradeoff**: because the landing/login/signup pages now read the
  `locale` cookie (via `getDictionary()`), they're server-rendered on
  every request instead of statically prerendered (visible in `next build`
  output — those routes moved from `○ Static` to `ƒ Dynamic`). Acceptable
  for this app's traffic; worth knowing if performance ever becomes a
  concern.
- New user-facing text must be added to **both** `en.ts` and `sv.ts` — the
  `satisfies Dictionary` check catches a missing key but not a missing
  translation someone forgot to update.

## Multi-tenancy model

- `Household` is the tenant. `User` accounts join one or more households via
  `HouseholdMember` (role: `OWNER` | `CONTRIBUTOR`).
- Every domain table is scoped by `householdId`. Every query/mutation is
  scoped server-side via `requireHousehold()` (`src/lib/session.ts`), which
  resolves the caller's household from their session — never trust a
  client-supplied household id.
- Sharing: an `Invitation` (random token, 7-day expiry) generates a
  `/join/[token]` link. Visiting it while logged in joins that household to
  your account; while logged out, it shows a signup form that creates the
  account and joins in one step, then shows the verification-sent panel
  naming the household (no active-household cookie is written there: it
  would re-render the route and show "Invalid invite" for the used link).
  Anyone joining via invite becomes a
  `CONTRIBUTOR` — invites can't grant ownership. The link is always shown
  on-screen for the inviter to copy and send manually; see "Invite email
  delivery" below for the additional option to have it emailed directly.
- **Roles**: `OWNER` is whoever created the household (`signupAction` /
  `createHouseholdAction`); everyone who joins later is a `CONTRIBUTOR`. Both
  roles can fully operate within the household — inventory, shopping lists,
  inviting new contributors, etc. These actions are owner-only, enforced
  server-side in `src/lib/actions/household.ts` (checked against the
  session's `role`, not trusted from the client):
  - `removeMemberAction` — removes a `CONTRIBUTOR` from the household. Fails
    (returns `{ error }`) if the caller isn't the owner, the target is the
    owner, or the caller targets themselves.
  - `deleteHouseholdAction` — deletes the household and everything in it
    (cascades through every domain table via `onDelete: Cascade`). Fails if
    the caller isn't the owner, or if it's the only household they belong to
    (a user can't give up their last household on their own — though an
    owner removing them can still leave them with none; see "Users with no
    household" below). On success it falls back the caller's
    `active_household` cookie to another of their households.
  - Managing the calendar feed (`enableCalendarFeedAction`,
    `regenerateCalendarFeedAction`, `disableCalendarFeedAction`, GAP-3):
    it publishes the household's meal plan and bill names at a link that
    needs no login. Contributors can still see and copy the link once it's
    on. See "Calendar feed" below.
  - `renameHouseholdAction` (UX-75) — renames the household. Same trimming
    and 1-60 character rules as creation; returns `{ error }` for a
    non-owner or an invalid name. The Household page shows the "Household
    name" card (`RenameHousehold`) to the owner only, with a Save button
    that is disabled until the name changes. The dashboard layout is
    revalidated, so the header and switcher show the new name; invite emails
    and the join page read it from the database on each request.
  - Everything else on the Household page is open to both roles, including
    the "Shopping" auto-add setting (`setAutoAddLowStockToListAction`,
    AUTO-8) — day-to-day shopping behaviour, not administration — and the
    shared notes board (GAP-16, see "Household notes board" below), where
    any member can add or delete any note.
  - `src/app/dashboard/household/page.tsx` renders remove-member controls
    (`MemberList`) and the delete-household danger zone
    (`DeleteHouseholdDialog`, which requires typing the household's name to
    confirm) only when `role === "OWNER"`; contributors see the plain member
    list with no admin controls.
  - See "Ownership transfer and leaving a household" below for what a
    `CONTRIBUTOR` or the current `OWNER` can do instead of (or before)
    deleting the household.

### Ownership transfer and leaving a household

Every household must always have exactly one `OWNER`, so leaving and
ownership hand-off are two separate actions in
`src/lib/actions/household.ts`, both `MemberList`-driven from
`src/app/dashboard/household/page.tsx`:

- `leaveHouseholdAction` — a `CONTRIBUTOR` removes their own membership.
  Mirrors `removeMemberAction`'s shape but is self-targeted (derives the
  membership to delete from the session, not a client-supplied id), and
  enforces the same "can't leave your only household" rule
  `deleteHouseholdAction` enforces for owners. Falls back the caller's
  `active_household` cookie the same way `deleteHouseholdAction` does. Fails
  if the caller is the `OWNER` — an owner must `transferOwnershipAction` or
  `deleteHouseholdAction` instead, never leave outright.
- `transferOwnershipAction(newOwnerMemberId)` — owner-only. Swaps `OWNER`/
  `CONTRIBUTOR` between the caller and the target member in one
  `$transaction`, the same pattern `removeMemberAction`/
  `deleteHouseholdAction` use for re-deriving both memberships from the
  session-scoped household rather than trusting anything but the target's
  id from the client.
- UI (`MemberList`, `src/components/household/member-list.tsx`): every
  member sees a leave control on their own row, except the owner — the
  owner's row never shows "leave" since they must transfer or delete
  instead. The owner additionally sees a transfer-ownership control on
  every other (non-owner) row. Both actions confirm in a dialog
  (`src/components/ui/dialog.tsx`) before running — transfer names the
  target member, leave states what access is lost — mirroring
  `DeleteHouseholdDialog`'s confirm-before-destructive-action pattern
  without requiring the household name to be typed (lower stakes than
  deleting the household outright, but still not a bare click).

### Users with no household

`leaveHouseholdAction` and `deleteHouseholdAction` both refuse to take away
a user's last household, but `removeMemberAction` doesn't check whether the
removed contributor has any other household (the owner can't see that, and
it shouldn't stop them removing someone). So a signed-in user with zero
`HouseholdMember` rows is a normal state, not a corrupt one.

- `requireHousehold()` redirects such a user to `/no-household`
  (`NO_HOUSEHOLD_PATH` in `src/lib/session.ts`). It used to redirect to
  `/login`, but `src/proxy.ts` sends any request that has a session away from
  `/login` to `/dashboard`, so that looped forever. Signing the user out
  instead was rejected: their account (and user-scoped data like the personal
  budget) is still valid, and they would just log back in to the same dead
  end.
- `src/app/no-household/page.tsx` sits outside `/dashboard` so the dashboard
  layout's `requireHousehold()` never runs for it. Its guard,
  `requireUserWithoutHousehold()`, sends signed-out visitors to `/login` and
  anyone who does have a household to `/dashboard`. The page offers the same
  two ways into a household as everyone else has: create one (the user
  becomes its `OWNER`), or open an invite link from a member while signed in
  (`/join/[token]`). It also has a log-out button in case this is the wrong
  account.
- `createHouseholdAction` and `acceptInviteAction` only need the caller's
  user id, so they use `requireUserId()` rather than `requireHousehold()`.
  With `requireHousehold()` they would redirect a zero-household user away
  before doing anything, leaving no way out of the page.

### Invite email delivery

`createInviteAction` (unchanged) still creates the `Invitation` and returns
its `/join/[token]` URL for the always-shown on-screen copy link — email is
additive, not a replacement, and the link keeps working even if email
sending fails or isn't configured. `sendInviteEmailAction(token, email)` is
a separate action that re-validates the token belongs to the caller's
household and isn't expired/accepted, then sends the same link via
`sendHouseholdInviteEmail` (`src/lib/email.ts`), using **Resend** — chosen
as the least-friction provider for a Next.js app (no SMTP server to run,
works with just an API key) since nothing in the codebase had an existing
email provider or preference. Configuration is `RESEND_API_KEY` (required
to actually send — without it, `sendInviteEmailAction` returns a
graceful `{ error }` and the UI falls back to "use the link") and optional
`EMAIL_FROM` (defaults to Resend's shared `onboarding@resend.dev` sender,
which needs no domain verification; set `EMAIL_FROM` to a verified sending
address in production) — see `.env.example`. The join URL embedded in the
email is built server-side from request headers (`x-forwarded-host`/
`host`, `x-forwarded-proto`), not a client-supplied origin, since a Server
Action is a POST endpoint reachable by anyone, not just through the UI that
renders it. `InviteButton` (`src/components/household/invite-button.tsx`)
adds an email input + send button below the existing link/copy UI, reusing
the same invitation token the link already points at. `sendInviteEmailAction`
is rate-limited (`checkRateLimit`, 10/hour) keyed on the *sending* household
member (`invite-email:<userId>`), returning `{ error }` past the limit —
without it, any authenticated household member could trigger unlimited
outbound email to arbitrary addresses via this app's sending domain.
- **Switching households**: a user can belong to multiple households (e.g.
  their own home + a shared vacation home). The active one is tracked by the
  `active_household` cookie (`src/lib/session.ts`), read (never written) by
  `requireHousehold()`, which falls back to the first membership if the
  cookie is missing/invalid. Only `src/lib/actions/household.ts`'s
  `switchHouseholdAction`/`createHouseholdAction` write that cookie — both
  run in a Server Action, since cookies can't be set during a Server
  Component render. The header's `HouseholdSwitcher` component is the UI for
  this.
- **"Shared with" indicator**: when a household has more than one member, the
  household page (`src/app/dashboard/household/page.tsx`) and the dashboard
  overview (`src/app/dashboard/page.tsx`) surface that fact — "Shared with N
  other person/people" — each deriving the count independently (household
  page filters its already-fetched member list by `userId`; the overview runs
  a dedicated `householdMember.count` query since it doesn't otherwise fetch
  members). Hidden entirely when the household has only the current user.
- **Overview greeting (UX-72)**: the overview heading greets by first name
  ("Good afternoon, Åsa", never the full display name) and by the hour in the
  user's own time zone. The server runs in UTC and doesn't know the zone, so
  `components/dashboard/greeting.tsx` reads the hour in the browser
  (`useSyncExternalStore`); the server render shows the neutral
  `dashboard.greeting.hello` ("Hello, Åsa") until hydration. Bucketing and
  first-name extraction are `src/lib/greeting.ts`. Nothing is stored, so no
  cookie-inventory entry. Covered by `e2e/overview-greeting.spec.ts`.
- **Overview stat cards (UX-71)**: the three household cards read honestly
  and each leads somewhere. Low stock counts items strictly *low* (the same
  meaning as the inventory filter), so the number matches its link
  (`/dashboard/inventory?status=low`; `?status=out` when only out-of-stock
  items remain). The number is warning-coloured only above 0, out-of-stock
  is its own red line, "N already on your list" counts items needing restock
  with an unpurchased row on an active list, and when nothing needs
  restocking the card reads "All stocked up" with a check icon. The shopping
  card opens the list itself when there's exactly one active list, shows
  "No lists yet — start one" with a "Start a list" button when there are
  none. Total items tracked links to the inventory ("Add your first item"
  when empty). Covered by `e2e/overview-stat-cards.spec.ts`.

## Data model

See `prisma/schema.prisma` for the authoritative version. Summary:

**Inventory & shopping** (built)
- `InventoryItem` — name, category, quantity, unit, `lowStockThreshold`,
  location, `lastKnownPrice`. Low stock = `0 < quantity < lowStockThreshold`
  (strict, so restocking to exactly the threshold reads "in stock"); out =
  `quantity <= 0`. The forms call the field "Running low below" (UX-120).
  The add form pre-fills 2 for a piece count (1 would jump from "In stock"
  straight to "Out of stock") and nothing for a weight or volume, which
  follows the unit as it's picked; empty saves as 0, "warn only when out".
  The inventory page (`InventoryClient`) filters client-side (in-memory —
  fine at household scale) by name substring, category, location, and
  status (in/low/out of stock, expiring soon, expired); filter dropdown
  options come from the
  distinct categories/locations already present in that household's items.
  **What needs attention (UX-121)**: above the search row a "Needs
  attention" group shows tappable counts ("4 out", "1 low", "4 expiring",
  "2 expired"), each hidden at zero. Tapping one sets the Status filter to
  it (`aria-pressed`; tapping the active one clears it). Counts cover every
  item, not the filtered list (`countProblemStatuses`). Expiring is the
  3-day warning window of `getExpiryStatus`, expired is past the date, and
  the two stock and expiry kinds are independent, so a low item that is also
  expiring counts under both. Status also accepts `?status=expiring` and
  `expired`, and the saved view prefs keep them. The "well stocked" note
  needs no expiring or expired items either.
  Adding an item offers previously-used categories/locations via a native
  `<datalist>` (see Conventions) rather than a fixed enum, so it stays
  freeform but self-suggesting.
  - **Item page (MATCH-6)**: `/dashboard/inventory/items/[id]`
    (design `docs/archive/RECIPE_INGREDIENT_MATCHING.md` §6.1), a Server Component
    that loads the item (with its `ItemUnitConversion`s and `ItemAlias`es),
    its linked `RecipeIngredient`s, its pending rows (not purchased, on an
    `ACTIVE` list), its template rows and the household's other items (for
    "Merge into another item…", MATCH-7) and its last purchases (GAP-47) in
    household-scoped queries
    run together, and `notFound()`s an item of another household. Opened
    from the ⓘ "Details for {name}" link in each inventory row's action
    cluster (desktop table and phone card), from a linked ingredient name
    on a recipe card, and from the item form's "Units, recipes and
    details" link. Sections, stacked on phones:
    - **Back arrow**: goes one step back, to wherever the page was opened
      from, carried as `?from=` (`src/lib/inventory/item-page-origin.ts`,
      a fixed set of values, so never an open redirect): the catalog on
      the filter it was showing ("Manage items", e.g.
      `?filter=unitProblems`, so fixing unit problems is a loop through
      one list), the Recipes tab from a recipe card's ingredient link
      ("Recipes"), else the inventory ("Inventory"). "Merge into another
      item…" keeps the origin on the kept item's page. The catalog's
      chips and the meal-planning tabs also write `?filter=` / `?tab=`
      with `history.replaceState`, so the browser's back button lands on
      the same filter or tab.
    - **Header**: name, category · location, then the controls the list
      gives a row (UX-124, `ItemPageControls`, reusing `QuantityStepper`,
      `StockBadge`, `ExpiryBadge` and `ItemActions`): the −/+ stepper (tap
      the number for the exact-amount sheet), the stock badge ("In stock",
      "Low stock", "Out of stock" — an empty item no longer reads "In
      stock: 0 pcs"), the Expiring soon / Expired, Opened and Frozen tags,
      "Best before {date}" (≈ when estimated), and the Edit, Delete, Mark
      opened, Freeze, Add to shopping list and Mark as empty actions (the
      list's own handlers, `useItemHandlers`, so toasts and Undo match;
      no "Details" link, since this is it). Delete returns to where the
      page was opened from. Then "running low below 0.5 pcs" and "Change
      unit…". The stock actions also revalidate this page, so the badges
      follow a change. The "Also on" list links are underlined in the link
      colour.
    - **Units**: "Counted in {unit}" and each conversion, written the way
      people know the number (`conversionSentence`, the review's
      `conversionLeadUnit` rule: "1 pcs = 2000 g", "1 dl = 60 g"), with
      edit and delete (confirmed). "Add conversion" opens the same dialog
      blank. The dialog takes the unit and "1 X = [n] Y", pre-filled from
      `unitConversionHint` and marked "≈" while untouched. `saveUnitConversionAction`
      canonicalizes the unit, keeps the factor within
      `MIN/MAX_UNIT_FACTOR`, refuses the item's own unit and a unit the
      generic table already converts (`convertForItem` would never read
      it), and upserts one row per unit (an edit that changes the unit
      replaces its row). `deleteUnitConversionAction` only reaches a
      conversion through an item of the household. "Try it" is a live,
      client-side calculator over `convertForItem`.
    - **Used in N recipes**: each linked row as the recipe writes it, then
      `convertForItem` into the item's unit (three significant digits)
      with ✓, or ⚠ and an "Add {unit}…" button that opens the conversion
      dialog with that unit filled in. The recipe name links to
      `/dashboard/meal-planning?tab=recipes&recipe=<id>`, which opens the
      Recipes tab searched down to that recipe.
    - **Also on**: pending list rows ("E2E Groceries (1 pcs)", linking to
      the list) and templates (linking to the shopping lists page).
    - **Recent prices (GAP-47)**: the item's last 10 `PriceHistory` rows,
      newest first (`getRecentPrices`, `src/lib/inventory/recent-prices.ts`):
      date, the store when one was recorded, the line price and, when the
      row has a quantity and unit, the per-unit price ("SEK 15.00 / l";
      `perUnitPrice`, the same price-over-quantity definition as the spike
      warning). Rows are shown in the base currency they're stored in. The
      read goes through `requireHousehold()` and
      `inventoryItem.householdId`, so another household's item id returns
      nothing. An item with no history shows no section at all.
    - **Names that map here**: the item's learned aliases, each removable
      (`removeItemAliasAction`, household-scoped), so the name is asked
      about again.
    - **Change unit…** (`changeItemUnitAction`): the new unit and "How
      many {new} is 1 {old}?", pre-filled by `suggestedUnitChangeFactor`
      (the generic table, "l" → "dl" = 10, else a saved conversion from
      the new unit, "1 g = 0.0005 pcs" → 2000), with a before/after
      preview of stock and low-stock level. `planUnitChange`
      (`src/lib/inventory/item-units.ts`, pure, shared by the preview and
      the action) multiplies quantity and threshold by the factor (ten
      significant digits, so "5 g" in kg stays 0.005), multiplies each
      conversion's factor by it, drops a conversion from the new unit or
      one the generic table now converts, and adds the old unit as a
      conversion ("1 pcs = 2000 g"). One transaction writes the item with
      an `updateMany` guarded on the unit, quantity and threshold it read
      (a +/- from another phone in between fails with "The stock
      changed…" rather than being rescaled twice), then replaces the
      conversions. `lastKnownPrice` and `PriceHistory` are untouched.
      This is the only place stock is converted between units.
    - **Item form's unit field**: still a plain edit, but only while
      nothing is measured in the old unit. `updateInventoryItemAction`
      refuses a unit change (other than a respelling like st → pcs) on an
      item with stock or saved conversions and points to "Change unit…".
      UX-128: for an item with stock the form shows the unit read-only
      (it still posts, unchanged) with an inline "Change unit…" link to the
      item page. The one case the form can't see, saved conversions with no
      stock, stays editable; its refusal comes back with `errorField:
      "unit"` and shows under the unit field, in view, with the same link,
      instead of at the foot of the scrolling form.
    - **Duplicate warning in the Add dialog (UX-126)**: while a name is
      typed, `findDuplicateOfName` (`src/lib/inventory/duplicates.ts`)
      checks it against the household's items with the catalog's
      duplicate rules (same normalized name, same after the plural fold,
      or bigram score of at least 0.8; aliases and dismissals don't
      apply). A match shows "Smör is already in your pantry (499 g)." under
      the name field with an "Add to existing" button, which adds the
      form's Quantity to that item through `adjustQuantityAction` (toast,
      dialog closes), converted from the form's unit into the item's with
      `amountInExistingUnit` (2 kg onto an item in g adds 2000 g); when the
      units don't convert (kg vs pcs) the button is replaced by a note that
      they differ instead of creating a second one. The normal Add
      buttons still work, so a genuinely different item can be saved. Only
      the header's Add dialog gets the item list; the empty state's has no
      items to match.
    - **Merge into another item…** (MATCH-7): picks the item to keep with
      `ItemCombobox`, then the catalog's merge preview and confirm (below).
      This item is the one that goes, so a merge ends on the kept item's
      page. Cancel and a disabled Merge show before an item is picked, and
      Escape closes it (`ItemCombobox` passes "nothing picked" to Base UI
      as `null`, which lets Escape through to the dialog).
  - **Inventory on a phone (UX-20)**: below `sm` the page header shows a
    labelled "Add item" plus a labelled "More inventory actions" ⋯ menu
    (Scan, Scan multiple, Scan a shelf, Paste a list, Export CSV, Manage
    items). The manage-items entry keeps the duplicate-group badge and the
    `?filter=duplicates` deep link: `InventoryActionButtons` computes the
    count (one cached `countDuplicateGroups` per render, shared with the
    desktop link) and the AI-configured flags server-side, since
    non-`NEXT_PUBLIC_` env vars are never readable in a client component.
    The menu opens the dialogs through hidden, non-focusable
    (`tabIndex={-1}`, `aria-hidden`) trigger buttons. From `sm` up the
    individual icon buttons stay. Each row keeps Edit visible and moves
    Details, Mark opened, Mark empty and Delete into a row "More actions"
    ⋯ menu (8 px between the two targets, M3). Small fixes: ghost
    quantity steppers, the bare "last updated" date reads "Last updated
    4 Oct", the bulk-edit bar sticks to the bottom on phones, and the
    mobile filter selects have real `Label`s.
  - **Compact inventory rows on phones (UX-45)**: below `sm` the list is
    a bordered `<ul>` (one per group) of two-line rows, about 80 px each, so
    eight or more items fit on a Pixel 7 screen: name with "· category •
    location" muted and truncated on one line beside the badges, then the
    −/+ stepper and Edit / ⋯ on the next. The selection checkbox sits in
    its own column 14 px from the content, so its 44 px tap halo never
    covers the − button. Each `<li>` wraps the row's UX-35 `SwipeRow`; the
    selected tint and left accent sit on the row inside its sliding layer,
    and `pl-3.5` keeps the checkbox halo inside the row's `overflow-hidden`.
    The "Last updated" line is gone from phone rows
    (the desktop table keeps its column); the item page shows "Last
    updated {date} by {name}" under the stock line instead (name dropped
    when the updater left or isn't recorded). `e2e/inventory-compact-rows.spec.ts`
    counts the rows in one screen and checks the stepper and item page.
  - **Row actions stay on screen in the desktop table (UX-130)**: the
    name, category and location cells take 16 / 10 / 10 % of the table
    with `max-w-0` and truncate (full text in the `title`), so a row with all seven icons (Mark
    opened, Freeze, Add to list, Details, Mark empty, Edit, Delete) fits the
    ~990 px column at 1280 px with no horizontal scroll.
    `e2e/ux-130.desktop.spec.ts` asserts it.
  - **Cards below `lg`, table from `lg` (UX-141)**: the inventory table
    only shows from 1024 px (`lg`). Between `sm` and `lg`, a tablet with
    the sidebar open (810 px), the name column was about three characters
    ("Crè…") and Last updated ran off the edge, so those widths get the same
    card list phones do (names read in full, no horizontal scroll). The
    bulk-edit bar and other `sm` rules are unchanged. `e2e/ux-141.spec.ts`
    runs in the `tablet` project too and asserts it.
  - **"I used some / I bought more" (UX-119)**: the −/+ stepper moves by a
    step that suits the unit (`quantityStep`, `src/lib/inventory/quantity-step.ts`):
    50 for g and ml, 0.25 for kg and l, 1 for everything else (counts and
    custom units), so Smör 500 g goes to 450 g and Gul lök 1.5 kg to
    1.25 kg. Tapping the quantity (a ghost button named "Adjust
    {name} ({amount})") opens `QuantitySheet`, a dialog/bottom sheet with a
    Used / Bought toggle (Used first), one-tap chips that apply at once and
    close it (unit-sized presets: 100, 200, 500 g; 0.25, 0.5, 1 kg; 1, 2, 5
    otherwise; ½ of the stock; All, for Used; and Last {amount}, the previous
    amount for that item kept in memory only), and a decimal-keypad field
    (`inputMode="decimal"`, comma accepted) with a "Use amount" / "Add
    amount" button. A gram item drops by 200 g in two taps. The sheet calls
    the same `adjustQuantityAction` with a signed delta through the
    stepper's optimistic transition, so rounding, the zero floor and the
    low-stock auto-add are unchanged. Swipe right was already removed by
    UX-35. `e2e/inventory-quantity-sheet.spec.ts`.
  - **Item catalog (MATCH-7)**: `/dashboard/inventory/items` (design §6.2,
    §6.3), reached from "Manage items" in the inventory page's header
    actions (decision 5: no bottom-nav tab). That link carries a badge
    with the number of open duplicate groups (`countDuplicateGroups`,
    which reuses the page's item query and adds only the alias and
    dismissal queries) and, when there are any, opens on
    `?filter=duplicates`. The page loads everything in six
    household-scoped queries run together (`loadCatalog` in
    `src/lib/inventory/catalog-data.ts`: items with `_count`s of recipe,
    list, template and price rows; bought list rows per item; distinct
    recipe units per item; conversions; aliases; dismissals), then the
    pure `buildCatalog` (`src/lib/inventory/catalog.ts`). Filter chips,
    each with its count:
    - **All**: name (with "never stocked" and "Can't convert {units}"
      tags), category, stock + unit, "N recipes". Each row links to the
      item page. A grid on wider screens, stacked cards on phones.
    - **Possible duplicates**: the groups below.
    - **Never stocked**: quantity 0, no `PriceHistory`, never on a bought
      list row (`isNeverStocked`).
    - **Unit problems**: some recipe uses the item in a unit that
      `convertForItem` can't turn into the item's unit.
  - **Duplicate groups**: `findDuplicateGroups(items, aliases, dismissals)`
    (`src/lib/inventory/duplicates.ts`, pure). A pair is a candidate when
    the normalized names are equal (strength 1), equal after the recipe
    matcher's plural fold (`foldedForms`, 0.95), one's name is an alias of
    the other (0.9), or the bigram score (`itemNameSimilarity`'s Dice
    coefficient) is ≥ 0.8 (the score). Dismissed pairs are skipped, pairs
    join into groups by union-find, and groups sort by their strongest
    pair. The fuzzy pass compares only names sharing a bigram (an
    inverted index), which keeps 2,000 items well under a second (a test
    guards it); beyond `FUZZY_MAX_ITEMS` (3,000) only the other rules
    run. Members are tagged with unit, stock, recipe count, barcode and
    "never stocked", and sorted by `compareKeeper`: stock first, then the
    most recipe/list/template/price rows, then the oldest. In each group a
    radio picks the keeper (the suggested one to start with) and a
    checkbox each item to merge (all ticked).
    - **Not duplicates** (`dismissDuplicatesAction`) stores every pair in
      the group as an `InventoryDuplicateDismissal` (`householdId`,
      `itemAId`, `itemBId`, ids sorted, unique, cascading with either item
      and the household), so the group doesn't come back for anyone.
  - **Merge** (decision 4: confirm with a preview, no undo).
    `previewMergeAction(keeperId, mergeIds)` is read-only: one
    household-scoped `findMany` returns the keeper and each merged item
    with its conversions and the counts that would move (recipes, list
    rows, templates, prices, learned names, conversions). The dialog runs
    the pure `planMerge` (`src/lib/inventory/merge.ts`) over it, the same
    one the merge runs, so it shows exactly what happens: each item's
    stock converted into the keeper's unit, the stock before → after, a
    taken or removed barcode, filled-in fields, conversions saved, names
    learned and items deleted. A unit that can't be converted
    (`mergeUnitFactor`: the generic table or the keeper's conversions,
    else the merged item's own conversion from the keeper's unit read
    backwards) asks "How many {other} is 1 {lead}?" inline, and Merge
    stays disabled until every one is answered. Merge is the only button
    that writes. `mergeInventoryItemsAction({ keeperId, merge: [{ id,
    factor? }] })` is Zod-validated, takes at most 10 items, refuses the
    keeper among the merged, checks every id in one household-scoped
    `findMany`, and does all of this in one `$transaction`:
    - the keeper's stock gets each item's stock converted (by the table, a
      conversion or the typed factor), with an `updateMany` guarded on the
      keeper's quantity and unit, and the merged items are deleted with a
      guard on theirs, so a +/- in between fails with "The stock
      changed…";
    - a factor the keeper didn't already have is saved as an
      `ItemUnitConversion` on it, and the merged items' conversions are
      re-expressed through it (the keeper's own row wins, and pointless
      or out-of-range ones are dropped);
    - pending list rows of a merged item on a list where the keeper (or
      another merged item) also has one are added into that row when the
      units convert (`planListRowMerges`; prices add up), otherwise both
      stay;
    - `RecipeIngredient`, `ShoppingListItem`, `ShoppingListTemplateItem`,
      `PriceHistory` and `ItemAlias` rows are re-pointed to the keeper, and
      each merged name (normalized, unless it equals the keeper's) is
      upserted as an alias of the keeper;
    - the barcode is cleared on the merged items first
      (`@@unique([householdId, barcode])`) and given to the keeper only if
      it has none;
    - threshold, `lastKnownPrice`, category and expiry are the keeper's,
      except that an empty one takes a merged item's (the earliest expiry
      of a merged item that has stock);
    - the merged items' `Notification`s are deleted, then the items
      (their own conversions and dismissals cascade).
  - **Expiry/best-before tracking**: an optional `expiresAt` (`DateTime?`),
    set from a native date input on the single-item add/edit form
    (`ItemFormDialog`), or estimated automatically (AUTO-7, below) — never
    typed on any bulk-add flow (scan queue, paste-list, starter kit), since
    those are rapid multi-item entry paths with no natural single date to
    apply. `getExpiryStatus` (`src/lib/inventory/expiry.ts`, pure and
    unit-tested, mirroring `getStockStatus`'s split for the same Server/
    Client Component reason) classifies an item as `"soon"` (within
    `EXPIRY_WARNING_DAYS`, currently 3) or `"expired"` (past the date);
    `ExpiryBadge` renders that next to the existing stock-status badge in
    the inventory table/cards, hidden entirely when no expiry is set or
    it's further out than the window. Also feeds a third notification
    trigger — see "Notification center" below.
    - **Estimated expiry from default shelf life (AUTO-7)**: almost no
      items ever got a real `expiresAt`, since the date picker only exists
      on the single-item form and nobody fills it in on every add. Instead,
      when stock *arrives* — a shopping-list item put away
      (`putAwayItemsAction`, or the tick itself in an `ON_CHECK` household:
      `togglePurchasedAction` and the share-link toggle; see "Put away"
      below), a receipt scan applied in `ON_CHECK` mode or a receipt
      registered (`applyReceiptScanAction`/`registerReceiptAction`), or a
      batch landing via the scan queue/paste-list
      (`bulkCreateInventoryItemsAction`) — an item with a known shelf life
      gets an *estimated* `expiresAt`, flagged by `expiresAtEstimated`
      (`Boolean @default(false)`). `InventoryItem.shelfLifeDays` (`Int?`)
      is `null` to use the category default, a positive number as a
      per-item override, or `-1` (Grocy's convention) to permanently opt
      the item out — the item form's "doesn't expire" checkbox sets that.
      A best-before date typed into the put-away dialog is real, not an
      estimate: it's stored with `expiresAtEstimated: false` in place of
      the estimate.
      The pure resolver (`src/lib/inventory/shelf-life.ts`, unit-tested)
      maps a category label (either locale's `inventory.autoCategories`
      text, same source as AUTO-2's dictionary) to a default: dairy 7 days,
      bakery 4, meat 3, produce 5; frozen/pantry/drinks/cleaning/bathroom
      have none, since those categories span too wide a range of real
      shelf lives to guess responsibly. `estimatedExpiryUpdate` is the
      single gate every arrival path calls through: it only (re)writes an
      estimate when stock crosses from 0 into positive, or the item has no
      `expiresAt` at all yet, and — Guardrails' "corrections stick" —
      **never overwrites a real, user-entered date** (`expiresAtEstimated:
      false`). Per "editing the date in the item form makes it real,"
      `updateInventoryItemAction` only flips `expiresAtEstimated` back to
      `false` when the submitted date actually differs from what's stored
      — compared at day granularity (`sameCalendarDay`), since the date
      input always round-trips a `YYYY-MM-DD` value even when the estimate
      it's showing carries a different time of day. Saving an unrelated
      field (renaming the item, a quantity edit) leaves an existing
      estimate exactly as it was; clearing the date also clears the
      estimate flag. `ExpiryBadge` shows an estimate with a "≈" prefix and a softer
      (`outline`) style than a real date's `destructive`/`attention`
      badge. The `EXPIRING_SOON` notification includes estimated dates too
      (a guess is still worth a heads-up) with softened "probably" wording
      (`ExpiringSoonNotification.estimated`, `dict.notifications.expiringSoonEstimated`)
      rather than excluding them. This supersedes the paragraph above's
      "never... by any bulk-add flow" rule for *estimated* dates only — a
      bulk-add flow still never lets a user type one in directly.
    - **"Mark opened" shelf-life reset (GAP-28)**: Grocy-style separate
      "use within N days once opened" clock (milk keeps ~14 days sealed but
      ~3 once opened). `InventoryItem.useWithinDaysOpened` (`Int?`, an
      optional positive whole number on the item form, saved as null for a
      "doesn't expire" item) and `openedAt` (`DateTime?`). The inventory row
      shows a "Mark opened" button only when `useWithinDaysOpened` is set and
      the item isn't already opened — hidden, not disabled, since it would
      otherwise be a no-op on almost every row. `markItemOpenedAction`
      (household-scoped like every inventory action, and refusing an
      already-opened item so a double tap can't restart the clock) sets
      `openedAt = now` and `expiresAt = min(existing expiresAt, now +
      useWithinDaysOpened days)` via the pure `openedExpiryUpdate`
      (`src/lib/inventory/expiry.ts`, unit-tested) — opening can only pull a
      deadline closer, never push a printed date out; no existing date means
      the opened date is used. **`expiresAtEstimated`**: an earlier existing
      date wins untouched, flag included; when the opened date wins it's
      flagged as an estimate, since "use within N days" is a rule of thumb
      about the product rather than a date printed on this pack (so it gets
      the softer "≈"/"probably" treatment in ExpiryBadge, `EXPIRING_SOON` and
      the expired-waste recap) and so AUTO-7's arrival gate can replace it
      with a fresh estimate when the next, sealed pack arrives, instead of
      it being pinned as a "real" date the estimator must never touch.
      Guardrails' "undo over confirm": applied immediately with a toast
      whose Undo calls `undoMarkItemOpenedAction(itemId, markedOpenedAt,
      previous)`, restoring the previous `openedAt`/`expiresAt`/
      `expiresAtEstimated` — and only while the item still carries the
      `openedAt` that click wrote, so a stale Undo after a restock is a
      no-op. `ExpiryBadge` shows an outline "Opened" tag next to the
      expiry badge whenever `openedAt` is set, even outside the warning
      window. **Restock**: the same AUTO-7 shopping arrival paths (put-away
      or an `ON_CHECK` tick, both through `applyStockArrival` in
      `src/lib/shopping/put-away.ts`; `applyReceiptScanAction`;
      `registerReceiptAction`) merge in `openedResetOnArrival` before the
      estimator's patch — a 0 → positive crossing is a fresh, sealed pack,
      so `openedAt` clears, and an estimated `expiresAt` (which includes
      every winning opened date) clears with it unless the estimator
      writes a new one; a real typed-in date is left alone. Topping up
      while stock remains keeps the item opened (the open pack is still the
      one to use first). The +/- buttons and the form's quantity field
      don't reset it, matching AUTO-7's choice of which events count as
      "stock arrived". Clearing `useWithinDaysOpened` in the form leaves an
      existing `openedAt` alone. One `openedAt` per row: with several packs
      counted on one item, opening one moves the whole row's date — the
      same one-`expiresAt`-per-item simplification as everywhere else.
    - **"Freeze it" (GAP-44)**: the opened clock's mirror image for the
      most common way to avoid waste. `InventoryItem.frozenAt` (`DateTime?`)
      and `useWithinDaysFrozen` (`Int?`, no form field yet: null means the
      default `DEFAULT_USE_WITHIN_DAYS_FROZEN` = 90 days). An inventory row
      shows a "Freeze" button (snowflake icon on desktop, a menu item in the
      phone row's ⋯ menu) only when the item has an `expiresAt` and isn't
      frozen. `freezeItemAction` (household-scoped, refusing an
      already-frozen or date-less item) sets `frozenAt = now` and
      `expiresAt = now + useWithinDaysFrozen` via the pure
      `frozenExpiryUpdate` (`src/lib/inventory/expiry.ts`, unit-tested).
      Unlike the opened rule it *replaces* the date even when that moves it
      later, since extending the clock is the point, and always flags
      `expiresAtEstimated` ("≈", softer copy). Because the date jumps months
      out, the item drops out of `EXPIRING_SOON` and the weekly digest.
      Same Undo toast as "Mark opened" (`undoFreezeItemAction(itemId,
      markedFrozenAt, previous)`, a no-op once the item has moved on).
      `ExpiryBadge` shows an outline "Frozen" tag whenever `frozenAt` is
      set. **Restock**: `frozenResetOnArrival` sits beside
      `openedResetOnArrival` in the same arrival paths (`applyStockArrival`,
      `registerReceiptAction`): a 0 → positive crossing clears `frozenAt`
      and the estimated `expiresAt`. There's no "thaw" button; use Undo, or
      edit the date. **Phone card badges**: the card's header row wraps, the
      name keeps a 40% floor and the badge cluster may shrink and wrap, so at
      200% text (stock + "Opened"/"Frozen" + "≈ Expiring soon") the badges
      drop under the name instead of squeezing it to nothing; guarded in
      `e2e/freeze-item.spec.ts` (en and sv).
  - **Remembered barcode (AUTO-6)**: an optional `barcode`, unique per
    household, set by linking a scanned code to the item — see "Remembered
    barcodes and Scan mode" under "Barcode scanning" below.
  - **Quick-add row (UX-1)**: the empty inventory's `QuickAddBar` (name,
    quantity, unit, category) gives the unit `ComboField` a `w-32` column
    (128px), because the field also holds its clear (×) and chevron
    buttons and the old `w-20` left the input a few pixels, so the default
    "pcs" showed as a single letter. `e2e/quick-add-unit.spec.ts` guards it
    at 390px in `en` and `sv` (its own empty household, since the seeded
    one has items).
  - **Quick-add Enter (UX-132)**: in that row Enter moves focus to the
    next field (name, quantity, unit, category) and only Enter in the
    category field adds the item, so a half-filled row is never submitted;
    the "+" button adds from any field. `e2e/quick-add-unit.spec.ts`
    covers it.
  - **Auto-categorization (AUTO-2)**: a new item created without a
    category is filed under a guessed one instead of `"Uncategorized"`, so
    things added from a list, receipt, paste or quick-add arrive already
    sorted and `ResolveMappingsDialog` rarely has sorting work to do. This
    covers the add form and quick-add bar (blank category), the scan-queue/
    paste/AI-shelf-scan bulk add (no shared category), and every
    shopping-list create path (the smart add line, receipt "add as new
    item", the mapping dialog's single and batch "create new",
    `registerReceiptAction`). The
    pure resolver (`src/lib/inventory/auto-category.ts`, unit-tested) runs
    cheapest-first and needs no AI key: (1) **household memory**: an
    existing item with the same or a confidently similar name (score ≥ 0.8
    via `findInventoryMatches`, so "Mjölk 3%" follows "Mjölk") lends its
    category, skipping items still in any locale's "Uncategorized". This is
    also how a correction sticks: once the user moves an item, later adds
    of that name follow it and the dictionary is never consulted. (2) A
    **built-in bilingual keyword table** maps to nine canonical keys
    (produce, bakery, dairy, meat, pantry, frozen, drinks, cleaning,
    bathroom). It matches the head noun (last word first, since both
    languages put it last), Swedish compounds by suffix ("kycklingfilé",
    "vispgrädde"), English/Swedish plurals, multi-word phrases before single
    words ("peanut butter", "dish soap") and a "frozen"/"fryst" modifier.
    Keys are labelled in the user's locale via `inventory.autoCategories`.
    The pantry/cleaning/bathroom labels deliberately equal the starter
    kits' names (test-enforced), so kit items and auto-filed ones share
    groups. The server half (`createCategoryResolver`,
    `src/lib/inventory/category-resolver.ts`) loads the household's items
    lazily, once per request, and bulk add reuses its own dedupe query.
    Only a *blank* category is ever filled in: a typed or shared category
    always wins, and clearing a category on the edit form is respected, not
    re-guessed. Separately, a barcode lookup (`lookupBarcodeAction`,
    `src/lib/barcode.ts`) maps Open Food Facts' own `categories_tags`
    through the same dictionary (`categoryKeyFromOpenFoodFactsTags`) before
    the resolver is ever consulted — that per-item suggestion, when present,
    wins over a guess the same way a typed category does.
    **(3) AI fallback (AUTO-2b(a), optional)**: only reached once *both*
    of the above miss, and only when a Gemini/Anthropic key is configured
    (`src/lib/inventory/ai-category-fallback.ts`, same env vars and
    provider order as AI shelf scan's `resolveAttempts` — see "AI shelf
    scan" below). The item is committed as `"Uncategorized"` immediately,
    exactly as it would be with no key configured, so this never blocks or
    slows down the add; `scheduleAiCategoryFallback`
    (`src/lib/inventory/category-resolver.ts`) then schedules, via Next's
    `after()`, one small classification call batching every item in the
    request that missed (never one call per item) — only the bare item
    *names*, never quantities, prices or any other household data — and
    patches each resolved name's category afterward. The model is
    constrained to `AUTO_CATEGORY_KEYS`; anything else it answers (a
    hallucinated category, or its own "unknown" when it doesn't know
    either) is clamped away and the item simply stays `"Uncategorized"`,
    same as any other failure (no key, rate-limited, provider error,
    timeout) — none of which ever surfaces to the user. The Anthropic call
    uses `claude-haiku-4-5` (hardcoded, not the scans' vision model — a
    fixed-choice text classification doesn't need a bigger one); Gemini
    uses `GEMINI_MODEL` like the scans. Rate-limited per
    household (`ai-category-fallback:{householdId}`, same 20/hour budget as
    AI shelf scan/AI receipt scan). The patch only touches a row still
    sitting in a placeholder "Uncategorized" category, so a correction made
    in the meantime is never clobbered. Disclosed in the add-item dialog's
    existing category hint (`categoryHintAi`), shown only when a key is
    actually configured, and on the privacy page's "Third parties" section
    (alongside AI shelf/receipt scan). Covers every InventoryItem create
    path: inventory, shopping list, and a recipe's "Create new" ingredient
    rows (below). The `revalidatePath` inside `after()` runs after the response
    is sent, so the adding user sees the patched category on their next
    navigation or refresh, not instantly.
    **Recipe ingredients** (`resolveIngredientDecisions` in
    `recipe-actions.ts`, MATCH-1): a "Create new" row whose category was
    left blank runs through `createCategoryResolver` (seeded with the
    inventory the action already loaded, so a batch costs no extra query),
    falling back to `"Uncategorized"` (plus the AI fallback above, when
    configured) only when neither step recognizes the name. A category the
    user typed in the review is never second-guessed.
    **Correcting a guess in place (AUTO-2b)**: every editable, linked
    shopping-list row in the flat Purchased section shows (UX-22: rows
    under their category's group header don't, since the chip would repeat
    the header) its `InventoryItem`'s category as a small chip
    (`CategoryChip`, `src/components/shopping/category-chip.tsx`, outside
    the row's `<label>` so tapping it doesn't toggle purchased). Tapping it
    opens a menu of the household's existing categories plus "New
    category…" — a one-field dialog rather than an input inside the menu,
    whose typeahead would swallow keystrokes. The change applies at once
    with an "Undo" on the toast, no confirm step, and the row moves to its
    new shopping-mode group. It goes through
    `setShoppingListItemCategoryAction`, which writes the linked
    `InventoryItem` (a list row has no category of its own),
    household-scoped; blank clears to the locale's "Uncategorized". Because
    the resolver's household-memory tier reads that same item, the
    correction sticks for every later add of the name — it's never
    re-guessed. Unlinked rows show no chip (the mapping flow picks a
    category), and read-only lists don't need one (the group header already
    shows it).
- `ShoppingList` / `ShoppingListItem` — a household can have any number of
  shopping lists at once (e.g. a weekly list and a separate big-trip list);
  there's no longer a "one active list" constraint. At most one `ACTIVE`
  list per household is flagged `isDefault` — the always-on "Next shop"
  list low-stock items fill themselves into (see "Always-on default list
  (AUTO-8)" below). Each list has a status:
  `ACTIVE` → `COMPLETED` (via `completeShoppingListAction`; one-way apart
  from the short-lived toast "Undo" below — undoing the completion of the
  default list reopens it as an ordinary list, since completing it already
  handed the default role to a fresh "Next shop") or
  `ACTIVE`/`COMPLETED` → `ARCHIVED` (via `archiveShoppingListAction`,
  reversible with `unarchiveShoppingListAction`, which always returns to
  `ACTIVE`). Any list can be permanently removed with
  `deleteShoppingListAction` (cascades its items; open to any household
  member, not owner-gated — see "Roles" above for what *is* owner-gated).
  `/dashboard/shopping-list` (`ShoppingListsOverview`) lists every list
  grouped into Active/Completed/Archived sections with a "New list" dialog;
  `/dashboard/shopping-list/[id]` (`ShoppingListClient`) is the detail view
  for one list — item add/toggle/delete and the "Add low-stock items" /
  "Complete list" actions are only available while that list is `ACTIVE`
  (both client-side, hiding the controls, and server-side, the actions
  no-op/error on a non-`ACTIVE` list). **Every shopping list item maps 1:1 to
  an `InventoryItem`**: adding an ad-hoc item (`addAdHocItemAction`)
  immediately finds-or-creates a matching `InventoryItem` (case-insensitive
  name match within the household; created with category `"Uncategorized"`,
  quantity 0) and links it — there is no such thing as an unlinked shopping
  list item going forward. `completeShoppingListAction` re-runs that
  find-or-create for any item that still lacks a link, as a defensive
  guarantee at the point the user considers the list "done". A purchase
  **increments** the linked inventory item's quantity by the purchased
  amount (and records a `PriceHistory` row if an estimated price was
  given) — but *when* depends on the household's `inventorySyncMode` (see
  "Put away" below): at the tick itself in `ON_CHECK` mode, or when the
  row is put away in `ON_PUT_AWAY` mode, where a tick only means "in the
  cart". Un-ticking a row whose stock was already counted (`putAwayAt`
  set) reverses the increment; un-ticking one that was never put away has
  nothing to reverse. The dashboard overview card sums pending items across
  every `ACTIVE` list, not just one.
- **Shopping mode (AUTO-3)** — the detail page groups pending items by their
  linked `InventoryItem`'s category instead of insertion order, so a shop
  doesn't mean zig-zagging the store. `groupPendingItemsByCategory`
  (`src/lib/shopping/shopping-mode-grouping.ts`, unit-tested) sorts groups
  produce → bakery → dairy → meat → pantry → frozen → drinks → cleaning →
  bathroom — `AUTO_CATEGORY_KEYS`' own order (auto-category.ts) — matching a
  category stored in either locale to the same group (a household that
  auto-filed some items in English and some in Swedish still gets one
  "Dairy & eggs" group, not two), labelled in the viewer's language (UX-83:
  `groupPendingItemsByCategory`'s `locale` argument, so a Swedish session
  reads "Frukt & grönt" in the headers and the Next up dock even when the
  category was stored in English). A household's own custom category text
  sorts after the known ones, alphabetically; items with no linked item, a
  blank category, or still sitting in the "Uncategorized" placeholder
  collect under "Other" at the end. Only categories actually present get a
  header. That fixed order is only the starting point: AUTO-9 (below)
  replaces it with the household's own store order. Purchased items are
  unaffected — they still collapse into the flat "Purchased" section below.
  While the list is `ACTIVE`, rows get a larger touch target (more
  vertical padding, a bigger checkbox) and the whole row — not just the
  checkbox — toggles purchased, via the row's existing `<label>`/`<input>`
  pairing rather than a new click handler, so keyboard and screen-reader
  behavior is unchanged. `useScreenWakeLock`
  (`src/lib/shopping/use-screen-wake-lock.ts`) also requests a Screen Wake
  Lock while the list is `ACTIVE` and the tab is visible, so a phone's
  screen doesn't dim mid-shop; it feature-detects `navigator.wakeLock` and
  silently does nothing if it's unsupported or the request fails — no
  permission prompt, and nothing stored in the browser.
  - *A tool, not a list (UX-37)* — on an `ACTIVE` list:
    - *Large type, full-row targets*: unticked rows set the name at 16 px
      (18 px on phones and touch screens) with a bigger checkbox and a 56 px
      minimum height. The row's `<label>` reaches the whole row through an
      absolutely positioned `::after` (the row is `relative`), so a tap on
      its padding, note or hint ticks it, still through the native
      label/input pairing; the controls column (price, edit, delete) sits
      above it at `z-10`.
    - *One line per row on a phone (UX-79)*: an unticked row whose
      controls are only price and ⋯ (no category chip, not unlinked) keeps
      them on the name's line, 56 px tall instead of 118, so 6+ whole rows
      of a 15-item list fit between the sticky add bar and the dock at
      412×839. With no price set, "Add price" isn't on the row; the ⋯
      menu carries it (Edit, Add price, Delete) and opens the same inline
      editor. Once there is a price, the ≈ price button stays on the row.
      Rows with a chip or the "Match item" badge keep the stacked second
      line.
    - *Ticks move*: the optimistic tick state (UX-14) is lifted from each
      row into `ShoppingListClient`, because a ticked row now changes
      section. It's plain state, not `useOptimistic`: React 19 entangles
      concurrent async transitions, so an optimistic tick only rolled back
      once every tick in flight had settled. `src/lib/shopping/tick-overlay.ts`
      (unit-tested) keeps, per row, what it should show and how many toggles
      are in flight; each tick settles on its own, so a failed save puts
      its row back at once (with the save-failed toast) while other saves
      are still pending. A saved tick goes at once if the current list
      already shows it, and otherwise holds until the next server list,
      which wins even where it disagrees (another member unticked the
      row), so no row is stuck showing the overlay. "Put things away"/"Done shopping" wait while any toggle is in
      flight. It stays in
      its aisle for 250 ms (UX-54 shortened it from 350 so the drop still ends inside the 500 ms CLS grace after the tick moment's 200 ms) animating down and out (that fading copy is
      `inert` and `aria-hidden`, so the item is exposed once, as the "In
      the cart" row the overlay already lists), then joins **"In the
      cart"**, a collapsed section (a disclosure button with a count that
      pops on each arrival; the rows stay mounted under `hidden`). A
      completed or archived list keeps the always-open "Purchased" section.
      Under `prefers-reduced-motion` the row moves at once.
    - *Next up dock* (`src/components/shopping/shopping-mode.tsx`): the
      progress ring ("12 of 18", a real `progressbar` with that
      valuetext), the aisle the shopper is in now (the first pending group,
      `nextUp()` in `src/lib/shopping/shopping-progress.ts`, unit-tested)
      and its next three items as 48 px full-width tap rows. Ticking one is
      the same optimistic tick; when an aisle is done the next aisle's items
      move in, so a whole trip can be ticked off from the dock. Phones pin
      it above the BottomNav (`fixed`, with a spacer the dock's measured
      height at the end of the list so the last rows can scroll clear of
      it, and its height plus its gap on `main` as `--shopping-dock`, which
      every row's swipe wrapper (`SwipeRow`, UX-35) uses as its phone
      `scroll-margin-bottom`, so a row just added from the smart-add box
      scrolls into view above the dock rather than behind it. The wrapper,
      not the row inside it, is what scrolls into view: its
      `overflow-hidden` makes it a scroll container, and Chrome clips an
      inner target's scroll-margin to it); from `sm` it's sticky at the bottom of the column; a short
      (landscape) screen shows one item. "+N more in this aisle" sits on the
      "Next up" caption line, never in a footer of its own: the dock is
      pinned by its bottom edge, so a footer appearing when the server
      confirms a just-added fourth row would shift the dock up a line, late
      (MAINT-18; `e2e/motion.spec.ts` guards it). Every item it offers is also in the
      list with its own checkbox (M7). A tick is still instant, but the
      ticked row stays in the dock for 450 ms as a filled check while every
      dock row is disabled, so the second tap of a double tap can't land on
      the item that slides up under the finger (UX-78; the slot count is
      held so the dock doesn't change height).
    - *All done*: the cleared state shows the full ring with a tick and pops
      in (motion-safe). When ticked rows still wait to be put away it says
      how many and its primary action is "Put things away", which opens the
      put-away dialog in finish mode; otherwise it's "Done shopping" as
      before. Both wait for in-flight ticks to save. On the tick that clears
      an active list, the squirrel mark rises into the full ring in place
      of the tick (UX-38, see "Mascot empty states").
    - Covered by `e2e/shopping-mode.spec.ts` (a whole shop from the dock in
      the bottom half of a phone screen with no scrolling, a double tap ticking only one item, the collapsed
      cart and full-row tap, the put-away offer, a new row landing above
      the dock, a failed tick rolling back while a slower one is still
      saving).
  - *Bundle size (PERF-6)*: matching a category label in either locale
    (above) used to mean `shopping-mode-grouping.ts` imported the full
    `en`/`sv` dictionaries, which — since that module is reachable from the
    client `shopping-list-client.tsx` — put both complete dictionaries
    (~68 KB gz) into every `/dashboard/shopping-list/[id]` page load. The
    `uncategorized`/`autoCategories` labels now live in
    `src/lib/inventory/category-labels.ts`, a tiny dependency-free module
    that `en.ts`/`sv.ts` still re-export (so translators keep finding them
    under `inventory.*`) but that `shopping-mode-grouping.ts` imports
    directly instead of the whole dictionaries.
- **Learned store order (AUTO-9)** — shopping mode's groups gradually
  reorder to match the order this household actually ticks things off in,
  with no setup. Pure logic lives in `src/lib/shopping/store-order.ts`
  (unit-tested); `groupPendingItemsByCategory` takes the order as an
  optional third argument and, without one, is exactly AUTO-3's fixed order.
  - *Category keys*: a category is learned under `categoryKey()`
    (shopping-mode-grouping.ts): `auto:<key>` for any `AUTO_CATEGORY_KEYS`
    label in either locale (so "Dairy & eggs" and "Mejeri & ägg" learn as
    one), otherwise the custom category's trimmed, lower-cased text.
    "Other" has no key, is never learned and always sorts last.
  - *Recording*: `togglePurchasedAction` and the share-link toggle set
    `ShoppingListItem.checkedOffAt` in the same row write that flips
    `purchased`, and clear it on un-tick, so a mistaken tick leaves no
    stale step and a re-tick records when the item was really picked up.
    Receipt apply deliberately doesn't set it (a whole receipt lands at
    one instant and says nothing about aisle order). Nothing else is
    stored per trip.
  - *Learning*: `completeShoppingListAction` sorts the list's timestamped
    rows by `checkedOffAt`, gives each the midpoint of its slot on a 0..1
    entrance→checkout scale, averages per category, and moves each
    observed category `LEARNING_RATE` (0.3) of the way toward that rank —
    an exponential moving average. Categories the trip didn't touch keep
    their position; a trip that touched fewer than two categories teaches
    nothing and writes nothing. Before anything is learned a known
    category sits at its `AUTO_CATEGORY_KEYS` slot midpoint and a custom
    one at 1 (after them, alphabetically). The write is best-effort: a
    failure is logged and never fails "Done shopping".
  - *Manual order*: "Reorder sections" in the `⋯` menu (active lists with
    at least two non-"Other" sections) opens `ReorderSectionsDialog`,
    up/down buttons rather than drag and drop (no new dependency, works
    the same by thumb and keyboard). `saveCategoryOrderAction` merges the
    list's sections into the household's whole current order
    (`applySubsetReorder`: they're poured back into the slots they already
    held, so sections this list lacks don't move). A manual order always
    beats the learned one; a category it doesn't mention sorts after every
    arranged one. "Use learned order" (shown only while a manual order
    exists) calls `resetCategoryOrderAction`, whose toast offers Undo.
    Learning keeps running underneath, so a reset lands on an up-to-date
    learned order.
  - *Storage*: two columns on `Household` — `categoryOrderLearned Json?`
    (`{ [categoryKey]: position }`) and `categoryOrderManual String[]`
    (empty = none) — rather than a `HouseholdCategoryOrder` table. The
    learned map is always read and rewritten whole, once per completed
    list, so rows would only add N upserts; a separate manual column means
    a completion can't clobber a hand-saved order, and reset is emptying
    an array. `requireHousehold()` already loads the row, so reading it
    costs no extra query. Household-wide, never per member; per-store
    orders are a non-goal (`PriceHistory.store` is too sparse to key off).
    Migration: `store_order_learning`.
- **"You usually buy this about now" (AUTO-10)** — inventory counts drift
  (nobody updates them after every breakfast), so low-stock detection alone
  misses things. An ACTIVE list's detail page also shows up to five
  dismissible chips under the smart add line, one per item the household
  buys on a rhythm and is due to buy again ("Coffee · usually every 12
  days"). Tapping a chip adds the item to that list; nothing is ever added
  by itself, and nothing reaches the bell or a push notification (the
  Guardrails' "suggest, don't silently mutate").
  - *Purchase dates, derived rather than stored*: a purchase is a
    `purchased` `ShoppingListItem` linked to an inventory item, dated by
    `purchaseTimestamp()` — its AUTO-9 `checkedOffAt` when it was ticked by
    hand, otherwise its list's `completedAt`. The fallback covers exactly
    the rows `checkedOffAt` deliberately leaves blank (AUTO-9's semantics
    are unchanged): receipt apply marks lines purchased without a tick and
    the list's "Done shopping" is when that trip happened, and "Register
    receipt" creates its list already completed at the moment of purchase.
    A separate `purchasedAt` column was rejected because it would only
    ever hold one of those two values again, would need writing on every
    purchase path, and would start empty — deriving means every list
    completed before AUTO-10 shipped already counts as history. The one
    gap is a receipt-applied row on a list that's still ACTIVE: it has no
    date until the list is completed, so until then its item is treated as
    already on a list (below) rather than looking overdue.
  - *Calc*: `src/lib/inventory/repurchase-calc.ts` (pure, unit-tested).
    Purchases on the same calendar day (UTC — there's no stored household
    time zone) collapse into one, so two lines of the same thing in one
    shop aren't a 0-day interval. At least three purchase days are needed
    before anything is suggested. The rhythm is the **median** gap in
    whole days between purchase days (one forgotten fortnight doesn't
    skew a weekly habit). An item is due when `now − lastPurchase ≥ 0.85 ×
    median`, so it's on the list a little before the last pack runs out.
    It's never suggested while it's pending on any ACTIVE list (or ticked
    there by a receipt but not yet dated), nor while snoozed. Most overdue
    relative to the item's own rhythm comes first, capped at five. Only
    the last 365 days of history are loaded
    (`src/lib/inventory/repurchase-suggestions.ts`, two queries per page
    view, only for ACTIVE lists).
  - *Adding* (`addRepurchaseSuggestionAction`,
    `src/app/dashboard/shopping-list/repurchase-actions.ts`): adds the
    item to the list being viewed with last time's quantity and unit (1 of
    the item's unit without one) and the AUTO-4 last-known-price default,
    not flagged `addedAutomatically`. A no-op if it's already pending on
    that list.
  - *Dismissing* snoozes the item for one usual interval from the moment
    of dismissal ("ask me next cycle"): `InventoryItem.repurchaseSnoozedUntil`
    (`DateTime?`, null = never dismissed, a past value = expired). Stored
    server-side so a dismissal holds on every member's device, and
    household-scoped through the item — nothing is kept in the browser.
    The rhythm is recomputed on the server, never taken from the client.
    The toast's Undo clears the snooze. A purchase meanwhile moves the due
    date on by itself; an item still unbought when the snooze ends comes
    straight back. Migration: `repurchase_snooze`.
- **Per-item notes (GAP-5)** — `ShoppingListItem.note` (`String?`,
  migration `20260925124224_shopping_item_note`) holds an optional
  free-text hint for whoever does the shopping ("get the ripe ones", "any
  brand is fine"). It's set from the row's edit dialog
  (`ShoppingItemFormDialog`'s edit mode, a "Note (optional)" textarea) and
  never at add time: the "+" quick-add, the smart add line, imports and
  every automatic path leave it null, so adding stays a fast
  type-and-enter. `updateShoppingListItemAction` takes an optional `note`
  (trimmed, max 200 characters via Zod). Leaving it out keeps the existing
  note, and a blank note clears it to `null`, never `""`. Like every item
  action, the lookup is household-scoped. When set, the note shows as a
  muted second line under the item name, wrapped rather than truncated,
  outside the row's `<label>` so tapping it doesn't toggle purchased. It
  also shows on the public share page (`getShoppingListByShareToken` returns
  it, since the person the list is shared with is often the one shopping)
  and is the last column of the list's CSV export (see "Data export (CSV)").
- **Always-on default list (AUTO-8)** — every household has one
  `ACTIVE` list flagged `ShoppingList.isDefault`, named "Next shop" /
  "Att handla" in the locale of whoever caused it to exist, and restocking
  no longer depends on anyone remembering to press "Add low-stock items".
  - **Lazy, always one.** `getOrCreateDefaultShoppingList`
    (`src/lib/shopping/default-list.ts`) returns the active default or
    creates it on first need (an auto-add, a mark-empty, or a completion) —
    a household that never runs low never gets an empty list it didn't ask
    for. "At most one active default" is enforced in the actions and backed
    by a partial unique index written by hand in the migration
    (`ShoppingList_one_active_default_per_household`, `WHERE "isDefault" AND
    status = 'ACTIVE'`); the create is `INSERT … ON CONFLICT DO NOTHING`
    (`createMany({ skipDuplicates })`) plus a re-read, so two members
    triggering the first add at once converge on one list, and it works
    inside an interactive transaction. `completeShoppingListAction` on the
    default list clears its `isDefault` and immediately creates a fresh,
    empty default in the same transaction, so there's always one to fill.
    `archiveShoppingListAction` also clears `isDefault` (un-archive always
    returns a list to `ACTIVE`, and an old default must never come back
    beside the current one); deleting the default is allowed — the next
    need recreates it. The overview lists the default first among Active
    lists with a "Fills itself" badge. Other named lists (the big monthly
    trip) behave exactly as before.
  - **Auto-add on the crossing into low stock.**
    `addToDefaultListOnLowStock(db, householdId, itemId, prev, next)`, the
    sibling of `recordOutOfStockTransition`, is called from exactly the same
    call sites (see "Notification center" → Out of stock:
    `adjustQuantityAction`, `markItemEmptyAction`,
    `updateInventoryItemAction`, `bulkUpdateFieldAction`,
    `bulkSetInventoryQuantitiesAction` (AI shelf scan restock; through the
    batch siblings `recordOutOfStockTransitions` and
    `addToDefaultListOnLowStockBatch`, see below),
    `markMealEntryCookedAction`, and every shopping arrival/reversal via
    `applyStockArrival`/`reverseStockArrival` in
    `src/lib/shopping/put-away.ts`: `togglePurchasedAction`, the share-link
    `toggleItemViaShareTokenAction`, `putAwayItemsAction` and
    `applyReceiptScanAction`) — once per path, in the actions layer,
    never per UI; the in-transaction callers pass their `tx`. It fires only
    when `getStockStatus` goes from `in` to `low`/`out` (judged against the
    item's threshold after the write, so raising a threshold alone never
    adds anything); an item that was already low dropping further is a
    no-op, so the list isn't refilled over a row someone removed on
    purpose. Stock that's ticked off but not yet put away counts as
    covered on both sides of the change (`coveredQuantity`, see "Incoming
    stock" under "Put away" below), so the last carton at home running out
    while two more are in the cart adds nothing. The row is deduped against a pending row for the same item
    exactly like `generateFromLowStockAction`, sized
    `max(1, threshold − quantity)`, carries the item's `lastKnownPrice`
    (AUTO-4) and is flagged `addedAutomatically` (the existing "Low stock"
    badge on the row).
  - **Take stock runs in a fixed number of queries (PERF-15).**
    `bulkSetInventoryQuantitiesAction` (up to 300 updates) writes every
    new quantity in one `UPDATE … FROM unnest(…)` (household-filtered in
    the statement) and judges the whole batch with
    `recordOutOfStockTransitions` (src/lib/notifications.ts) and
    `addToDefaultListOnLowStockBatch` (src/lib/shopping/default-list.ts):
    one read of incoming stock, one of existing alerts/pending rows, one
    `createMany`/`createManyAndReturn`, whatever the batch size. The rules
    are the single-item ones. Differences: several items going out of stock
    in one scan send one "N items are out of stock" push instead of one
    per item, and an itemId repeated in a batch counts once (last
    quantity wins). Unit tests assert the query count does not grow with
    `updates.length`.
  - **Undo, not confirm.** Each of those actions returns
    `autoAdded: AutoAddedItem[]` (the created row ids plus list/item
    names), and `showAutoAddedToast`
    (`src/components/shopping/auto-added-toast.ts`) shows "Added Oat milk
    to "Next shop"" with Undo. Undo calls `undoAutoAddedItemsAction(ids)`,
    which deletes only rows among those ids that are in one of this
    household's lists, still `addedAutomatically` and still unpurchased
    (`deleteMany`, so a double tap is a quiet no-op), and deliberately
    doesn't fire a "list cleared" notification. Mark meal as cooked folds
    its auto-adds into its own existing Undo toast instead of stacking a
    second one (see "Mark meal as cooked" below). The share-link toggle
    auto-adds too, but with no toast: an anonymous visitor has no session
    to undo with.
  - **Mark as empty targets the default list.** `markItemEmptyAction`'s old
    "most recently created `ACTIVE` list" guess is gone. "Mark as empty &
    add to shopping list" puts the item on the default list as an explicit,
    person-added row (not flagged `addedAutomatically`, and regardless of
    the setting below); plain "Mark as empty" behaves like any other
    decrease and auto-adds (with Undo) when the item was in stock.
  - **Bulk-edit bar stays on screen on phones (UX-123).** Below `sm` the
    bar is a full-width toolbar `fixed` to the top of the bottom bar, two
    rows high: the count, "Select all" (hidden once everything is ticked),
    an icon-only cart for "Add to shopping list" and an ✕ for "Clear
    selection" (both keep their labels as accessible names), then the
    field select, the value and Apply. While it's up the Add-item button
    is hidden and `<main>` reserves the bar's height instead
    (`globals.css`, `[data-bulk-bar]`), so the last row scrolls out from
    under it. It replaced a `sticky` card that wrapped to three rows and
    floated mid-list above the Add-item button. From `sm` it's one
    wrapping row above the table with "Clear selection" last. There is
    still no bulk delete.
  - **Add to shopping list keeps the stock (UX-122).** The inventory row
    (a cart button on desktop, a menu entry on phones) and the bulk bar
    offer "Add to shopping list" (`addInventoryItemsToShoppingListAction`):
    the same explicit, person-added row on the default list as above,
    deduped against a row already pending there, with the stock untouched.
    The toast says how many were added, or that they were already on the
    list. A row with an unpurchased line on any active list shows an "On
    list" tag. With auto-add on, the row menu drops "Mark as empty & add to
    shopping list" (plain "Mark as empty" already does it); with it off,
    both entries show.
  - **Household setting.** `Household.autoAddLowStockToList` (default on)
    is a checkbox under "Shopping" on the Household page
    (`AutoAddSetting`, `setAutoAddLowStockToListAction` in
    `src/lib/actions/household.ts`). Not owner-gated — see "Roles". Off
    means no crossing ever adds anything; "Add low-stock items" and "Mark
    as empty & add" still work by hand.
- **Put away: "in the cart", then "in the cupboard"** — people tick items
  off in the store, so a tick that updated inventory straight away claimed
  stock that was still in the trolley (and made the pantry look full while
  the bags sat in the car). A purchase is now two steps, and a household
  chooses when inventory moves.
  - *Household setting*: `Household.inventorySyncMode` (`InventorySyncMode`
    enum): `ON_CHECK` (the tick is the arrival, the original behaviour) or
    `ON_PUT_AWAY` (the tick means "in the cart"; stock moves when the row
    is put away). Migration `shopping_put_away` gave every existing
    household `ON_CHECK`, so nobody's habit changed under them, and made
    `ON_PUT_AWAY` the column default for households created afterwards.
    "Updating inventory" on the Household page (`InventorySyncSetting`, a
    select that saves on change) calls `setInventorySyncModeAction` in
    `src/lib/actions/household.ts` — owner-only like the currency, since it
    changes what every member's tick does to shared stock; contributors see
    the current value read-only.
  - *Row state*: `ShoppingListItem.putAwayAt` (`DateTime?`) is when the
    row's stock actually landed in inventory. A row that's `purchased`
    with `putAwayAt` null is *awaiting put-away*. `checkedOffByUserId`
    (plain string, like `Transaction.createdByUserId`) records who ticked
    it, for the reminder below (receipt apply fills it with whoever applied
    the receipt for rows nobody ticked). `priceRecordedAt` has exactly one
    meaning: *a `PriceHistory` row was written for this line* — set by an
    `ON_CHECK` tick, a put-away or a receipt only when they really write
    one (so never on an unlinked row), and cleared whenever the purchase is
    undone (un-tick, "Didn't get it"), since a re-tick is a new purchase.
    The put-away step reads it to avoid recording a receipt's price twice.
    The migration backfilled `putAwayAt = COALESCE(checkedOffAt, list
    completedAt, now())` on every already-purchased row, since the old tick
    had already counted those — without it, each would read as incoming
    and a put-away would count it twice. A follow-up migration,
    `put_away_deploy_window_backfill`, re-runs that backfill for `ON_CHECK`
    households' purchased rows with no `putAwayAt` and no
    `checkedOffByUserId` — rows only the previous app version can have
    written, while the deploy was building. It has to be run once more by
    hand after the deploy is live (DEPLOYMENT.md, "Put-away deploy
    window").
  - *The tick* (`togglePurchasedAction`, `toggleItemViaShareTokenAction`):
    always flips `purchased` and sets/clears AUTO-9's `checkedOffAt` exactly
    as before (store-order learning and AUTO-10's purchase dating are
    unchanged). In `ON_PUT_AWAY` mode that's all it does, plus an explicit
    `putAwayAt: null` so a row never enters the cart already looking put
    away. In `ON_CHECK`
    mode it also runs the arrival (below) and stamps `putAwayAt` in the
    same write, so the data model reads the same either way. Un-ticking is
    decided by the *row*, never the mode: a row with `putAwayAt` gives its
    stock back (`reverseStockArrival`: decrement floored at zero, then the
    out-of-stock and AUTO-8 hooks) and clears `putAwayAt`; a row without
    one has nothing to reverse. Either way `priceRecordedAt` is cleared. So a household can switch modes mid-trip
    without double-counting or losing anything. LIST_CLEARED still fires on
    the tick — it's about the list, not the pantry.
  - *The arrival* (`applyStockArrival`, `src/lib/shopping/put-away.ts`) is
    the one place a shopping purchase moves stock in: the increment, AUTO-4's
    `lastKnownPrice` and GAP-9's `PriceHistory` row (when a price is to be
    recorded), GAP-28's opened-reset, AUTO-7's estimate (or a typed date,
    stored as real), an optional location, and the out-of-stock/AUTO-8
    hooks with the caller's `tx`. Before this, the dashboard and share-link
    toggles each carried their own copy; the share-link one never applied
    AUTO-7/GAP-28, and now does in `ON_CHECK` mode like every other path.
  - *Putting away* (`putAwayItemsAction(listId, entries)`, a click action):
    each entry is an item id plus the quantity that actually came home
    (default: the row's), an optional best-before date (`YYYY-MM-DD`), an
    optional location, or `notBought`. Validated with Zod (at most 300
    entries). The list must be this household's and `ACTIVE` or
    `COMPLETED`, and every entry must be a row on that list — one foreign
    id fails the whole call. That pre-read is for tenancy only. In one
    transaction, rows are processed one at a time: each is *claimed* with a
    conditional `updateMany` (`purchased AND putAwayAt IS NULL`) and skipped
    when the claim matches nothing, then re-read (with its inventory item)
    inside the transaction. The row keeps its confirmed quantity (so a
    later un-tick gives back the right amount), and `applyStockArrival`
    runs on the re-read item, recording the price only if `priceRecordedAt`
    is still null — against the row's *listed* quantity, the one the price
    was paid for, so correcting the quantity can't distort the unit price
    or raise a false price jump. "Not bought" is the same claim writing an
    un-tick instead (it goes back on the list, `priceRecordedAt` cleared).
    **What's guaranteed**: a row's stock is counted at most once, however
    many members put away at once, and a row un-ticked meanwhile is
    skipped; the claim holds the row's lock until commit and receipt apply
    claims rows the same way, so a receipt and a put-away can't both record
    one line's price; two rows for one item add up. **Not guaranteed**: the
    inventory item is re-read and then written with an absolute quantity,
    like every stock change in the app, so an unrelated change to the same
    item committing in between (a − tap at that instant) can be
    overwritten. Any subset can be put away; the rest
    stay waiting, and the list isn't completed by this. Once nothing on
    the list is waiting, its undismissed reminder is dismissed.
  - *UI*: a "Put away (N)" button beside "Scan receipt" whenever N rows are
    waiting on a list that isn't archived (completed lists included — the
    end of a trip is when there's unpacking to do), and a "Not put away"
    tag on those rows. It opens `PutAwayDialog`
    (`src/components/shopping/put-away-dialog.tsx`): one row per waiting
    item, pre-filled with the list quantity, each with Put away / Later /
    Didn't get it, and — for linked items — quantity, best-before and
    location (the item's current location as placeholder, blank = leave
    it). "Put away all" confirms. `?putAway=1` on the list URL opens it
    straight away (the reminder links there). The client watches the
    parameter rather than reading it once on mount, so tapping the bell
    while the list is already open works, and closing the dialog strips
    the parameter so the next tap is a change again.
  - *Finishing a trip*: `completeShoppingListAction` never touches
    inventory, including rows still waiting — booking stock nobody
    confirmed at the list's quantities is exactly what this feature exists
    to avoid. Instead "Done shopping" and the ⋯ menu's "Complete list" open
    the dialog in finishing mode whenever rows are waiting: "Put away &
    finish" or "Finish, put away later". Both complete the list in one step
    (UX-80): no second "Complete this list?" sheet follows, even with
    unticked rows (including ones just marked "Didn't get it"). While any
    would be left behind, the sheet carries a "Move N unbought items to
    {list}" checkbox, on by default (see "Carrying unbought items over"
    below). Finishing later doesn't lose
    anything: the rows stay ticked on the completed list, still count as
    incoming, and the button and reminder still find them there.
  - *Incoming stock* (`src/lib/incoming-stock.ts`, pure half unit-tested):
    a ticked, linked, not-put-away row on an `ACTIVE` or `COMPLETED` list
    is stock on its way home. Everything that reacts to a low count treats
    home + incoming as covered: AUTO-8's auto-add, "Add low-stock items"
    (`generateFromLowStockAction`) and the OUT_OF_STOCK alert
    (`recordOutOfStockTransition`) — so milk in the cart isn't re-listed or
    alerted on. The stock badge, status filter and dashboard counts stay on
    the real count (it isn't home yet); the inventory page shows a muted
    "+N on the way" hint beside the badge instead. A row is dated by
    `incomingSince`: its tick, else when a receipt priced it
    (`priceRecordedAt`), else its list's completion. It stops counting
    `INCOMING_MAX_AGE_DAYS` (7) after that, and a row with no date at all
    doesn't count (every path that leaves a row waiting dates it, so the
    safe failure for stray data is to let the low-stock logic act): a trip nobody put away within a week was put
    away without telling the app, and counting it forever would silently
    stop that item from ever being auto-added again. It can still be put
    away from the dialog.
  - *Reminder*: see "Notification center" → Put away your shopping.
- **List templates (GAP-4)** — a household can save any list's items as a
  reusable, named template ("BBQ", "Costco run") and stamp it out as a new
  list later. Deliberately separate from AUTO-8's default list: that one
  fills itself from low stock, while a template never changes on its own.
  - *Schema*: `ShoppingListTemplate` (`householdId`, `name`, `createdAt`;
    `@@unique([householdId, name])`, cascades with the household) and
    `ShoppingListTemplateItem` (`name`, `quantity`, `unit`, `position`, and
    an optional `inventoryItemId` with `onDelete: SetNull`). Prices and notes
    aren't stored: a price goes stale between uses and a note is usually
    about one trip.
  - *Saving*: "Save as template" in the list's `⋯` menu (any status with at
    least one item, since saving a finished trip is the common case) opens
    `SaveTemplateDialog`, prefilled with the list's name.
    `saveAsTemplateAction` snapshots every item, checked off or not,
    through `buildTemplateItems` (`src/lib/shopping/list-templates.ts`),
    which merges duplicate name + unit lines by summing quantities. A name
    already in use (case-insensitively) is refused rather than overwritten.
    The cap is `MAX_TEMPLATE_ITEMS` (300, the same as import/paste) and
    names are 1–120 characters, the same as a list name.
  - *Using*: the overview page lists templates alphabetically under
    "Templates" with an item count. "New list" calls
    `createListFromTemplateAction`, which creates a new `ACTIVE` list named
    after the template (never the default list) with all its items in one
    nested write, then opens it. `resolveTemplateRows` keeps a saved
    inventory link while that item still exists in the household. Any other
    row is re-linked by name through `createInventoryLinker`
    (`src/lib/shopping/inventory-link.ts`), the same exact, then learned
    alias (MATCH-5), then single-fuzzy resolver
    `importShoppingListItemsAction` uses, so a template behaves
    like re-pasting the list and needs no linking logic of its own. Like
    import, it never creates inventory items: an unmatched row stays
    unlinked for "Resolve mappings", and `completeShoppingListAction`'s
    find-or-create still covers it at the end. Estimated prices come from
    the linked item's `lastKnownPrice` (AUTO-4).
  - *Deleting*: undo over confirm. `deleteShoppingListTemplateAction`
    deletes immediately and returns a snapshot. The toast's Undo passes it
    to `restoreShoppingListTemplateAction`, which validates it with Zod
    like any client input and drops any `inventoryItemId` that isn't in the
    caller's household to `null`.
  - *Tenancy*: all four actions (`src/app/dashboard/shopping-list/template-actions.ts`,
    tested in `template-actions.test.ts`) take the household from
    `requireHousehold()` and look up every list or template id scoped to it.
- **Smart add line (AUTO-1)** — the primary way to add to an `ACTIVE`
  list: one always-visible input (`SmartAddBar`,
  `src/components/shopping/smart-add-bar.tsx`) between the header and the
  items, sticky to the top of the scroll area on phones (same treatment as
  the inventory search bar, except that it is fully opaque, field included,
  so rows scrolled under it never show through, UX-82). Typing `2 l mjölk, bröd, 6 ägg` and pressing
  Enter adds three rows; the text goes through the shared
  `parsePastedList` (via `parseSmartAddInput`), and a row with no typed
  unit takes its inventory item's usual unit rather than "pcs". A comma
  inside brackets doesn't split (UX-88): `dishwasher tablets (lemon-free,
  120 st), paper towels` is two rows with the brackets intact (an unclosed
  bracket doesn't count, so a stray `(` can't swallow the line). The input
  clears as soon as it's submitted and keeps focus, so the next item can be
  typed straight away (it's put back if the add fails). Each added row
  highlights for ~2 s and scrolls into view if it was off-screen (the
  dashboard `main` has a matching phone `scroll-padding-bottom` so it isn't
  left behind `BottomNav`); a screen-reader live region announces the
  count. `ShoppingItemFormDialog` stays for editing a row and for the
  advanced add (barcode, explicit link/create).
  - **Autocomplete** for the segment being typed (after the last comma, with
    any count/unit in front parsed off, so `2 l mj` suggests for "mj" and
    keeps the "2 l"). `rankSmartAddSuggestions`
    (`src/lib/shopping/smart-add-suggestions.ts`, unit-tested) matches names
    containing the query (normalized) and orders them: an exact name
    first, then low/out-of-stock items, then previously bought items, then
    the rest of the inventory; within a tier a name that starts with the
    query beats one that only contains it, then the more recently bought,
    then the name. Items already pending on the list aren't suggested.
    Picking one (click, or arrow keys + Enter) commits it immediately,
    linked by id, in its usual unit unless one was typed. The data comes
    from the detail page's existing `inventoryItems` query, extended with
    quantity/threshold (→ `getStockStatus`) and the item's newest purchased
    `ShoppingListItem`. There's no `purchasedAt`, so that row's `createdAt`
    stands in for "last bought".
  - **Commit path**: one batch Server Action,
    `smartAddShoppingListItemsAction(listId, rows)`
    (`src/app/dashboard/shopping-list/actions.ts`), up to 50 rows,
    `ACTIVE` list only. Unlike the paste import, every row ends up linked:
    a picked suggestion's id (ignored unless it's this household's), else
    `matchSmartAddInventoryItem`: an exact normalized name, else the
    household's learned alias for it (MATCH-5, tracked aliases only), else
    the one
    item that is the typed words plus only size/strength tokens (words
    with a digit, so "mjölk" converges on "Mjölk 3%" but "milk" never
    becomes "Milk chocolate"), else a single `findInventoryMatches` hit
    scoring ≥ 0.8. A tie at either fuzzy step creates rather than guesses.
    Otherwise a new `InventoryItem` is created (quantity 0, category from
    AUTO-2's `createCategoryResolver`), shared by any repeat of the same
    name in the batch. The whole-word step runs before the bigram score
    because bigrams can't tell a size suffix from a different word: "Mjöl"
    (flour) scores higher against "mjölk" than "Mjölk 3%" does. Known gap:
    with *only* "Mjölk" in the pantry, "mjöl" still links to it by score.
    The autocomplete (which shows "Mjölk" while typing) and the row's edit
    dialog ("Change" link) are the ways out.
  - **Dedupe** is the same as "Add low-stock items": a row whose item is
    already pending on the list, or earlier in the same batch, is skipped,
    not added again or merged into the existing row's quantity, and named
    in an "already on the list" toast (`shoppingList.smartAdd` in both
    dictionaries).
  - **Voice add (AUTO-12)** — a mic button beside the scan button, using
    the browser's Web Speech API (`useSpeechRecognition`,
    `src/components/shopping/use-speech-recognition.ts`). No schema
    change and nothing new stored in the browser.
    - **Feature-detected**: `SpeechRecognition` / `webkitSpeechRecognition`
      checked through `useSyncExternalStore` (false on the server, so no
      hydration mismatch). Where there's no recognizer (Firefox, many
      installed iOS PWAs) the button isn't rendered at all — voice is a
      bonus, never the only way to add something.
    - **Language** is the server-resolved UI locale (`getLocale()`: saved
      account preference first, then the cookie), passed down as a prop
      rather than read from the cookie on the client — the cookie is only
      set by the locale switcher, so it can be missing on a new device:
      `sv` → `sv-SE`, `en` → `en-US` (`speechRecognitionLang`). The same
      locale picks the normalization rules below.
    - **One phrase per tap** (`continuous = false`, interim results on):
      the running transcript shows in the input as it's heard (autocomplete
      dropdown suppressed meanwhile), the mic turns into a stop button, and
      when the speaker pauses the final transcript is normalized and
      committed exactly as if typed and Enter pressed —
      `parseSmartAddInput` → `smartAddShoppingListItemsAction`, same
      dedupe, same highlight/announcement, text put back in the input if
      the add fails. Tapping stop commits whatever was already heard. A
      denied mic, no speech, or any other recognizer error clears the input
      and shows a toast (`shoppingList.smartAdd.voice*`).
    - **`normalizeVoiceTranscript`** (`src/lib/shopping/voice-transcript.ts`,
      unit-tested) turns speech into what the typed-text parser expects,
      per locale: items split on commas and on "and"/"och" (so "salt och
      peppar" becomes two rows — rarer than "milk and eggs", and easy to
      fix); number words to digits (1–99 incl. "twenty four",
      "twenty-four", "tjugofyra"; "a"/"an" and "en"/"ett" as 1; "a dozen"/
      "ett dussin" as 12) — but only at the start of an item or right
      before a unit, so a number inside a name is left alone; spoken units
      to the parser's abbreviations ("liters"/"liter" → l, "kilo" → kg,
      "hekto" → hg, "gram" → g, "stycken" → st, …) with a following
      "of"/"av" dropped. So "two liters of milk and eggs" → `2 l milk,
      eggs`, "två liter mjölk och sex ägg" → `2 l mjölk, 6 ägg`. English
      number words aren't read in Swedish, or vice versa.
    - **Privacy**: Squirrel never receives audio, only the text. The
      privacy page's "Third parties" section says that some browsers
      (Chrome, Edge, Safari) send the recording to their vendor's servers
      for recognition, and that nothing is recorded until the button is
      tapped.
- `PriceHistory` — feeds the cost analyzer (Budget → Insights) and GAP-9's
  price-jump alerts. `price` is what the whole purchased line cost; as of
  GAP-9 each row also carries that line's `quantity` and `unit` so prices
  can be compared per unit (null on older rows). See "Notification center"
  → Price jump.
- **Share link** (`ShoppingListShareLink`) — lets a household member hand a
  single `ShoppingList` to someone outside the household (a roommate not on
  the account, a partner picking up the shop) without inviting them as a
  full household member. Three product decisions drive the shape, all made
  up front rather than left to be re-litigated:
  - **Permissions**: a visitor holding the link can both **view the list and
    check off items** — not view-only. Checking off an item via the link
    runs the exact same side effects `togglePurchasedAction` has for a
    signed-in member (increments/decrements the linked `InventoryItem`'s
    quantity, `recordOutOfStockTransition`, `PriceHistory` on marking
    purchased) — see `toggleItemViaShareTokenAction` below.
  - **Access**: **no login required at all** — the token is the sole
    credential, the same frictionless model `Invitation`/`/join/[token]`
    already uses for household invites. Unlike `Invitation`, there's no
    `expiresAt`.
  - **Expiry**: **manual revoke only**, by any household member (member-,
    not owner-, scoped — same convention as `deleteShoppingListAction`), via
    `revokedAt`. `revokedAt: null` means active; there's no background job
    or time-based expiry at all.

  Schema: `id`, `shoppingListId` (`onDelete: Cascade`), `token`
  (`String @unique`, generated with `randomUUID()` the same way
  `Invitation`/password-reset/email-verification tokens are), `createdAt`,
  `revokedAt`. A list can accumulate more than one row over its lifetime
  (each revoke-then-reshare mints a fresh token), but
  `createShareLinkAction` reuses an existing active link instead of piling
  up duplicates for repeat clicks.

  Actions live in two places, split by trust boundary:
  - `src/app/dashboard/shopping-list/share-actions.ts` —
    `createShareLinkAction`/`revokeShareLinkAction`, both `requireHousehold`-
    scoped exactly like the rest of this feature. `createShareLinkAction`
    builds the full share URL server-side from `APP_URL` (falling back to
    request headers only in local dev with `APP_URL` unset) — the same
    header-spoofing trust boundary the shared `absoluteAppUrl`
    (`src/lib/app-url.ts`, also used by the invite, verification, reset and
    calendar-feed links) already guards against, applied here too.
  - `src/app/share/shopping-list/actions.ts` — `getShoppingListByShareToken`
    and `toggleItemViaShareTokenAction`, which take **no session at all**.
    **The critical security boundary**: `toggleItemViaShareTokenAction`
    doesn't just check the token is active — it re-derives the
    `shoppingListId` from the token first and scopes the `shoppingListItem`
    lookup to `{ id: itemId, shoppingListId }`, so a client can't pair a
    valid, active token for list A with an `itemId` belonging to list B
    (their own, a different household's, or guessed) to toggle an item they
    were never granted access to. A lookup miss (unknown token, revoked
    token, or a real item from the wrong list) all resolve to the same
    generic "not found"/"invalid or revoked" errors — nothing here
    distinguishes *why* a token or pairing failed.
    **Rate limit (SEC-13)**: both are throttled per token with
    `checkRateLimit`, 120 an hour each, the same constants and the same
    reason as the calendar feed (a leaked or guessed link mustn't become a
    cheap way to hammer the database or churn inventory stock). Reads
    (`share-list:<token>`) and toggles (`share-list-toggle:<token>`) have
    separate buckets, because every toggle's `revalidatePath` re-renders
    the page and so costs a read too; one shared bucket would halve how many
    items a shopper can tick in an hour. Over the cap, the read returns
    `null` (the page shows its one "not found or revoked" state) and the
    toggle returns a "too many changes" error, both before any database
    lookup.

  UI: `/dashboard/shopping-list/[id]`'s `ShoppingListClient` renders a
  "Share" button (`ShareListButton`, mirroring `InviteButton`'s show-
  link/copy-button/revoke UX) only while the list is `ACTIVE` — sharing a
  `COMPLETED`/`ARCHIVED` list to let a visitor check off items has no real
  use once the list is done. The public page itself,
  `/share/shopping-list/[token]` (top-level, deliberately **not** under
  `/dashboard` so `src/proxy.ts`'s session gate — which only matches
  `/dashboard/*` — never touches it), is a minimal standalone Card with no
  dashboard chrome, the same shape `/join/[token]` uses for its own
  unauthenticated visitors. An unknown or revoked token renders a clear
  "link not found" message rather than a crash or generic 404.

**Meal planning** (built — see "Meal planning" below)
- `Recipe` + `RecipeIngredient` (ingredients optionally link to
  `InventoryItem`), `MealPlan` + `MealPlanEntry`.
- `PreparedBatch` (GAP-49 meal prep, built — see "Meal prep (GAP-49)"
  under "Meal planning"): a household's batch-cooked recipe with
  `totalPortions`/`remainingPortions`, optional `cookedByMember` and
  `expiryDate`. Recorded by a prep session or by a cook's "Portions left
  over" (GAP-8). A `MealPlanEntry` can draw portions from one via
  `preparedBatchId` + `preparedPortionsUsed` (0 when it draws none).
  Deleting the recipe deletes its batches (unlinking their entries
  first); deleting a batch only unlinks the entries, and a departing member leaves the batch unattributed.

**Budgeting** (built)
- `BudgetCategory` (`name`, `type` — `INCOME`/`EXPENSE`) and `Transaction`
  (`amount`, `categoryId`, `date`, `description`, `isRecurring` +
  `recurrenceFrequency`). UI lives at `/dashboard/budget`
  (`src/app/dashboard/budget/page.tsx`, a Server Component that fetches and
  aggregates, composing Client Components from `src/components/budget/` —
  same split as the household page), with actions in
  `src/app/dashboard/budget/actions.ts`.
- **Categories**: managed from a card on the budget page (`CategoryManager`)
  — add (name + income/expense type) and delete. `Transaction.type` is
  **not** a separately user-chosen field even though the schema has one on
  both models: `createTransactionAction`/`updateTransactionAction` always
  set it from the selected category's `type` server-side, so a transaction
  can never disagree with its own category about whether it's income or an
  expense. A category can't be deleted while any `Transaction` still
  references it (`deleteCategoryAction` checks `_count.transactions` and
  returns an error instead) — `Transaction.categoryId` is a required
  relation with no `onDelete` cascade/set-null in the schema, so an
  unguarded delete would otherwise fail at the database level with a
  confusing FK error; this way the user gets a clear message instead.
- **Monthly spending limits (GAP-12)**: an expense category can carry an
  optional `monthlyLimit Float?` (on both `BudgetCategory` and
  `PersonalBudgetCategory`, since `CategoryManager` and `PeriodSummary`
  serve both budgets; migration `20260925124156_budget_category_monthly_limit`).
  It's set from `CategoryManager`'s add and edit dialogs ("Monthly limit
  (optional)", shown only for expense categories) and parsed by
  `monthlyLimitField` in `src/lib/budget-category-limit.ts`: empty means no
  limit (and clears one on edit), anything else must be a positive number.
  Income and savings categories always store null (`limitForType`, decided
  from the stored type on edit, not from the form). In `PeriodSummary`'s
  "Expenses by category" card a capped row draws its bar against its own
  limit (`limitProgress`: fill %, clamped at 100) and reads "spent / limit";
  past 100% the bar and figure turn `text-destructive`/`bg-destructive` with
  an "X over" note. UX-115: bars are never coloured per category (chart
  colours are for marks, not status): every bar is neutral
  (`bg-muted-foreground`), `warning` with "Almost at limit" from 90% of the
  limit (`LimitProgress.near`) and `destructive` over it; only the row's
  sparkline keeps its category hue. Capped categories with nothing spent yet this month are
  still listed at 0 (`withCategoryLimits`, applied by each page). Uncapped
  rows keep the old proportional bar. Purely visual, in keeping with the
  app's "suggest, don't gate" stance on money: nothing blocks a transaction
  and no notification fires. A read-only view of another household's budget
  (PR #27) shows that household's limits the same way, with the edit
  controls disabled like the rest of the Manage tab.
- **Budget category rollover (GAP-21)**: envelope-style carryover on top of
  a monthly limit. `rolloverEnabled Boolean @default(false)` sits on both
  `BudgetCategory` and `PersonalBudgetCategory` (migration
  `20260925140300_budget_category_rollover`), set by a "Roll unspent budget
  over" checkbox under the limit field in `CategoryManager`'s add and edit
  dialogs. The checkbox is disabled (with a "set a monthly limit" hint) while
  the limit field is empty, and the category actions store it through
  `rolloverEnabledField`/`rolloverForLimit` (`src/lib/budget-category-limit.ts`),
  which force it off whenever the stored limit is null, so clearing a limit
  or picking an income/savings type also clears rollover. The maths lives in
  the dependency-free `src/lib/budget-rollover-calc.ts`:
  `computeCategoryRollover` walks the months before the viewed one, adding
  each month's (limit − spent) to a running balance that's clamped at 0
  after every month (`carryForward`). Overspending eats into what was saved
  up but never creates a debt the next month has to dig out of, which is the
  forgiving half of YNAB-style envelopes, in keeping with "suggest, don't
  gate". A month with no spending carries its whole limit. **Where it
  starts** (`rolloverStartMonth`): the later of the category's `createdAt`
  month (no envelope existed before it, so backdated spending in a new
  category can't pad or eat into a phantom allowance) and **January of the
  viewed month's year** (the envelope starts fresh each calendar year). The
  yearly reset keeps it cheap and consistent: the carry needs at most the 11
  months before the viewed one, which the household page already has in its
  12-month `recurringLookbackTransactions` window and the personal page in
  its loader's full transaction list, so rollover adds no query. Within a
  year carried(M+1) = max(0, carried(M) + limit − spent(M)) always holds,
  which a rolling 12-month window wouldn't guarantee. There's no limit
  history and no record of when rollover was switched on, so the *current*
  limit is applied to every month in the window. Changing the limit, or
  turning rollover on mid-year, re-evaluates the year so far, but never
  reaches into the previous year. Each page wraps its expense rows in
  `withCategoryRollover(withCategoryLimits(…))`, which attaches `carried` to
  rollover-enabled rows only (the personal page's `shared:` mirror rows never
  match). `CategoryBreakdown` then draws the bar, the "spent / X" figure and
  the "X over" note against limit + carried and adds an "incl. X carried over"
  line under the bar when anything was carried. Like the limit itself it's
  purely visual: safe to spend and every total ignore it.
- **Savings goals (GAP-22)**: a savings category can carry an optional
  target amount and date, the way YNAB's and Qapital's goals do.
  `goalAmount Float?` and `goalDate DateTime?` sit on both `BudgetCategory`
  and `PersonalBudgetCategory` (migration `20260925220624_savings_goals`).
  The personal budget got it too because `CategoryManager`, `BudgetTabs` and
  the category actions are already shared, so it cost nothing extra. They're
  set from "Savings goal (optional)" and "Reach it by (optional)" fields in
  `CategoryManager`'s add and edit dialogs, shown only for savings
  categories. The fields are parsed by `goalAmountField` (empty means no goal
  and clears one on edit; otherwise it must be a positive number) and
  `goalDateField` (a `YYYY-MM-DD` date input value stored as UTC midnight of
  that day, like a transaction's date; impossible dates such as 2026-02-31
  are rejected, past dates are accepted so an unrelated rename still saves)
  in `src/lib/savings-goal-calc.ts`. `goalForType` enforces the rule
  server-side: anything but a `SAVINGS` category stores null for both, and
  on edit that's decided from the stored type rather than the form. A
  category's type can't be changed after creation, so a goal can't outlive
  a type change. A date sent without an amount is dropped too.
  `computeSavingsGoalProgress` turns (saved so far, goal amount, goal date,
  today) into a status (`reached`, `noDate`, `inProgress` or `datePassed`),
  a progress percentage (clamped to 100 for the bar) and, while in progress,
  the monthly pace: what's left divided by the calendar months from this one
  through the goal's month, inclusive. A goal dated later this month
  therefore asks for the whole remainder, never a division by zero. "Saved
  so far" is the category's **all-time** `SAVINGS` total, floored at 0. The
  household page sums it with one `transaction.groupBy`, and the personal
  page sums the loader's full transaction list, so it adds no query there. A
  `SavingsGoals` card on the Overview tab (under Safe to spend, and only when
  some savings category has a goal) shows each goal as "saved / goal", a bar
  in the calm savings colour and a line such as "Save ~X/month to reach this
  by {date}". It doesn't follow the month navigator, since a goal is a
  running total measured as of today. It's informational only, in keeping
  with the Guardrails on money: there's no notification, no red or warning
  state (a passed date is simply stated), no streaks, and it never blocks
  or affects a transaction, safe to spend or any total.
- **Shopping expense category**: `resolveShoppingExpenseCategory(tx,
  householdId)`, exported from the plain server module
  `src/lib/budget-groceries-category.ts` (not a `"use server"` file, where
  it would be a client-callable endpoint taking a household id — see
  MAINT-2 below), picks the category the shopping-list → budget expense
  link logs to. It returns `Household.shoppingExpenseCategory` when that is
  set, still an `EXPENSE` category and in this household. Otherwise it finds
  the household's `"Groceries"` `EXPENSE` category (case-insensitive name
  match) or creates it, and **stores its id as the household's pick**, so
  later trips look it up by id: renaming "Groceries" to "Mat" keeps the
  link instead of a second "Groceries" appearing on the next trip. It runs
  on the caller's transaction client. The fallback name
  (`GROCERIES_CATEGORY_NAME`) is module-private; callers read
  `category.name`. Like `findOrCreateInventoryItem`, it trusts its
  `householdId` argument and does no auth check of its own; every caller
  must resolve that id from its own `requireHousehold()` call first, never
  from client input.
- **Choosing the category**: a "Shopping in the budget" card on the
  Household page (`ShoppingExpenseSetting`,
  `src/components/household/shopping-expense-setting.tsx`) lists the
  household's expense categories and saves on change via
  `setShoppingExpenseCategoryAction(categoryId | null)` in
  `src/lib/actions/household.ts`. Open to every member (budget categories
  aren't role-gated either). The action looks the id up scoped to the
  session's household and `type: "EXPENSE"` and refuses anything else;
  `null` goes back to the automatic "Groceries". That automatic option only
  shows while nothing is picked, since the first priced trip pins a real
  category. The column is `onDelete: SetNull`, so deleting the picked
  category (only possible once it has no transactions) falls back too.
- **Transactions**: `TransactionList` shows date, category (badge tinted
  `text-success`/`text-destructive` for income/expense — the same two
  tokens the summary and amounts use, so the income/expense meaning stays
  visually consistent everywhere on the page), description, and a signed,
  colored amount, with edit/delete per row. Add/edit share one
  `TransactionDialog` component (amount, category chips, date,
  description, and a recurring toggle) — editing reuses the same dialog
  with the row's data as `defaultValue`s rather than a second form.
  - **Log an expense in three taps (UX-109, DESIGN.md M4/M5)**: a new
    transaction opens on **Amount**, focused with the decimal keypad even
    on a touch open (`DialogContent focusOnTouch`, the one opt-out from
    UX-34's keyboard-down rule: the sheet exists to type that number).
    **Category** is a radio group of chips (`min-h-11` targets, native
    `required`), not a combobox: grouped Expenses, then Savings, then
    Income (`groupCategoriesForLogging` in `src/lib/recent-categories.ts`),
    with the categories most recently logged (by `createdAt`, not by
    transaction date; the latest 30 rows, at most 5 categories) on top of
    their group. A new transaction starts on the Transactions tab's
    `?category=` filter when that tab is open, else on the last-used
    category (`defaultLoggingCategoryId`); a stale or foreign id is
    ignored. Saving shows "Added 129 kr to Restaurang & café" with
    **Undo**, which deletes exactly the created row: the create actions
    return `{ createdId }` and `BudgetTabs` injects the delete action. A
    log from a recurring template or planned bill keeps its own toast.
    Same on the household and personal budgets. Covered by
    `e2e/log-expense-fast.spec.ts` and `recent-categories.test.ts`.
- **Recurring transactions**: `isRecurring` + `recurrenceFrequency`
  (`WEEKLY`/`MONTHLY`/`YEARLY`) on `Transaction` itself are metadata and
  display only — checking "this repeats" on a transaction marks it and
  shows a "Recurring" badge with its frequency in the list. Nothing about
  a single `Transaction` row auto-generates a future one; the flag just
  documents that a logged transaction is one of an expected repeat (e.g.
  rent, a subscription) for the household's own reference.
  UX-113: a *new* transaction no longer offers "This repeats" (household
  and Personal Budget share `TransactionDialog`). The flag only fed the
  fallback estimate below, so ticking it created no recurring item and
  moved Safe to spend with nothing under Recurring items or "Due this
  period" to explain it. A repeating bill is added as a recurring item
  (Manage), which is listed, due and counted by name. The checkbox stays
  only for a payment logged from a recurring item and for an existing
  transaction already flagged, so it can be cleared. Covered by
  `e2e/transaction-repeats.spec.ts`.
- **Recurring budget templates** (a separate, later-added system — see
  `RecurringTemplate`/`RecurringTemplateAck` in `prisma/schema.prisma`,
  the pure `src/app/dashboard/budget/recurring-template-calc.ts`, and
  `RecurringTemplatesPanel`/`DueRecurringWidget` in
  `src/components/budget/`): a standing expectation ("Rent", "Netflix" — an
  amount, category, and `WEEKLY`/`MONTHLY`/`YEARLY` frequency, with an
  optional display-only `dayOfMonth` hint) that's checked off every period
  independently of any single `Transaction`. For the current period,
  `computeTemplateStatuses` derives one of three statuses per active
  template: `"posted"` (a `Transaction` was logged with this template's
  id, via `Transaction.recurringTemplateId`), `"acknowledged"` (marked
  accounted-for with no transaction — e.g. a bill on autopay this app
  doesn't otherwise track — via a `RecurringTemplateAck` row keyed by
  template + a stable per-frequency period string, which makes
  acknowledging idempotent), or `"due"` (neither yet) — "current period"
  meaning whichever month is selected via the Budget page's month
  navigation (see "Month navigation" below), not necessarily today's.
  `computeTemplateStatuses` needs to see transactions outside that month
  too (a YEARLY template's whole calendar year, to tell whether it's
  already been paid), so `src/app/dashboard/budget/page.tsx` feeds it a
  trailing 12-month lookback window rather than just the selected month —
  see "Safe to spend" below, which shares the same window for the same
  reason. `DueRecurringWidget`
  surfaces everything `"due"` in an always-visible strip above the Budget
  page's tabs; the full `RecurringTemplatesPanel` groups templates by all
  three statuses and also handles add/edit/pause (`active: false`, which
  keeps history but stops a template counting as due)/delete. This is
  still not an auto-generating scheduler — nothing ever creates a
  `Transaction` on its own — but it is a genuine per-period due/posted/
  acknowledged tracker, meaningfully more than the display-only
  `isRecurring` flag above. Logging a template twice in one period is
  rejected at write time (`assertNoDuplicateTemplatePeriod`, and its
  personal-budget twin): the check reads only the transactions inside
  the period's `[start, end)` range (`getPeriodBounds`), so its cost
  doesn't grow with a template's history. Mirrored for the separate, user-scoped personal
  budget (`prisma/schema.prisma`'s `PersonalBudgetCategory`/
  `PersonalTransaction`) as `PersonalRecurringTemplate`/
  `PersonalRecurringTemplateAck` — not documented further here, as it isn't
  part of this file's original household-budgeting scope.
- **Period summary**: `PeriodSummary` shows the selected calendar month —
  income, expense and savings totals and "Remaining after expenses and
  savings" (the same number as Safe to spend below, passed in as
  `remaining`; it replaced a plain income − expenses "Net" that ignored
  savings and anything still due, so the two cards used to disagree), plus a per-category breakdown for each with a
  proportional bar cycling through the existing `--chart-1..5` tokens (the
  "small rainbow ... for future charts" REQUIREMENTS already called out).
  All aggregation happens in the page's Server Component (grouping the
  month's transactions by `categoryId`); the summary components themselves
  are plain presentational functions, not Client Components, since nothing
  on them is interactive. It lives on the Insights tab only (it used to
  open Overview too, repeating Safe to spend's totals), and its four stat
  cards, like `FixedBudgetSummary`'s, sit two by two on a phone at a
  smaller stat size (`text-xl`, `text-3xl` from `sm`). Expense and savings
  totals are plain `foreground` (DESIGN.md Colour); income stays `success`
  and the remaining total keeps its status colour.
- **Month navigation**: the Budget page defaults to the current calendar
  month (`[monthStart, monthEnd)`, computed server-side from `new Date()`)
  but isn't stuck there — a `?month=YYYY-MM` search param (validated by
  `isMonthKey`/`parseMonthKey` in `src/lib/budget-date-utils.ts`, silently
  falling back to the current month for anything invalid or absent, the
  same graceful-fallback convention the page's `?household=` override
  uses) picks any other month. `MonthNavigator`
  (`src/components/budget/month-navigator.tsx`, shared with the personal
  budget) renders prev/next/"this month" as plain `<Link>`s that change
  the param — a full server-rendered navigation with no client state, so
  the selected month survives a refresh and is shareable as a URL, the
  same pattern meal-planning's week navigation uses. It reads as
  `‹  October 2026  ›`: two 44 px arrow links flanking the month name set
  in `heading`, with a "This month" link under the name only once you've
  paged away from the current month (the server passes its own month key
  as `currentMonthKey`, so render and hydration agree). Every link is
  built by `budgetHref` (`src/lib/budget-url.ts`) and keeps the open tab
  (`?tab=`), the category filter (`?category=`) and `?household=`, so
  paging months from Transactions stays on Transactions. `src/app/dashboard/
  budget/page.tsx` fetches `Transaction` rows bounded to the selected
  month's `[monthStart, monthEnd)` window (rather than the household's
  entire history — see SCALE-F, BACKLOG.md, for why an unbounded query
  here doesn't scale) for the transaction list and this section's totals;
  Safe to spend and the recurring-template status checks each read from
  their own wider trailing window instead (see those subsections) since
  they need to see further back than just the month on screen. The
  settle-up balances count every split bill and repayment the household
  has, since debts carry over until they're cleared, but load only the
  bills that aren't settled yet and repayments summed per pair (PERF-12) —
  see "Household expense splitting".
- **Viewing another household (`?household=`)**: "View in {household}
  Budget" links on shared rows in Personal Budget (F1) open
  `/dashboard/budget?month=…&household=<id>`, so the page shows the bill's
  actual household even when a different one is active.
  `resolveBudgetHouseholdView` (`src/lib/budget-household-view.ts`) only
  trusts the param when it names one of the signed-in user's own
  households (anything else falls back to the active household, like
  `?month=`), and keeps it on `MonthNavigator`'s links so paging months
  stays on that household. Every budget Server Action writes to
  `requireHousehold()`'s *active* household, so when the viewed household
  isn't the active one the page is **read-only**: `BudgetTabs` wraps every
  write control in a `<fieldset disabled>` (the tab bar and month
  navigation stay usable), the CSV export is hidden since it always
  exports the active household, and `ReadOnlyHouseholdBanner` explains why
  and offers "Switch to {household}". That calls `switchHouseholdAction`
  with a `returnTo` (only in-app `/dashboard` paths are honoured, never an
  open redirect), which re-checks membership, makes that household active
  and lands back on the same month, now writable.
- **Display currency (GAP-13)**: every on-screen amount goes through one
  formatter, `createMoneyFormat(locale, currencyCode)` in
  `src/lib/currency.ts` (locale-aware decimal separator, always 2
  decimals). `Household.currencyCode` (`String?`, default null) picks the
  label:
  - **Unset**: the plain symbol-free number every amount used before
    GAP-13. Existing households stay here until the owner opts in, and a new
    household lands here only when no currency can be derived (below).
  - **New households get a default (UX-73)**: `signupAction` and
    `createHouseholdAction` set `currencyCode` from
    `defaultCurrencyForNewHousehold(locale, acceptLanguage)`
    (`src/lib/currency.ts`): a Swedish-language signup gets `SEK`;
    otherwise the region of the highest-ranked `Accept-Language` tag
    (`en-GB` GBP, `en-US` USD, `de-DE` EUR, ...) decides, and a missing
    region or one outside `SUPPORTED_CURRENCIES` (`en-CA`) stays unset
    rather than guessing a wrong "$". No schema change. The household
    budget's first-run card shows it as "Amounts show in" with a select
    (`OnboardingCurrency`, the same `setHouseholdCurrencyAction`, owner-only,
    disabled for others and in the read-only view), so a wrong guess is one
    tap to fix.
  - **Set**: `Intl.NumberFormat`'s `{ style: "currency", currency }`, so the
    locale places the symbol ("1 234,50 kr" in Swedish, "SEK 1,234.50" in
    English). An unrecognised stored code falls back to the plain format
    rather than throwing mid-render.
  - **Display only, never converted.** Amounts are plain `Float`s with no
    currency of their own; switching the setting relabels them and rewrites
    nothing. Receipt conversion keeps targeting `HOUSEHOLD_BASE_CURRENCY`
    (see "Currency conversion" under Receipt scanning), and GAP-9's
    price-spike thresholds stay in SEK. The Household page says so in an
    always-visible hint, since "switching to EUR converts my kronor" is
    the one misreading the setting must not invite.
  - **Where it's set**: `CurrencySetting`
    (`src/components/household/currency-setting.tsx`) on the Household
    page, a select of "No currency symbol" plus `SUPPORTED_CURRENCIES` (the
    receipt scanner's list, all two-decimal currencies), with names from
    `Intl.DisplayNames` in the viewer's language. It saves on change with
    `useOptimistic`. **Owner-only**, like the calendar feed: it relabels
    every amount every member sees. `setHouseholdCurrencyAction`
    (`src/lib/actions/household.ts`) re-checks the role, normalises and
    allow-lists the code (`parseHouseholdCurrency`), and revalidates the
    whole `/dashboard` layout. Contributors see the value read-only.
  - **Where it shows**: the household budget (Overview, Transactions,
    Manage, Fixed budget, Cost analyzer, balances, savings goals), shopping
    lists (row prices, the "left to spend" total and the completion toast)
    and recipe cost lines. In F1's read-only view the budget uses the
    *viewed* household's currency, not the active one's. The personal
    budget spans every household the user is in, so it has no single
    currency and stays symbol-free. CSV exports and the weekly digest email
    stay plain numbers (see "Data export (CSV)").

### Cost analyzer

A second tab on `/dashboard/budget` (`BudgetTabs`,
`src/components/budget/budget-tabs.tsx`) — a client-side pill-button tab
switch mirroring `MealPlanningView`'s "Planner"/"Recipes" pattern, not a new
route (`nav-items.ts` is untouched). The page's Server Component renders both
tab bodies once (the existing Overview content, and the new
`CostAnalyzer`) and passes them into `BudgetTabs` as props — Server
Components passed as children/props to a Client Component, per Next's own
Server/Client Components guide — with `hidden` (not conditional rendering)
toggling which one shows, so switching tabs is instant and doesn't re-fetch
anything.

**UX-114:** a cost card with nothing to show (no priced purchases, trends,
store comparison, list basket, stock, or expired items this or last month)
is not rendered; one muted line ("Price and pantry insights appear once you
scan receipts…") stands in for all of them. A card returns as soon as it has
data.

`CostAnalyzer` (`src/components/budget/cost-analyzer.tsx`) surfaces grocery
cost trends from `PriceHistory`, which is populated whenever a shopping list
item is marked purchased with an estimated price
(`togglePurchasedAction`, `src/app/dashboard/shopping-list/actions.ts`). Like
`PeriodSummary`, it's a plain presentational component — all aggregation
(grouping `PriceHistory` rows by month and by `inventoryItemId`) happens in
`src/app/dashboard/budget/page.tsx`'s Server Component, scoped via
`requireHousehold()` the same way every other query on the page is (through
`inventoryItem: { householdId }`, since `PriceHistory` itself has no
`householdId` column).

- **Spending over time**: a per-month total of every priced purchase,
  shown as a simple bar per month (most recent 12 months). No charting
  library is installed in this app (checked `package.json` before adding
  anything), so this is a hand-rolled CSS bar chart — the same
  proportional-`<div>`-bar technique `PeriodSummary`'s category breakdown
  already uses — rather than a new dependency.
- **Window (PERF-12)**: the analyzer reads only the trailing 12 calendar
  months of `PriceHistory` (this month and the 11 before,
  `PRICE_HISTORY_WINDOW_MONTHS`), not the household's whole history, so
  the query stops growing with every purchase. The spending bars were
  already limited to 12 months; per-item trends, "cheapest store" and the
  basket comparison now also reflect that window (a price older than a
  year no longer counts as an item's "first" price or a store's "last"
  price).
- **Price trend per item**: grouped by `inventoryItemId`, an item needs at
  least 3 recorded `PriceHistory` points before it's considered to have
  "enough history to be meaningful" and gets a card — fewer than that and
  a trend line would be noise, not signal. Each qualifying item's card shows
  a small hand-rolled inline SVG polyline (a sparkline, not a library
  chart), its latest recorded price and date, and the percent change from
  its first to its latest recorded price (colored `text-success` when the
  price has gone down, `text-destructive` when it's gone up — the same
  green/red semantic the rest of the budget page uses for income/expense).
- Both charts use only the existing `--chart-1..5` tokens — the monthly bars
  via `bg-chart-1`, the sparkline via `stroke-chart-4`/`fill-chart-4` — using
  Tailwind v4's auto-generated utilities for those tokens (already mapped in
  `globals.css`'s `@theme inline` block), so both theme automatically in
  light/dark with no new CSS.
- Empty states (no priced purchases yet; no item with enough history yet)
  are separate per section, same dashed-border/muted-text treatment as
  `noCategoriesWarning` elsewhere on the page.
- **Cheapest store**: a third section below the two charts above, showing
  which store had the cheapest last recorded price for any item bought at
  ≥2 distinct stores — see "Store name and cheapest-store comparison
  (GAP-6)" below for the full write-up (it's grouped there with the receipt
  scan/register changes that feed it `PriceHistory.store`
  in the first place).
- **Went past its date (GAP-17)**: the last section — a quiet monthly
  recap of food that expired unused, valued at what it cost last time.
  It's a "here's what happened" card in the same register as
  `MealVarietyRecap`, never a notification. Built as a **derived** figure
  with no migration (no `wastedAt`/`wastedValue` columns, no per-write
  hook), computed by the pure `computeExpiredWaste`
  (`src/lib/inventory/expired-waste.ts`, unit-tested) from one extra
  `InventoryItem` read in `CostAnalyzerSection` (items whose `expiresAt`
  fell in this or last month and has passed, same household scope as the
  `PriceHistory` read).
  - **Which items count.** There's no stock-movement log, so the amount
    thrown out is lost when a quantity is zeroed, and the figure is read
    from a snapshot. An item counts for a month when its `expiresAt` is in
    that month, the date has already passed, and either it **still has
    stock** (nobody used it up in time) or it's **empty and was last
    written on or after its date** (`updatedAt >= expiresAt`: emptied after
    it expired, the mark-empty/edit-to-0 case). An empty item last written
    *before* its date was used up in time and never counts. The second rule
    is an inference: `updatedAt` moves on any write, so an item emptied
    before its date and renamed afterwards would be miscounted. That was
    judged better than dropping emptied items, which would make throwing
    something out erase it from the recap.
  - **Value.** One `lastKnownPrice` per item, never `lastKnownPrice ×
    quantity`: `lastKnownPrice` is the price of one shopping-list line
    (AUTO-4's per-line convention), not a price per inventory unit, so
    multiplying it by a quantity in grams or millilitres would be nonsense.
    The figure is shown with "≈". Items with no known price are listed and
    counted ("N of them have no known price yet") but add nothing to the
    sum.
  - **Estimated dates (AUTO-7).** An estimated `expiresAt` is a
    category-default guess, and plenty of it is still fine and gets eaten.
    So the headline figure sums **real (user-entered) dates only**; items
    with an estimated date are still listed (with an outline
    "≈ estimated date" badge) and their value is shown separately on a
    softer "Maybe ≈ X more from estimated dates" line instead of being
    folded into money lost.
  - **Range.** This calendar month is the recap (up to 5 items named, real
    dates first then by value, "+N more" after that); last month gets one
    muted line of context. Nothing further back, since the snapshot decays:
    a restock re-estimates an estimated date, and later edits move
    `updatedAt`. An empty month shows a plain "Nothing has gone past its
    date this month" rather than a zero.
- **On hand now (GAP-33)**: a small card just before GAP-17's, showing
  roughly what everything currently in stock is worth — Grocy's headline
  pantry stat, the counterpart to "what went to waste". Derived with no
  migration by the pure `computeStockValue`
  (`src/lib/inventory/stock-value.ts`, unit-tested) from one more
  `InventoryItem` read in `CostAnalyzerSection` (items with
  `quantity > 0`, selecting only `quantity` and `lastKnownPrice`; same
  household scope and Suspense boundary as the GAP-17 read).
  - **Which items count.** Only items the household actually has
    (`quantity > 0`); a zero-quantity row is a "we usually keep this"
    placeholder, not stock. Items past their date but still on the shelf
    are counted — they're physically there, and whether they were wasted
    is GAP-17's question.
  - **Value.** Same rule as GAP-17: one `lastKnownPrice` per item, never
    `lastKnownPrice × quantity` (it's a per-shopping-line price, not a
    per-unit one), so a half-used bag counts at its full last price and the
    figure is shown with "≈". Items with no known price (null or 0) add
    nothing but are counted, and the card always says what the figure is
    built from: "Based on N of M items with a known price."
  - **Empty states.** Nothing in stock shows "Nothing is in stock right
    now"; stock with no priced items shows "M items are in stock, but none
    of them has a known price yet" instead of a misleading "≈ 0".

### Shopping-list → budget expense link

Completing a shopping list (`completeShoppingListAction` in
`src/app/dashboard/shopping-list/actions.ts`) automatically logs a single
expense `Transaction` for that list, in the household's chosen shopping
category ("Groceries" unless changed, see "Shopping expense category"
above), on top of its existing
job of link-fixing unlinked items and flipping the list to `COMPLETED`:

- **What gets summed**: every item on the list where `purchased` is true
  and `estimatedPrice` is set (not `null`) — `estimatedPrice` is added
  directly to the running total, unmultiplied by `quantity`, the same way
  `togglePurchasedAction` already treats it when writing a `PriceHistory`
  row. Items without an estimated price are silently skipped rather than
  having a price invented for them; if nothing on the list has a price set,
  no `Transaction` is created at all. As of AUTO-4 (below), a new item
  usually arrives with `estimatedPrice` already filled in, so in practice
  this total is rarely 0 once a household has bought something at least
  once.
- **Partly priced trips (UX-87)**: when some, but not all, purchased items
  have a price, "Done shopping" / "Complete list" first opens
  `PartialPriceDialog`, which says how many bought items have no price and
  pre-fills the sum of the priced ones. The user logs that amount, edits it
  to the real total, or chooses "Don't log" (the list completes with no
  expense). `completeShoppingListAction(listId, amountOverride?)` takes the
  chosen amount (`undefined` = the sum as before, `null` = log nothing, a
  number validated like a price, 0 to 1 000 000). All-priced and none-priced
  trips complete without the extra step.

#### Prices fill themselves in (AUTO-4)

`InventoryItem.lastKnownPrice` is kept current everywhere a `PriceHistory`
row is written — the same price, in the same `$transaction`: a shopping-list
item checked off with an estimate (`togglePurchasedAction`,
`toggleItemViaShareTokenAction`), an applied receipt scan
(`applyReceiptScanAction`), and a registered receipt
(`registerReceiptAction`, using the *last* line's price when a receipt
lists the same item twice). It was previously written nowhere, which is why
`estimatedPrice` used to have no way to fill itself in past a scanned
receipt.

Every shopping-list item create path that links an `InventoryItem` with a
non-null `lastKnownPrice` now defaults the new row's `estimatedPrice` to it
— the ad-hoc add/quick-add path (`createAdHocShoppingListItem`), "Add
low-stock items" (`generateFromLowStockAction`), pasted/CSV import
(`importShoppingListItemsAction`), and the smart add line
(`smartAddShoppingListItemsAction`, for a row that resolves to an *existing*
inventory item — a brand-new one has no price yet). The default is
per-unit, unmultiplied by `quantity` — matching how `completeShoppingListAction`
sums `estimatedPrice` above, so a 2-pack priced at "24" books as 24, not 48.
This only ever runs once, at creation: a receipt-driven create
(`registerReceiptAction`) keeps setting `estimatedPrice` from the receipt's
own (real) price instead, and once a user corrects a row's price nothing
here re-guesses over it (Guardrails: corrections stick). No backfill was run
for pre-existing inventory items — `lastKnownPrice` simply fills in the
next time each one is priced again.

On `/dashboard/shopping-list/[id]` (`ShoppingListClient`), each row shows a
muted "≈ {amount}" next to its edit/delete controls whenever `estimatedPrice`
is set (or, on an `ACTIVE` list, a smaller "Add price" affordance when it
isn't) — placed outside the row's own `<label>` so tapping it doesn't also
toggle the checkbox the label is wired to. Tapping it swaps in a small inline
number input (save/cancel icon buttons, `Escape` to cancel) that calls the
new `updateShoppingListItemPriceAction`; this is the only path a user ever
corrects an estimate through, and the correction sticks — no create path
touches a saved row's price again. The list header shows a running "≈
{amount} still to buy ({priced} of {total} priced)" (UX-87: the count says
how much of what's left the amount covers, so a sum over one priced row of
fourteen doesn't read as the trip's cost), summing `estimatedPrice` the same
per-unit way but only over *pending* (not yet purchased) items — a purchased item's price is
already folded into `lastKnownPrice` and the eventual Groceries expense, so
counting it again here would double it into "what's left". Both the row
amount and the header total use the same `Intl.NumberFormat` convention as
the budget page (`createMoneyFormat`: locale-aware decimals, plus the
household's currency symbol once GAP-13's setting is chosen). The summation
itself is a pure, unit-tested helper
(`sumEstimatedPendingTotal`, `src/lib/shopping/estimated-total.ts`).
- **Category lookup**: `resolveShoppingExpenseCategory` (see "Shopping
  expense category" above), shared with `registerReceiptAction`.
- **The `Transaction` created**: `amount` = the summed total, `type` =
  `"EXPENSE"`, `date` = the moment the list was completed (not any
  per-item purchase date, since `ShoppingListItem` doesn't track one),
  `description` = `From "{list name}"` (translated, built with
  `format()`), `createdByUserId` = the household member who clicked
  "Complete list". Both actions log it through one module-private helper,
  `logGroceriesExpense(tx, …)` (MAINT-5), **inside the same `$transaction`**
  as the list's `status` update (or, for a receipt, the stock and price
  writes), wrapped in `toFriendlyError`. So a failed insert rolls the whole
  completion back and shows a friendly error, instead of crashing after
  stock had already moved and double-applying it on retry.
- **Feedback**: `completeShoppingListAction` returns
  `{ expenseLoggedMessage?: string }` (a change from its previous `void`
  return) built server-side from the `shoppingList` dictionary
  (`expenseLogged`, interpolating the category's name and a
  locale-formatted amount via
  `createMoneyFormat` with the household's display currency — same convention as the rest of
  Budgeting) so the client stays dumb. `ShoppingListClient`
  (`src/components/shopping/shopping-list-client.tsx`) awaits the action
  inside its existing `useTransition` click handler and shows a `sonner`
  toast when a message comes back; nothing is shown when the total was 0.
  There's no toggle to turn this off; only the category is configurable. It also returns `transactionId`, the id of the
  expense it logged (if any), for the Undo below.

#### Store name and cheapest-store comparison (GAP-6)

`PriceHistory.store` has existed in the schema since AUTO-9's own
groundwork (it needed *some* notion of "which store" to eventually learn
a shopping order from), but nothing ever wrote it — every row was created
with `store` left at its default `null`. GAP-6 is purely wiring: an
optional store name on the receipt flows, plus a small Cost analyzer insight built on
top of it. No migration was needed.

- **Receipt scan / register**: `ReceiptScanDialog` and
  `RegisterReceiptDialog` (`src/components/shopping/`) each gained one
  optional "Store" text input next to the currency picker — one store for
  the *whole* receipt, not per line, since a single receipt is always from
  one store. `applyReceiptScanAction` and `registerReceiptAction`
  (`src/app/dashboard/shopping-list/actions.ts`) both take it as a trailing
  optional `store` parameter, trim it (empty/whitespace-only collapses to
  `null`, same as leaving it blank), and stamp every `PriceHistory` row the
  call writes with it.
- **Not on manual price correction (AUTO-4)**: the inline price edit on a
  list row deliberately has no store field. A correction isn't a purchase
  — checking the item off afterwards writes its own `PriceHistory` row —
  so recording one there too would count the same purchase twice in
  "Grocery spending over time" and add a phantom point to its price
  trend. Receipts are the purchase event, so that's where the store goes.
- **Cost analyzer's "Cheapest store" section**
  (`src/components/budget/cost-analyzer.tsx`): a third card below "Grocery
  spending over time" and "Price trends" — a plain one-line-per-item list,
  not a chart, since there's nothing to plot, just a fact to surface. For
  every item with at least 2 distinct non-null `store` values on record, it
  shows which store had the *cheapest last recorded price* — deliberately
  "last recorded", not "lowest ever", so it reflects what you'd likely pay
  today at each store rather than a historical low that might no longer
  hold (the ICA-app-style comparison this data already supported once
  `store` started getting populated). The aggregation
  (`computeCheapestStoreComparisons`, `src/lib/cheapest-store-calc.ts`) is a
  pure, unit-tested function — same "extract the aggregation out of the
  page into a dependency-free calculator" convention as
  `safe-to-spend-calc.ts` — fed the same `priceHistoryRows` query
  `src/app/dashboard/budget/page.tsx` already runs for the two charts
  above it, so it costs no extra query. It's independent of
  `MIN_PRICE_POINTS_FOR_TREND`: an item only needs 2 rows from 2 different
  stores to appear here, even if that's not (yet) enough total history for
  a trend card.
- **Whole-basket comparison (GAP-34)**: a "Your list, store by store" card
  right below "Cheapest store" answers the Listonic/Out of Milk question —
  what would the list I'm about to shop cost at each store? The basket is
  every unchecked (`purchased: false`) row with a linked inventory item on
  the household's `ACTIVE` lists, de-duplicated by inventory item (an item
  on two lists is bought once). Only items that meet GAP-6's bar — priced
  at ≥2 distinct stores — count; with fewer than 2 such items the card
  shows an empty state instead. `computeBasketStoreComparison` (same
  module, sharing GAP-6's "last recorded price per store, store names
  folded case/whitespace-insensitively" helper so the two can't drift)
  sums each store's last recorded price over the items it has one for.
  - **Coverage is always shown, never hidden**: not every store has a price
    for every item. Rather than rank on only the items *every* store has in
    common — an intersection that one rarely visited store can collapse to
    nothing — each store gets its own total with "N of M items priced"
    (or "All M items priced") beside it. Stores are ranked by coverage
    first and total second, so a partial total can never outrank a more
    complete one just because it's missing the expensive items; a note
    under the list says so whenever any store is partial. The "Cheapest"
    badge only appears when at least two stores price the *whole* basket,
    and goes to the cheaper of those.
  - Prices are summed as recorded (whole-line prices, not rescaled to the
    list row's quantity — units differ too often between receipts and list
    rows for rescaling to be honest). It reads the same `priceHistoryRows`
    as the rest of the analyzer plus one small `ShoppingListItem` id query
    in the same `Promise.all`. No schema change.

#### Detail page polish (UX-22)

- The add line's mic and barcode buttons are ghost buttons inside the
  field's right edge (the input pads for them); only Add sits outside it.
- A row's controls keep one order: [category chip or "Match item"]
  [price] [edit] [delete]. "Match item" is a `warning` badge (text on its
  own tint, with a triangle icon) placed in the chip's leading slot, and
  pending rows under a category header omit the chip that would repeat it.
- Closing the receipt dialogs (`ReceiptScanDialog`, `RegisterReceiptDialog`)
  or the AI shelf scan while their review step is showing asks first
  ("Discard this review?", `DiscardReviewDialog`), whether by Cancel,
  backdrop, Esc or a back swipe, since re-reading means a new photo and
  another AI call. Other phases close at once. Not covered by e2e: reaching
  the review step needs a real AI/OCR read.

#### Finishing the trip in one gesture (AUTO-5)

The detail page's header keeps only what's used on every trip visible:
"Register receipt" (UX-22: the same name as the index page's action) and a `⋯` overflow menu (Base UI `DropdownMenu`), with the
smart add line below. The menu holds add item, import, add low-stock
items, resolve mappings (when there are enough unlinked items), share,
export, print (below), then — after a separator — "Complete list", archive/unarchive, and
a destructive-styled delete. The dialogs those items open are rendered
outside the menu, since its popup unmounts as it closes, and are opened
through Base UI dialog handles (`createDialogHandle` in
`src/components/ui/dialog.tsx`; `ConfirmDialog`, `ImportListDialog`,
`ShareListButton`, `ResolveMappingsDialog` and `ShoppingItemFormDialog`'s
create mode take an optional `handle` in place of their own trigger). Opening
through a handle still runs each dialog's `onOpenChange`, so their
reset-on-open logic is unchanged.

When the last pending item is checked off, the "All done" cleared state
gains a primary **"Done shopping"** button that completes the list right
away — no confirm dialog, since everything is already checked off. The
toast ("List completed", with the expense message as its description)
carries an **Undo** that calls `uncompleteShoppingListAction(listId,
transactionId)`: it puts the list back to `ACTIVE` and deletes exactly the
Groceries expense that completion logged, in one `$transaction`. It's
household-scoped (the expense delete is a `deleteMany` on id +
`householdId`, so a stale or foreign id removes nothing) and idempotent (a
list that's no longer `COMPLETED` is left alone). Inventory needs no
reversal, because completing never touches it. The menu's "Complete list" is
still confirm-gated when items are still pending: the sheet says how many
("1 item isn't ticked off yet. …") and carries the same "Move N unbought
items to {list}" checkbox. With nothing pending it completes straight away.
Its toast carries the same Undo. Like "Undo mark cooked", this is a
fat-finger undo on the toast, not a permanent "reopen list" control.

**Carrying unbought items over (UX-80).** `completeShoppingListAction(listId,
amountOverride?, carryOver?)` with `carryOver` moves the list's unticked rows
to the household's active default list (the fresh one when the completed list
was the default, a new "Next shop" when none exists) inside the completing
`$transaction`, so they show as pending there. A row whose inventory item is
already pending on the target stays behind instead of doubling up. The action
returns `carriedOver: { itemIds, listId, listName }`; the toast's description
says "N items moved to {list}", and Undo passes the ids to
`uncompleteShoppingListAction(listId, transactionId, carriedItemIds)`, which
moves back only those still unticked in the household. The checkbox label
names the target list (page query for the active default). Flow spec:
`e2e/shopping-finish-carry-over.spec.ts`.

#### Printing a list (GAP-24)

For households that still shop from paper, or want a big-text copy on the
fridge. The `⋯` menu's **"Print"** item (on any list, whatever its status)
just calls `window.print()`. There's no print route, no PDF and no new
dependency, only CSS. `ShoppingListClient` renders a `PrintableList` that is
`hidden print:block`. It's the list name as a heading, then the **pending**
items grouped under the same category headers and store-walk order as
shopping mode (`groupPendingItemsByCategory`), one per line in large
(`text-2xl`) black-on-white type, each with an empty box to tick with a pen.
Groups use `break-inside-avoid` so a header isn't stranded at the bottom of a
page. A list with nothing pending prints "Nothing left to buy." Purchased
items, prices, badges and the estimated total are left out on purpose.

Everything else is hidden on paper:

- The page's own column hides every child except the `[data-print-list]`
  section with one arbitrary-variant selector, so the interactive tree is
  untouched. The `⋯` menu popup (portalled, and possibly still fading out
  when the print snapshot is taken) is `print:hidden`.
- The dashboard chrome hides itself: `Sidebar`, the mobile header,
  `BottomNav`, the email-verification banner and the cookie notice are all
  `print:hidden`. The dashboard layout's viewport-height, internally
  scrolling column and `main` are reset to plain document flow in print,
  because otherwise a long list would be clipped to one screenful.
- `globals.css` has an `@media print` block that forces a white page with
  black text, even from the dark theme and with "background graphics" on,
  and hides Sonner's toaster.

The export route (Data export) is still the spreadsheet-oriented option.
Print is the reading-oriented one.

#### Copy a list as text (GAP-53)

Sending the list to a partner at the shop or a neighbour with no account used
to mean retyping it. The `⋯` menu's **"Copy as text"** item (shown while the
list has open items, on any status) puts them on the clipboard as plain text
and confirms with a toast.

- **Format**: `formatShoppingListText` (`src/lib/shopping-list-text.ts`,
  pure, mirrors `recipe-text.ts`): the list name, then one `- 2 dl Milk` line
  per open item (no quantity: just the name). The groups are the screen's
  (`groupPendingItemsByCategory`, store order), printed under their category
  headings when at least one item has a real category; when none has, the
  list is flat rather than one "Other" heading. Ticked items are left out.
  Amounts use `formatCookQuantity` and the household's unit labels.
- **Default amount hidden (UX-86)**: quantity 1 of the default unit (`pcs`) is
  what an untouched add gets, so it shows as just the name ("Bananas", not
  "Bananas × 1 pcs") in list rows, the shopping-mode dock, the print view, the
  public share page and the copied text (`isDefaultAmount` /
  `formatShoppingItemLabel`, same file). Any other amount ("Milk × 2 l",
  "Eggs × 2 pcs", "1 l") still shows.
- **Clipboard and share**: the success toast waits for `clipboard.writeText`;
  a rejection shows an error toast. On a coarse pointer with
  `navigator.share` (`canNativeShare`, as the invite link) a **"Share as
  text"** item beside it opens the system share sheet; closing the sheet is
  not an error.
- **Deliberately not built**: no public link (the existing share link is the
  way to give someone a live list), no schema change, no new browser storage.
- **Tests**: `shopping-list-text.test.ts` (both locales, no quantity,
  grouped vs flat, ticked items left out); `e2e/copy-shopping-list-text.spec.ts`
  adds two items, copies on desktop and mobile, asserts the toast and
  clipboard text, then ticks one and asserts it drops out.

### Safe to spend

A hero stat card at the top of the Budget page's Overview tab, directly
above the due-recurring widget (`SafeToSpend`, `src/components/budget/safe-to-spend.tsx`)
— the PocketGuard-style "what's actually left" number, per the competitive
analysis. Like `PeriodSummary`/`CostAnalyzer`, it's a plain presentational
component; all aggregation happens in `src/app/dashboard/budget/page.tsx`,
which delegates the actual math to a pure, dependency-free
`computeSafeToSpend` function in `src/lib/safe-to-spend-calc.ts`
(unit-tested in the colocated `safe-to-spend-calc.test.ts` — no Prisma
import, so no mocking needed) rather than inlining it, since a Server
Component page function can't itself be unit-tested.

- **Empty budget (UX-116)**: with nothing recorded at all: no income
  (logged or expected), no recurring or due items, nothing owed from
  earlier and no logged expenses or savings (`needsSafeToSpendSetup`;
  spending without income still shows its negative number), the card shows no number and no "good shape"
  line. It says "Add your income and regular bills to see what's safe to
  spend" with two actions, "Add income" (the Transactions tab) and "Add
  regular bills" (the Manage tab), keeping the month and household in the
  URL. Once there is data the totals carry a one-line legend for the "+",
  "–" and "→" in front of them.
- **Categories near or over their limit (UX-108)**: on the budget
  Overview (household and personal), a "Near or over their limit" card sits
  right under Safe to spend and lists every capped expense category at 90%
  or more of its limit (`categoriesNearLimit` in
  `src/lib/budget-category-limit.ts`, `NEAR_LIMIT_PERCENT`). Each row has a
  warning icon, the name, "spent / limit" and either "N over" (red, past
  the limit) or "N% used"; over ones come first, then by how far in. The
  limit is the envelope Insights uses (monthly limit plus any rollover
  carried in), and the list reads the same rows as Insights' "Expenses by
  category", so the two tabs agree. A row links to Transactions filtered to
  that category. With no such category the card isn't rendered. When the
  number's status is healthy but the list isn't empty, the status line
  reads "N categories are at or near their limit." instead of "You're in
  good shape…"; a tight or over status keeps its own line.
- **The headline number** ("Remaining after expenses and savings"): the
  selected month's income so far, minus that month's expenses and savings
  so far (the same totals `PeriodSummary` computes from the page's
  month-scoped `transaction.findMany` query, see "Month navigation" above),
  minus everything still due this month (below). Savings is subtracted
  too — money moved into a `SAVINGS` category is money that's no longer
  safe to spend, same as an expense already paid, even though it isn't a
  cost. `computeSafeToSpend` returns each term separately (`breakdown`) as
  well as the total.
- **What's still due — recurring items first**: `computeSafeToSpend` takes
  the month's recurring items with their status (`templates`, from
  `computeTemplateStatuses` — see "Recurring budget templates" above).
  Every active item still `"due"` is subtracted at its full amount: an
  `EXPENSE` item as a *due payment*, a `SAVINGS` item as a *due saving*.
  A due `INCOME` item (a salary not logged yet) is *added* at its full
  amount as *expected income* (`breakdown.dueIncome`). Income items used to
  be ignored, so every future month showed its recurring bills and savings
  but none of the income paying for them. A `"posted"` item counts only
  through the transaction logged from it, even when that was for less than
  the item says: a 5000 saving logged as 3000 means 3000 was saved and the
  other 2000 is spendable, not still owed (likewise a salary logged lower
  than planned counts at what came in). `"acknowledged"` counts as handled.
  Before this, only expense categories were estimated, so a recurring
  saving was never subtracted until it was logged. The "tight" status is
  judged against income so far plus expected income, so a future month
  with nothing logged still gets one.
- **Planned bills**: `computeSafeToSpend` also takes an optional
  `plannedExpenses` list (default `[]`, so nothing changes without any). Every
  `due` or `overdue` planned bill is subtracted at its full amount as a due
  payment under its own name (see "Planned bills" below). They are
  deliberately not merged into `templates`: that input also decides which
  categories skip the fallback estimate below, and a one-off bill must not
  switch off a category's "this repeats" estimate. Planned income comes in
  the same list with `type: "INCOME"` and is added as expected income, but
  only while `due` (see "Planned income" below).
- **Fallback estimate for categories without a recurring item**: for every
  `EXPENSE` category with at least one `isRecurring` transaction dated
  before the selected month and *no* active recurring item, check whether
  it already has any transaction dated in that month. If not, the amount of
  its most recent recurring transaction (by `date`) is treated as "expected
  but not yet logged". Categories that do have a recurring item are
  skipped here, so a bill is never counted twice. This is the original,
  best-effort heuristic (it can't tell "not due yet" from "not entered"),
  kept so households that only ever ticked "this repeats" keep getting an
  estimate. Fed from a trailing 12-month window ending at the selected
  month (rather than the household's entire history — see SCALE-F,
  BACKLOG.md) so "most recent recurring transaction" has enough history to
  find a WEEKLY/MONTHLY/YEARLY bill's last occurrence without re-fetching
  every transaction the household has ever logged; `computeTemplateStatuses`
  shares the same window for the same reason.
- **Personal budget and the dashboard**: `loadPersonalBudgetPosition`
  (`src/lib/personal-budget-position.ts`) loads and computes everything
  Personal Budget's number needs, and the dashboard's "Your budget" card
  calls the same loader, so the two always show the same number. The card
  used to run its own simplified copy of the math that left out shared
  bills, debts to household members and due items. For the personal
  budget:
  - The user's *share* (`amountOwed`) of a split household bill counts as
    an expense in the bill's month, whoever actually paid it. Paying more
    than your share doesn't make you poorer (the others owe it back), and
    paying less doesn't make you richer (you still owe the rest), so paying
    a member back later doesn't move the number a second time.
  - **Owed from earlier months**: what the user still owed when the month
    started is subtracted again (debts carry over until cleared): their net
    debt to other members plus their unpaid share of older bills, from
    `computeMemberPosition` in `settle-up-calc.ts` as of `monthStart`.
    Money others owe the user from earlier months is *not* added back,
    since it isn't spendable until they pay. `TransactionSplit.amountPaid`
    isn't dated, so paying off an old bill's remainder counts as if it had
    been paid on time.
  - Due payments and due savings include the user's share of shared
    recurring items that are still due (the "Rent pops up" rows). A
    household `RecurringTemplate` is shared with the user when it has a
    `RecurringTemplateSplit` row for them or, failing that, when the latest
    bill logged from it (up to the viewed month) was split with them. The
    second case covers bills split by hand each time they're logged, which
    used to vanish from every month they hadn't been logged in yet. Their
    share is that bill's split scaled to the template's current amount,
    and a payer-only share (0 owed) doesn't count. A shared recurring
    `INCOME` item's share counts as expected income, the same way a posted
    split income already counts as income.
  - The user's share of every unpaid, due or overdue **planned bill** also
    counts as a due payment, shown as a "Shared" row with the household's
    name (see "Planned bills"). Unlike shared recurring rows it offers no
    "Log payment" here: a planned bill is logged from the household budget.
  - Under the number, "Your household balance" shows where the user stands
    per household at the end of the month (`householdDebts`): what they owe
    other members or are owed, and their unpaid share of bills, with a
    "Settle up" link to that household's budget, Insights tab
    (`?tab=insights`, which `BudgetTabs` reads from the URL).
  - **Insights (BUDGET-7)**: the same shares feed the Insights tab. Its
    month totals and per-category bars come straight from the loader's
    totals, so a split bill's share shows there as "<category> (Shared)".
    The "Fixed income & costs" card (`computePersonalFixedInsights`,
    `src/lib/personal-fixed-insights.ts`) adds the user's share of every
    active shared recurring item (`sharedFixedTemplates`, the same shares as
    above, due or not) to the fixed monthly totals, the recurring
    income/costs breakdown ("<name> (Shared)") and so the
    balanced/tight/deficit status; and their share of bills logged from a
    household recurring item over the last 12 months to the trend chart.
    That trend has its own query (the user's own `TransactionSplit` rows via
    their memberships, `amountOwed > 0`), since it runs back from today
    while the loader's split bills stop at the end of the viewed month.
    Only the user's own share is ever read, never a whole bill or another
    member's row. Personal savings goals still count only the user's own
    transactions.
- **The breakdown**: beneath the headline number, one line per term
  (income, expenses, savings, and — only when non-zero — expected income,
  owed from earlier months, due payments, due savings) adding up to
  "Remaining after expenses and savings", then a "Still due this month"
  list of every item counted as due (name + amount; savings tinted
  `text-chart-2` with a "Saving" badge, expected income `+` in
  `text-success` with an "Income" badge, payments `text-destructive`,
  shared items badged "Shared") — so the number is never a black box. The
  list is hidden when nothing is due.
- Same `createMoneyFormat` display-currency convention as the rest of
  Budgeting (GAP-13); the headline number is colored `text-success` (safe/positive)
  or `text-destructive` (negative — spending is on track to exceed income)
  the same way `PeriodSummary`'s net figure is.
- **Projected end of month (UX-39)**: in the current month, under the
  number, a small line chart ("At this pace"): solid for what was safe to
  spend at the end of each day so far, dashed from today to the last day at
  the month's everyday pace, and a sentence with the projected figure
  ("About 1 200 kr left at the end of the month", or "… over", in
  `destructive` with a warning icon). `projectMonthEnd`
  (`src/lib/chart-calc.ts`) sets the pace from *everyday* spending only:
  `EXPENSE` transactions neither logged from a recurring item nor ticked
  "this repeats", since bills are already in the number. No line for a
  past or future month, or before any everyday spending. The household page
  computes it from the month's transactions; `loadPersonalBudgetPosition`
  returns it as `safeToSpendProjection`, so Personal Budget and the
  dashboard card show the same line.
- **Daily allowance and labelled chart (UX-117)**: in the current month a
  line under the headline answers "how much can I spend today?": "≈ N per
  day for the D days left" (`dailyAllowance` in `src/lib/chart-calc.ts`:
  the headline divided by the days left *including today*, so the last day
  reads "≈ N for today, the last day of the month"). No line for a past or
  future month, or when the headline is zero or negative (the status line
  already says so; a negative "per day" would read as a target) or
  non-finite. Unlike the projection it doesn't need any spending yet. The
  household page computes it; `loadPersonalBudgetPosition` returns it as
  `safeToSpendDaily` for Personal Budget and the dashboard. The chart's
  "Today" and "Month end" labels carry their amounts; past the middle of
  the month "Month end" drops to a second line so the two don't collide.
  The headline itself still counts to its new value through
  `AnimatedNumber` after an add. Calm by design: no mascot on money.
- **Due card and Manage placement (UX-118)**: the Overview's "Due this
  period" card tells three empty states apart. No active recurring item at
  all: "Set up recurring bills and income…". Items exist, but none did yet
  in the viewed month (a template never backward-propagates, so a month
  before they were created lists none): "Nothing was due this month".
  Otherwise, nothing left to log: "You're all caught up". Its "Manage
  recurring items" is a link-styled button. The compact Safe to spend card's
  "How we got this number" holds the arithmetic only; the still-due list is
  the Due card's alone, so no item appears twice. On Manage, "Add category",
  "Add recurring item" and "Add planned bill" all sit top right of their
  panel, level with its title, on phones too.

### Household expense splitting

Lets a `Transaction` optionally record who paid and how its cost is
divided among household members (Splitwise's pattern) — opt-in per
transaction, so a transaction with no split behaves exactly as it always
has. Two new Prisma models/fields, added via a hand-written migration
(`prisma/migrations/20260905120000_add_transaction_splits/`) since this is
a real schema change, unlike the schema-free Wave 1 tasks:

- **`TransactionSplit`** — one row per member included in a split
  transaction (`transactionId`, `householdMemberId`, `amountOwed` — their
  share — and `amountPaid` — what they've paid towards the bill itself),
  unique per `(transactionId, householdMemberId)`. A member can pay more
  than their share, less, or nothing, so a bill can be paid partly by
  several members: pay 3000 of a shared 6000 bill and 3000 shows as left
  due. A member who paid without owing a share gets a row with
  `amountOwed: 0`. This replaced a single `Transaction.paidByMemberId`
  ("who fronted the whole bill"); migration
  `20260925050231_partial_payments_and_settlements` backfilled it as "the
  payer paid the whole amount" before dropping the column, and marked
  every member of a split whose payer had since left the household as
  having paid their own share, since those never produced a balance
  before. No
  `householdId` column — scoped through its parent `Transaction`, the same
  convention `PriceHistory`/`RecipeIngredient` already use for a
  household-scoped child row. `amountOwed` is an absolute currency amount,
  not a percentage/share — the simplest, least-surprising representation,
  and what the balances view can sum directly. Its `HouseholdMember`
  relation is `onDelete: Cascade`: an ex-member's own split rows are simply
  removed with them — a known simplification for an edge case explicitly
  out of scope for this task (nothing re-normalizes the remaining splits
  to still sum to the transaction's total if a member with an outstanding
  split leaves).

- **`MemberSettlement`** — a repayment between two members
  (`fromMemberId` paid `amount` to `toMemberId` on `date`), recorded with
  "Clear debt" below. Both member relations cascade, like
  `TransactionSplit`'s, so a leaving member's balance goes as a whole.

**Recording a split** (`TransactionDialog`,
`src/components/budget/transaction-dialog.tsx`, and Personal Budget's
`LogSharedExpenseDialog`, which share `SplitEditor`,
`src/components/budget/split-editor.tsx`): only offered when the
household has more than one member (`members.length > 1`, fetched by
`src/app/dashboard/budget/page.tsx` alongside categories/transactions). A
"Split this expense" checkbox reveals one row per household member with a
"Share" and a "Paid" input. "Paid" defaults to the signed-in member paying
the whole amount (following the amount field until the user edits a
payment), and the editor shows how much is still left to pay. Shares
start as an even split of the amount and follow it (typing or changing
the amount, or ticking the box afterwards, never shows 0.00 shares and a
mismatch error) until one share is edited; a saved split (editing, a
template's) is never overwritten (UX-111). "Split evenly" re-arms the
following. The even split is
(`evenSplitAmounts` in `src/components/budget/split-amounts.ts` — a pure,
unit-tested cents-based helper so the shares always sum exactly to the
total instead of drifting from naive floating-point division), individually
adjustable afterward. The dialog shows
a live warning and disables submit whenever the shares don't (yet) sum to
the transaction total or the payments add up to more than it
(`checkSplitForm`, `split-amounts.ts`); `createTransactionAction`/
`updateTransactionAction` (`src/app/dashboard/budget/actions.ts`)
re-validate the same invariants server-side (`parseSplitFormData`, ±0.01
floating-point tolerance) plus that every referenced member id actually
belongs to the caller's household, the same "never trust a client-supplied
id beyond re-checking it" rule every other action in this file follows.
Payments may add up to less than the total; the rest is still due. A
member with no share who paid nothing is dropped from the split.
"Log as-is" on a split recurring item records the whole bill as paid by
whoever clicked it.
Editing an existing split transaction pre-fills every field from its
current `TransactionSplit` rows and replaces them wholesale on save
(delete-all then recreate in one `$transaction`), the same convention
recipe-ingredient editing already uses. `TransactionList`
(`src/components/budget/transaction-list.tsx`) shows a "Split" badge
(hover tooltip naming who paid how much) next to a split transaction's
category badge, plus an "{amount} left due" badge while part of it is
unpaid. Personal Budget's shared rows say who paid and what's left due the
same way.

**"Who owes whom"** (`HouseholdBalances`,
`src/components/budget/household-balances.tsx`) — on the Budget page's
Insights tab, shown only when the household has more than one member.
**UX-114:** when something is owed (a simplified transfer or an unpaid bill)
it is the first card on the tab, ahead of the period summary and charts;
with nothing owed it stays last.
Covers every split bill and repayment the household has, not just the
month on screen: a debt carries over until it's cleared. (It used to be
scoped to the selected month, so an unpaid August debt silently vanished
in September.) That is a statement about the numbers, not the queries
(PERF-12): a bill where every member paid exactly their share and nothing
is left unpaid has an all-zero position, so `loadUnsettledSplitBills`
(`budget/page.tsx`) skips it in SQL (`isSettledBill` is the tested
definition its `HAVING` clause negates), and repayments arrive as one
`groupBy` sum per payer/receiver pair (`sumTransfersByPair` is the same
reduction, tested), with only the newest 10 rows fetched for the list. The
balances, suggested transfers and "left due" list are identical to
summing the full history; the work scales with open bills, not every bill
ever split. All netting and debt-simplification logic is pure and
unit-tested in `src/lib/settle-up-calc.ts` (moved from
`src/app/dashboard/budget/` since Personal Budget uses it too):

- `computeBillPositions` splits one bill into what each member owes the
  *other members* and what's still owed *to the bill*. A member who paid
  more than their share is owed the difference; a member who paid less
  still has the difference outstanding. The shortfalls cover both the
  overpayments and the bill's unpaid remainder, split in proportion. With
  two members that's exact: pay 4000 of a 6000 bill split 3000/3000 and
  your partner owes you 1000 and the bill 2000. With three or more it's a
  fair approximation, since nothing records whose shortfall an
  overpayment was meant to cover. Money still owed to a bill is nobody's
  debt to another member.
- `computeNetBalances` nets every bill's member-to-member part plus every
  `MemberSettlement` (the payer's balance goes up, the receiver's down)
  down to one balance per member.
- `simplifyDebts` then applies Splitwise's debt-simplification pattern
  (greedily matching the largest debtor against the largest creditor) to
  reduce those balances to the **minimum number of settle-up transfers**,
  not a raw list of every individual split — e.g. if Alice paid for
  everyone and Bob separately paid Carol back for something unrelated, the
  view nets straight to "Bob owes Alice X", never surfacing Carol at all
  once her balance is zero.
- `computeMemberPosition` is one member's balance and unpaid bill share
  counting only bills and repayments dated before a given day — how
  Personal Budget works out "owed from earlier months" (see "Safe to
  spend").
- **Clear debt**: each suggested transfer has a "Clear debt" button
  opening a dialog pre-filled with the whole amount and today's date;
  lowering the amount records a partial repayment.
  `recordSettlementAction` re-checks both members against the caller's
  household and doesn't cap the amount (a rounded-up repayment is real;
  the excess just shows as a balance the other way). Below the transfers
  the card lists split bills with money still due, and the 10 most recent
  repayments, each removable (`deleteSettlementAction`) in case one was
  entered by mistake.
- **Pay with Swish** (GAP-7): when the signed-in member owes someone who
  has saved a Swish number on their Profile, that transfer also gets a
  "Pay with Swish" link next to "Clear debt". It's Swish's app-switch deep
  link, `swish://payment?data=<url-encoded JSON>` — no merchant agreement
  or API key — with `version: 1` (a number; the string `"1.0"` breaks it),
  `payee` as the Swish alias (`46` + the mobile number without its leading
  0), `amount` rounded to two decimals, and a translated message
  (`balances.swishMessage`) sanitized to the characters Swish accepts and
  capped at 50. Every field is sent with `editable: false`: leaving any
  field open also unlocks the payee, and the link is meant to pay exactly
  this debt to exactly this person. The format isn't in Swish's public
  developer docs (those only cover the merchant `paymentrequest` flow), so
  it follows the documented-in-the-wild shape — see `src/lib/swish.ts`'s
  header comment. All of it is pure and unit-tested in
  `src/lib/swish.test.ts` (`normalizeSwishNumber`, `formatSwishNumber`,
  `sanitizeSwishMessage`, `buildSwishPaymentUrl`, `swishNumbersForPayer`).
  - Only the payer sees it: the page passes the component just the numbers
    of members the signed-in member owes a positive amount
    (`swishNumbersForPayer`), and `HouseholdBalances` re-checks
    `fromMemberId === currentMemberId` before rendering a link, so nobody
    else's number reaches the browser for no reason.
  - Swish only moves SEK. The page passes `swishSupportsCurrency` the
    household's display currency (GAP-13), falling back to
    `HOUSEHOLD_BASE_CURRENCY` (`src/lib/currency.ts`, `"SEK"`) when it's
    unset, so the link shows only for a SEK or unset household. A household
    that picked EUR is taken at its word and gets no Swish link. The
    link's aria label already says "kr", so it takes the plain number
    rather than a second symbol.
  - Tapping it records nothing. The app can't see whether a Swish payment
    went through, and money changes are always an explicit action
    (BACKLOG.md's Guardrails), so a hint under the list tells the payer to
    use "Clear debt" once the money has gone.
  - **The number** is `User.swishNumber` (nullable, migration
    `20260925205015_add_user_swish_number`), stored in alias form. It's on
    `User`, not `HouseholdMember`: it's personal data the user sets once,
    and the same person in two households gets paid on the same phone.
    Only the user can set it, from the "Swish number" card on their Profile
    (`SwishNumberForm`, `updateSwishNumberAction` — user id from the
    session, blank clears it). The card says outright that the number is
    shown to household members. `normalizeSwishNumber` accepts
    `07XXXXXXXX`, `+467XXXXXXXX`, `00467XXXXXXXX` and `467XXXXXXXX` with
    any spaces, hyphens, dots or parentheses (and `+46 (0)7…`), and rejects
    landlines and foreign numbers; the form shows it back as
    `070-123 45 67`. It's part of the Profile's "Export my data" JSON
    (`profile.swishNumber`), goes with the `User` row when the account is
    deleted, and is listed on the privacy page.
- Every action that writes split transactions or repayments revalidates
  the household budget, Personal Budget and the dashboard
  (`revalidateBudgetPages`), since all three show numbers derived from
  them.

**User profile** (built)
- `/dashboard/profile` (`src/app/dashboard/profile/page.tsx`) lets the
  signed-in user edit their own `displayName`, email, and password, and
  shows a generated avatar. The page composes three independent forms
  (`src/components/profile/display-name-form.tsx`,
  `email-form.tsx`, `password-form.tsx`) rather than one form mixing
  unrelated submits — the same one-concern-per-`<form>` shape as
  `login-form.tsx`/`signup-form.tsx` — each backed by its own action in
  `src/app/dashboard/profile/actions.ts`. All three re-derive `userId` from
  `requireHousehold()`, never from client input.
  - **Avatar**: `src/components/profile/avatar.tsx`'s `UserAvatar` renders a
    circle with the user's initials (from `displayName`) on a background
    color picked by hashing a stable seed (the `userId`, not the display
    name, so the color doesn't change when someone edits their name) into
    the existing `--chart-1..5` tokens. It's entirely computed — no upload,
    no stored image, no `User.avatarUrl` column, no migration. This was the
    deliberate choice over real file upload: the codebase has no
    file/blob-storage integration at all (no S3/Vercel Blob/Cloudinary),
    and building one would be new infrastructure out of scope for this
    slice, plus a real risk on serverless deploy targets where local
    filesystem writes don't persist. A purely computed avatar needs nothing
    persisted, so there's nothing to keep in sync or migrate.
  - **Email change** (`updateEmailAction`): email is the login identifier,
    so a naive, unverified swap would be a real account-takeover path —
    anyone with a hijacked or left-open session could lock the real owner
    out just by typing a new address. The action requires the current
    password (verified with `bcrypt.compare` against `passwordHash`, same
    as the Credentials provider's `authorize` in `src/lib/auth.ts`) before
    the email changes, plus the usual format/uniqueness checks. Password
    re-verification is a deliberate choice here, not a stand-in for missing
    infrastructure: email delivery via Resend has since landed (see "Invite
    email delivery" above, and `PasswordResetToken`/`EmailVerificationToken`
    in the Data model), so a send-a-confirmation-link flow is buildable now.
    But re-entering the password already re-proves account ownership, not
    just session possession, which is the realistic threat this guards
    against — a confirmation-link flow would additionally guard against a
    hijacked *session* stealing the account outright, which is a real gap,
    but `updateEmailAction` hasn't been revisited to add it since this
    bullet was written.
  - **Password change** (`updatePasswordAction`): current password + new
    password + confirmation, hashed with the same `bcryptjs` approach
    (`bcrypt.hash(newPassword, 12)`) signup already uses in
    `src/lib/actions/auth.ts` — not a different scheme. On success the
    action calls `signOut({ redirectTo: "/login" })`, forcing
    re-authentication with the new password, since rotating a credential
    should invalidate the session that changed it. It also sets
    `User.passwordChangedAt`, which revokes every *other* session for the
    account too — see "Session revocation on password change" under
    "Access control".
  - **Re-auth throttling (SEC-6)**: `updateEmailAction`, `updatePasswordAction`
    and `deleteAccountAction` all re-prove account ownership with the
    current password before doing anything security-sensitive (see the two
    bullets above), but that `bcrypt.compare` was previously uncapped — a
    hijacked or left-open session could brute-force the hash without ever
    touching login's own rate limit. Each of the three now calls
    `checkRateLimit("reauth:<userId>", 5, 15 minutes)`
    (`src/lib/rate-limit.ts`) before comparing, keyed by `userId` only so
    attempts against any of the three actions share one budget — switching
    which action you try doesn't reset the clock. A throttled attempt
    returns the translated `profile.reauthRateLimited` string (`en.ts`/
    `sv.ts`) without ever calling `bcrypt.compare`.

### Planned bills

A known, non-recurring bill with a due date (a car repair or dentist invoice
due 20 Nov, split 50/50) that should count as due in the household budget,
and in each participant's personal budget, until it's paid (BUDGET-8).
Expected one-off income uses the same tables (see "Planned income" below).
Planned savings and purchases without a date,
several partial payments against one bill, and reminders and push
notifications are out of scope. A bill that only concerns one person goes
on their personal budget instead (see "Personal planned bills" below).

It's its own pair of tables rather than a `Transaction.status` or a `ONCE`
`RecurringTemplate` frequency. A status column would need a filter in every
existing sum (period summary, category budgets, balances, settle-up,
exports), and a missed one would silently count unpaid money as spent.
Templates are built around per-period keys that reset each period, the
opposite of "carry forward until paid". Migration
`prisma/migrations/20261015120000_planned_expenses/`:

- **`PlannedExpense`**: `householdId`, `categoryId` (an `EXPENSE` category),
  `name`, `amount`, `dueDate`, `createdByUserId`. Due dates are calendar days
  stored at UTC noon (`parseDueDate`), so no timezone moves the day.
- **`PlannedExpenseSplit`**: one row per member with an expected share
  (`amountOwed`), unique per bill and member, cascading with both parents.
  Shares are absolute amounts that sum to the bill's `amount` (±0.01), the
  same rule as `RecurringTemplateSplit`. No rows means unsplit, which still
  counts in the household's safe to spend. Only the expectation: who really
  paid is whatever the logged transaction's own `TransactionSplit` rows say.
  When a member leaves, their share rows go with them (cascade), the same
  tradeoff as `RecurringTemplateSplit`: the remaining shares no longer sum
  to the amount. The household total is unaffected (it counts the bill's
  `amount`), and opening the bill's edit dialog shows the mismatch and
  blocks Save until the shares are fixed or the split is turned off.
- **`Transaction.plannedExpenseId`**, nullable and `@unique`. A bill is
  **paid** when a transaction links to it, so "paid" is derived and never
  stored, and the database guarantees a bill is logged at most once.

**Status** (`getPlannedExpenseStatus`, `src/lib/planned-expense-calc.ts`,
pure and unit-tested) is judged against the month on screen, not today.
`paidAt` is the linked transaction's date:

| Status     | Condition                                          |
|------------|----------------------------------------------------|
| `paid`     | `paidAt` is set and before the month's end         |
| `upcoming` | not paid, due on or after the month's end          |
| `due`      | not paid, due inside the month                     |
| `overdue`  | not paid, due before the month started             |

"Not paid" includes a payment dated after the month, so a bill due in
October and paid on 3 November is still `due` when October is viewed:
past months show what was due at the time and don't change when a bill is
settled later.

**Where it counts.**

- *Household safe to spend*: `due` and `overdue` bills, at the full amount,
  in the breakdown's due payments (see "Safe to spend"). A `paid` bill counts
  only through its transaction. Category budgets and the period summary are
  untouched: an unpaid bill is never "spent" in its category.
- *Personal budget*: `loadPersonalBudgetPosition` reads the user's
  `PlannedExpenseSplit` rows (their member ids, bill due before the month's
  end and not paid before the month's start, the Budget page's filter) and
  adds each `due`/`overdue` bill at their `amountOwed` as a shared
  due row, folded into the same "not yet logged" reduction as shared
  recurring items. Only members with a share see it.
- *Budget page* (`src/app/dashboard/budget/page.tsx`): loads bills due before
  the month's end that weren't paid before its start, plus upcoming ones, so
  the query and list don't grow with history.

**UI.** `PlannedExpensesPanel` (`src/components/budget/planned-expenses-panel.tsx`)
sits in the Manage tab under the recurring items, grouped Overdue, Due this
month, Upcoming and Paid (paid in the viewed month only). Rows offer Log
payment, Edit and Delete (confirmed); a row with a linked payment offers
only Edit. That includes a past month's bill paid later: it still shows as
due there, with "Paid {date}" after its due date, since a second payment
would be refused and deleting it would silently detach the real one
(`PlannedExpenseRow.paidAt`). The dialog keeps the typed name and category
when the server rejects a save (UX-13).
`PlannedExpenseDialog` has name, amount, category (a searchable combobox),
due date and, when the household has more than one member, an opt-in
share-only split section pre-filled with `evenSplitAmounts`, the same UI
`RecurringTemplateDialog` uses rather than `SplitEditor`, whose "Paid" column
means nothing before anything is paid. `DueRecurringWidget` also lists due
and overdue bills with the same Log payment action (likewise hidden once a
payment is linked).

**Logging a payment.** Log payment opens the normal `TransactionDialog`
pre-filled (name, amount, category, planned shares, the current member as
payer) through `TransactionTemplatePrefill`, extended with
`plannedExpenseId`. Saving toasts "{name} marked as paid." rather than the
recurring item's "logged for this period".
Everything stays editable, so the transaction may differ from the plan and
one payment closes the bill at whatever amount was logged. In Personal
Budget, `SharedDueRow` gained `householdId` and an optional `logPrefill`,
left unset for planned bills. `createTransactionAction`
(`src/app/dashboard/budget/actions.ts`) sets the link only on creation
(editing a transaction leaves it alone) and rejects a bill from another
household, one already paid, or a payment in a non-`EXPENSE` category, with
localised errors (`fail()`). A race between two payments hits the unique
index, and the `P2002` on `Transaction_plannedExpenseId_key` is mapped to the
same "already paid" error. With the pg driver adapter the violated
constraint is under `meta.driverAdapterError`, not `meta.target`, so
`isPlannedExpenseTarget` checks both.

**Actions** (`src/app/dashboard/budget/planned-expense-actions.ts`, apart
from `actions.ts`, which is already 1 000+ lines): `createPlannedExpenseAction`
and `updatePlannedExpenseAction` validate with Zod (name, amount > 0, an
`EXPENSE` category of the household, a real calendar date) and the shared
split parser (`src/lib/share-split-form.ts`: shares sum to the amount,
members belong to the household); update replaces the splits wholesale in one
`$transaction` and is allowed on a paid bill without touching its
transaction. `deletePlannedExpenseAction` is a household-scoped click action.
Errors are localised through `fail()`/`zodFail()`. All revalidate the budget,
personal budget and dashboard.

**Deleting.** Deleting a bill sets its transaction's `plannedExpenseId` to
null (`onDelete: SetNull`): the transaction survives as an ordinary one.
Deleting the transaction makes the bill unpaid again. A category a bill
uses can't be deleted (the relation is `Restrict`): `deleteCategoryAction`
names the bill, as it does a recurring item, instead of failing on the
foreign key.

Covered by `planned-expense-calc.test.ts`, `planned-expense-actions.test.ts`,
the `safe-to-spend-calc` and `personal-budget-position` tests, and
`weekly-digest.test.ts`, the budget `actions.test.ts`, the export route's
test, and `e2e/planned-expenses.spec.ts` (desktop and mobile). Touches
`AUTOPILOT.md`'s human-only money areas, so the owner reviews and merges.

#### Personal planned bills

The same one-off bill with a due date on Personal Budget, for a cost that
only concerns the signed-in user (a dentist visit, a course fee). Nobody
else sees it, and it never touches a household's numbers.

- **Schema** (migration
  `prisma/migrations/20261019120000_personal_planned_expenses/`):
  `PersonalPlannedExpense` (`userId`, `categoryId` of an `EXPENSE`
  `PersonalBudgetCategory`, `name`, `amount`, `dueDate` at UTC noon) and
  `PersonalTransaction.plannedExpenseId`, nullable, `@unique` and `SetNull`,
  mirroring `PlannedExpense` and `Transaction.plannedExpenseId`. A straight
  duplicate rather than a nullable `householdId` on `PlannedExpense`, the
  convention every `Personal*` table follows. No split table: one person.
- **Status** is `getPlannedExpenseStatus`, unchanged, and paid is derived
  from the linked transaction as on the household side.
- **Where it counts.** `loadPersonalBudgetPosition` loads the user's bills
  (unpaid, or paid on or after the viewed month's start, so the query
  doesn't grow with history) and passes them to `computeSafeToSpend` as
  `plannedExpenses`: `due` and `overdue` ones are subtracted at their full
  amount as the user's own due payments, on Personal Budget and on the
  dashboard's "Your budget" card, which share the loader. It also returns
  them (`plannedExpenses`) for the page.
- **UI.** The same `PlannedExpensesPanel` and `PlannedExpenseDialog` on
  Personal Budget's Manage tab, under the recurring items, with
  `members={[]}` (so no split section) and `dict.personalBudget`, whose
  `planned` texts drop the split ones (`PlannedDict` in `budget-dict.ts`
  makes those optional). Outstanding bills also show in the Overview's due
  strip with Log payment. Log payment opens `TransactionDialog` prefilled,
  and the toast reads "{name} marked as paid." on both budgets.
- **Actions** (`src/app/dashboard/personal-budget/planned-expense-actions.ts`):
  create, update and delete, scoped by `requireUserId()`, validated like the
  household's (`parseDueDate` now lives in `planned-expense-calc.ts` for
  both). `createPersonalTransactionAction` links a payment on creation only,
  and rejects another user's bill, one already paid, or a non-`EXPENSE`
  category; the unique-index race maps to "already paid" through
  `isPlannedExpenseTarget` (`src/lib/prisma-errors.ts`, shared with the
  household action). `updatePersonalTransactionAction` keeps a linked
  payment in an `EXPENSE` category. `deletePersonalCategoryAction` names a
  bill that still uses the category.
- **Export.** `personalPlannedExpenses` and
  `personalTransactions[].plannedExpenseId` are in the account data export.

Covered by the personal `planned-expense-actions.test.ts` and
`actions.test.ts`, `personal-budget-position.test.ts`,
`planned-expense-calc.test.ts`, the export route's test, and
`e2e/personal-planned-expenses.spec.ts` (desktop and mobile).

#### Planned income

A one-off income expected on a date: a bonus, a tax refund, a win. It
works on both budgets (household and personal) and counts in Safe to
spend in its month before it arrives, the same way a planned bill does.
Logging income that has already arrived needs nothing new: it's an
ordinary `INCOME` transaction.

- **No new table.** A planned item's type is its category's: a
  `PlannedExpense` or `PersonalPlannedExpense` in an `INCOME` category is
  planned income. The planned-item actions (both
  `planned-expense-actions.ts`) accept an `EXPENSE` or `INCOME` category of
  the caller's own and refuse a savings one as "Category not found".
  `plannedItemType` (`src/lib/planned-expense-calc.ts`) maps a category type
  to `"EXPENSE" | "INCOME"` for the rows and the calculator.
- **Never split.** A member's share of expected income would have to be
  added to their personal budget as income, which nothing reads
  (`loadPersonalBudgetPosition` only counts planned shares as costs). The
  dialog shows no split section for income, and the household actions refuse
  a split on an income category ("Planned income can't be split").
- **Status** is `getPlannedExpenseStatus`, unchanged; received is derived
  from the linked transaction, as paid is for a bill.
- **Where it counts.** `isPlannedItemCounted(status, type)` decides: a bill
  counts while `due` or `overdue`, income only while `due`, in the month it's
  expected. Income that didn't arrive may never come, and carrying it forward
  would keep promising money that isn't there, so once its month is over it
  stops counting and isn't listed in the due strip. It stays on the Manage
  tab under "Not received" (orange `attention` text and an icon, not
  destructive: it's something to look into, not money owed) with Log income,
  until it's logged or deleted. `computeSafeToSpend` adds counted income as
  expected income (`dueIncome`) under its own name. The household Budget page,
  the dashboard's household card (`loadHouseholdSafeToSpend`), the weekly
  digest and `loadPersonalBudgetPosition` all pass each item's type.
- **UI.** A second `PlannedExpensesPanel` with `kind="INCOME"` sits under
  Planned bills on each budget's Manage tab, listing only income rows and
  offering only income categories. Its texts are `dict.budget.plannedIncome`
  and `dict.personalBudget.plannedIncome` (`plannedTexts` in `budget-dict.ts`
  picks bills' or income's): groups Not received, Expected this month,
  Upcoming and Received, "Expected {date}", "Received {date}", the action
  "Log income" and the toast "{name} marked as received." (through
  `TransactionTemplatePrefill.plannedType`). Each panel is a region named by
  its title, so the two "Upcoming" groups can be told apart. Income due this
  month also shows in the Overview's due strip with Log income. With no
  category of the panel's kind its Add button is disabled, so either panel's
  empty state then says to add one under Categories first (`needsCategory`)
  instead of inviting a click that can't happen.
- **Logging it.** Log income opens the prefilled `TransactionDialog`, like
  Log payment. `createTransactionAction` and `createPersonalTransactionAction`
  require the transaction's category to have the planned item's type ("Planned
  income can only be logged in an income category"; a bill keeps its "can
  only be paid from an expense category"), and refuse income already received
  ("This planned income is already received"). The update actions keep a
  linked transaction on its planned item's side of the budget the same way,
  and editing a paid bill or received income can't move it between an
  expense and an income category ("A paid bill or received income can't move
  between expense and income categories"); an unsettled one can. Deleting
  a category still used by planned income names it ("used by the planned
  income …").

Covered by `planned-expense-calc.test.ts`, `safe-to-spend-calc.test.ts`,
`household-safe-to-spend.test.ts`, `personal-budget-position.test.ts`, both
`planned-expense-actions.test.ts` and `actions.test.ts`, and
`e2e/planned-income.spec.ts` (desktop and mobile). Touches `AUTOPILOT.md`'s
human-only money areas, so the owner reviews and merges.

### Budget component unification

`/dashboard/budget` (household) and `/dashboard/personal-budget` (personal)
used to each render their own copy of the same ~10 presentational
components (`TransactionDialog`/`PersonalTransactionDialog`,
`TransactionList`/`PersonalTransactionList`, etc.) — file-for-file
duplicates that had already started drifting (a Wave-1 UI fix landing on
one side and not the other). `docs/archive/PERSONAL_BUDGET_UNIFICATION.md`
is the design spike that scoped the fix into five sequential backlog items
(BUDGET-2 → BUDGET-5); this section documents BUDGET-2, the first and
largest of them.

**What merged.** Five component pairs collapsed into one file each, now
living only under `src/components/budget/`:
`transaction-dialog.tsx` (`TransactionDialog`), `transaction-list.tsx`
(`TransactionList`), `recurring-template-dialog.tsx`
(`RecurringTemplateDialog`), `recurring-templates-panel.tsx`
(`RecurringTemplatesPanel`), and `due-recurring-widget.tsx`
(`DueRecurringWidget`). The five `personal-*` equivalents under
`src/components/personal-budget/` are deleted; both pages now import the
same component. `CategoryManager`/`AddCategoryDialog` followed in BUDGET-3
(see "CategoryManager (BUDGET-3)" below), and `BudgetTabs`/
`PersonalBudgetTabs` followed in BUDGET-4 (see "BudgetTabs (BUDGET-4)"
below). `BudgetOnboarding`/`PersonalBudgetOnboarding` stay duplicated for
now — they differ in more than a mechanical way (a missing starter-category
picker on the personal side) and need a product decision first; that's
BUDGET-5 in `BACKLOG.md`.

**What stayed separate, on purpose.** The two Prisma model families
(`BudgetCategory`/`Transaction`/`RecurringTemplate`/`RecurringTemplateAck`
vs. their `Personal*` counterparts), both `actions.ts` files, and both
`page.tsx` Server Components are untouched — the data layer is an
intentional duplication (see `PersonalRecurringTemplate`'s doc comment in
`prisma/schema.prisma`) that this merge doesn't revisit.

**How one component serves both scopes:**

- **Household-only UI (expense splitting) suppresses itself on an empty
  array.** `TransactionDialog`/`TransactionList`/`RecurringTemplateDialog`/
  `RecurringTemplatesPanel` already gated every split-related section
  behind `members.length > 1` before this merge — the personal budget page
  simply passes `members={[]}` and `currentMemberId=""`, which reproduces
  exactly what a genuinely single-member household already saw. No new
  branching was needed for this part.
- **Personal-only UI (the household link) is the mirror image: optional
  props defaulting to empty.** `TransactionList`'s `sharedRows`/
  `showHouseholdName` and `DueRecurringWidget`'s `sharedDueRows`/
  `sharedExpenseHouseholds`/`showHouseholdName` (mirroring the user's own
  share of a split household bill into their personal budget — see
  `docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md`) default to `[]`/`false`
  and are only ever populated by the personal budget page; the household
  page never passes them, so that UI never renders there.
- **Server Actions are injected as props, not imported by the shared
  component.** Since the two `actions.ts` files stay separate, each
  component that used to `import { createTransactionAction, ... } from
  ".../budget/actions"` directly now takes `createAction`/`updateAction` (or
  `onDelete`/`onAcknowledge`/`onTogglePause`/etc. for click actions) as
  props of a plain function type (e.g. `TransactionFormAction = (prevState,
  formData) => Promise<ActionState>`, exported from `transaction-dialog.tsx`).
  Each `page.tsx` passes its own scope's actions in (since BUDGET-4, via the
  shared `BudgetTabs` for the ones it forwards).
- **One `dict` type covers both dictionary namespaces.** `BudgetDict`
  (`src/components/budget/budget-dict.ts`) lists exactly the fields these
  five components read, with the household-only (`split`, `recurring.split`)
  and personal-only (`shared`, `logShared`) groups marked optional. Both
  `Dictionary["budget"]` and `Dictionary["personalBudget"]` satisfy it
  structurally with no adapter object — a household caller's dict happens to
  have `split` populated, a personal caller's doesn't, and every read of an
  optional group is already behind a runtime condition (`canSplit`,
  `sharedRows.length`, …) that's false on the side whose dict lacks it. The
  one exception is `RecurringTemplatesPanel`'s "who acknowledged this" line
  (F7), which has no members-count-driven condition to hang off of — it
  checks `dict.recurring.acknowledgedByLabel`'s own presence instead (a
  field `personalBudget`'s dict omits outright), which is `true` exactly on
  the household side.
- **Row types stay "empty-array-safe" too, not optional.** `TransactionRow`
  keeps a required `splits`, and `RecurringTemplateRow` keeps a required
  `splits` — the personal budget page's row-mapping code supplies `[]` for
  these instead of the type making them optional,
  so nothing downstream needs an extra `?? []`.

#### CategoryManager (BUDGET-3)

**What merged.** `CategoryManager` and `AddCategoryDialog` now live only in
`src/components/budget/category-manager.tsx`;
`src/components/personal-budget/personal-category-manager.tsx` is deleted.
Both pages import the same component with their own categories, dict, and
actions.

**Why this pair needed injected actions, not an empty array.** Unlike the
split-UI suppression trick the BUDGET-2 components use (gate a section
behind `members.length > 1`, pass `members={[]}` from the personal side),
`CategoryManager`'s only scope-specific behavior is *which* Server Actions it
calls — there's no UI section to hide. So
`createCategoryAction`/`updateCategoryAction`/`deleteCategoryAction`
(household) and their `Personal*` counterparts (personal) are passed in as
props, typed by two types exported from `category-manager.tsx`:
`CategoryFormAction` (create/update, the `(prevState, formData) =>
Promise<ActionState>` shape `useActionState` expects) and
`DeleteCategoryAction` (delete, a plain click action called from
`useTransition`). Each page imports its own `actions.ts` and passes its
three actions straight through; `category-manager.tsx` itself never imports
from either `actions.ts` file.

**Dict typing.** `CategoryManagerDict` (also exported from
`category-manager.tsx`) is a narrow structural type covering only the
`categories`/`type` dictionary fields this component reads. Both
`Dictionary["budget"]` and `Dictionary["personalBudget"]` satisfy it as-is
with no adapter object, since those two sections are already identical
field-for-field between the namespaces.

**Collateral wiring.** Deleting `personal-category-manager.tsx` meant
switching `personal-budget-tabs.tsx` from its `PersonalCategoryRow` type to
the merged `CategoryRow` (the shared BUDGET-2 components already used
`CategoryRow`). It also required threading a new `createCategoryAction` prop
through `BudgetTabs`/`PersonalBudgetTabs` and `BudgetOnboarding`/
`PersonalBudgetOnboarding` — unchanged otherwise, since their own merge is
BUDGET-4/5 — because their zero-categories empty state renders
`AddCategoryDialog` too.

#### BudgetTabs (BUDGET-4)

**What merged.** `BudgetTabs` and `PersonalBudgetTabs` now live in one file,
`src/components/budget/budget-tabs.tsx`; `personal-budget-tabs.tsx` is
deleted and both pages import the same `BudgetTabs`. This completes the
BUDGET-2 → BUDGET-3 → BUDGET-4 sequence from
`docs/archive/PERSONAL_BUDGET_UNIFICATION.md`. `BudgetOnboarding`/
`PersonalBudgetOnboarding` (BUDGET-5) is the one pair left, gated on a
product decision; each page builds its own onboarding element and passes it
in as the `onboarding` `ReactNode`, so `BudgetTabs` doesn't care which one
it gets.

**What each budget is for (UX-110).** On phones the subtitle is hidden, so
each budget page shows one short purpose line under its title instead
(`budget.purpose`: "Shared money for {household}: rent, food, bills.";
`personalBudget.purpose`: "Only yours — no one else in the household sees
it."). The two first-run cards differ in the same way: the household card
names the viewed household, the personal card says no one else in the
household sees it. The household budget card on Home (shown once it has
categories) is the "Household safe to spend" row of the overview's Today block (UX-70).

**Scope-specific props.** The spike's "make `costAnalyzer`/`balances`
optional `ReactNode`s" framing no longer applied: the later four-tab UX pass
had already moved cost analyzer and balances into the `insights` node the
household page builds, so no slot for them is left in `BudgetTabs`. What
`BudgetTabs` does read directly got explicit optional props, following the
BUDGET-2 empty-array-safe convention: `members`/`currentMemberId`
(household; default `[]`/`""`) and `sharedDueRows`/`showHouseholdName`/
`sharedExpenseHouseholds`/`logSharedDialogDict` (personal; default
`[]`/`false`/`[]`/`undefined`). `basePath` replaces the route each old
component hardcoded. The four Server Actions it forwards
(`createTransactionAction`, `updateTransactionAction`,
`onAcknowledgeTemplate`, `onLogTemplateAsIs`) are injected by each page, as
for the BUDGET-2 components.

**Dict typing.** `BudgetTabsDict` (exported from `budget-tabs.tsx`) is
`BudgetDict` plus the root-level fields this file reads (tab labels,
`addTransaction`, the month-navigation labels and `safeToSpend`). Both
`Dictionary["budget"]` and `Dictionary["personalBudget"]` satisfy it as-is.

**No "Manage categories" button on either side.** The spike flagged
personal budget as missing household's persistent "Manage categories" button
next to the tab bar. That gap is gone: the four-tab pass gave Categories its
own section in the Manage tab on both pages, which is the stable home the
button existed to provide, so neither page gets the button.

**Tabs, primary action and charts (UX-23).** The shared `Tabs` bar scrolls
sideways (no wrapping, scrollbar hidden), so on a 320 px phone "Insights"
never sits alone on a second row; Meal Planning gets the same behaviour.
"Add transaction" is only rendered once a category exists (the onboarding
card is the next step until then) rather than as a disabled primary. On
Overview, Safe to spend comes before the due-recurring widget. The starter
category chips are left-aligned and a selected chip also shows a check mark
(not colour alone). `FixedBudgetSummary`'s trend bars show each month's
income, expense and savings without hover (since UX-39 through the shared
`BarChart`, below). Deleting a
transaction passes the action's promise to `ConfirmDialog`, so the button
shows "Deleting…" until the server answers, and recurring-row titles wrap
instead of truncating. Covered by `e2e/ux-23.spec.ts`.

**The open tab is in the URL (phone pass, Oct 2026).** `BudgetTabs` reads
the tab from `?tab=` with `useSearchParams` (`parseBudgetTab` in
`src/lib/budget-url.ts`; anything unknown is Overview) and writes it with
`history.replaceState` (Overview drops the param), the same pattern as
Meal Planning's tabs: switching tabs refetches nothing, a reload or a
browser back reopens the same tab, and a link (Personal Budget's "Settle
up", a price-spike notification) lands on its tab. It used to be client
state seeded from the param once, and `MonthNavigator`'s links dropped it,
so paging months from Transactions bounced back to Overview. Covered by
`src/lib/budget-url.test.ts` and `e2e/budget-month-tab.spec.ts` (both
pages).

**Transaction rows (phone pass, Oct 2026).** On a phone `TransactionList`
lists the month as compact rows (about 56 px, twice as many per screen as
the old two-line cards) under a header per day: "Today" / "Yesterday"
from `Intl.RelativeTimeFormat`, otherwise weekday and date in the
viewer's language with no year, and that day's net (income minus
expenses and savings) on the right (`groupByDay` and `dayHeading` in
`src/lib/budget-transaction-days.ts`). A row's day is the UTC calendar
date of its stored `date` (forms store a picked day as UTC midnight);
"Today" is the viewer's local day, rendered from the server's `todayKey`
and swapped for the browser's after hydration (`useSyncExternalStore`), so
the two can't mismatch. Each row is one button: the description as its
title (the category name when there's none), then the category and the
recurring/split/left-due badges in caption size, and the amount on the
right in `tabular-nums`. Tapping it opens the edit sheet, which now ends
in "Delete transaction" (with its confirm dialog), a footer away from
Save; swiping left offers Edit and Delete with Undo (see "Swipe row
actions"). Shared rows on Personal Budget keep the same layout but stay
read-only, with only their "View in {household} budget" link. Amounts
follow DESIGN.md's colour rules on both phone and desktop: income
`success` with a plus, expenses `foreground` with a minus, savings
`foreground` with an arrow (no more red for every expense or `chart-2`
text). The desktop table keeps its per-row edit and delete buttons and
drops the year from its dates. "Export CSV" moved from the top of the tab
to below the list. Covered by `src/lib/budget-transaction-days.test.ts`,
`e2e/budget-transaction-rows.spec.ts` and `e2e/swipe-rows.mobile.spec.ts`.

**Category filter and drill-down (phone pass, Oct 2026).** The
Transactions tab opens with a category select ("All categories" or one
category; its own full-width row on a phone, M1), stored in `?category=`
with `history.replaceState`, so it filters at once without a refetch and
survives a reload; `MonthNavigator` keeps it when paging months. While a
filter is on, a "Clear filter" link shows (a link, so it also works in
the read-only household view where the select is disabled with every
other control), shared rows on Personal Budget are left out (they belong
to a household category), and a category with nothing that month gets
"Nothing logged in {category} this month." with the same Clear. Every row
of the income, expense and savings breakdowns in `PeriodSummary` is a link
(whole row, chevron, at least 44 px) to that month's Transactions filtered
to the category (`categoryHref`, built by `budgetHref`). The id is only
honoured when it names one of the categories the server loaded for the
signed-in household or user (`resolveCategoryFilter` in
`src/lib/budget-url.ts`): anything else, another household's id
included, is no filter, and no query ever runs on it. Rows that aren't
the viewer's own categories (Personal Budget's "(Shared)" rows,
`FixedBudgetSummary`'s recurring items) stay plain. Covered by
`src/lib/budget-url.test.ts` and `e2e/budget-category-filter.spec.ts`.

**One Overview, nothing twice (phone pass, Oct 2026).** Overview used to
run to about five phone screens, with income, expenses and what's left
shown three times and the due list twice. Now it is Safe to spend, the
due widget and savings goals:

- `SafeToSpend` takes `variant="compact"` here: the summary sentence, the
  number, the projection, then one totals line (income, expenses,
  savings) and a "How we got this number" disclosure (`<details>`) that
  holds the full arithmetic, the caveat and the "Still due this month"
  list. The dashboard's "Your budget" card keeps the default `"full"`
  layout, since it has no due widget beside it. Due amounts in the list
  are plain text (income stays `success`).
- `DueRecurringWidget` is the one list of what's due, one line per item:
  the name, then amount and category in caption size, a "Log" button
  (opens the prefilled transaction sheet) and a "More actions for {name}"
  menu holding "Log as-is" and "Mark as accounted for". Three buttons per
  item used to wrap each one to about 370 px on a phone.
- `PeriodSummary` moved to Insights (see "Period summary").

Covered by `e2e/budget-overview.spec.ts`.

**Manage on a phone (phone pass, Oct 2026).** A recurring item is one
line: name, then amount, frequency, due day and category in caption size,
its one action ("Log" when due, "Undo" once accounted for, "Resume" when
paused, none once logged) and a "More actions for {name}" menu with Mark
as accounted for (due items), Edit, Pause and, last behind a separator,
Delete (confirmed). Five buttons used to wrap, leaving pause and delete
alone on a second line beside each other. Edit opens from the menu
through a hidden trigger and Delete through a dialog handle, since a
dialog inside the menu would unmount as it closes. A category chip is
now one button (named "Edit {name}") that opens its edit sheet, which
ends in "Delete {name}" with its confirm dialog, a footer away from Save;
the chips dropped their own pencil and bin (delete right beside edit, M2)
and the `12rem` cap that cut off names like "Kids activities" with room
to spare, so a name only truncates when it's wider than the row. Covered
by `e2e/budget-manage.spec.ts` and `e2e/ux-19.mobile.spec.ts`.

**The first phone screen (phone pass, Oct 2026).** On a phone both budget
pages hide the subtitle under the title, and the month bar and tab bar sit
12 px apart as one block (sections below keep `space-6`), so the title,
month and tabs no longer take ~40% of the first screen. The floating "Add
transaction" (`PrimaryAction`) is clear of the end of the Transactions tab
once it's scrolled to the bottom, thanks to `main`'s extra bottom padding
when it holds a primary action (layout.tsx). Covered by
`e2e/budget-chrome.mobile.spec.ts`.

**Budget charts (UX-39).** Both budgets draw every chart from one small kit
in `src/components/charts/` (plain CSS bars and inline SVG, no chart
library), so household and personal never diverge:

- `BarChart` (client): `FixedBudgetSummary`'s "How it's changing" and
  `CostAnalyzer`'s grocery spend. Each month is one button the full height
  of the chart, at least 44 px wide and 8 px apart (M3); tapping selects it
  (`aria-pressed`) and a readout above the bars (`role="status"`) shows that
  month's value per series with its colour dot, which doubles as the legend.
  The latest month starts selected and scrolled into view, so nothing is
  hover-only. Each button's accessible name carries its values, and the
  whole series is also a visually hidden table (`sr-only`, captioned with
  the card title).
- `Sparkline`: `CategoryBreakdown` draws one beside each expense row's bar
  — the category's spending over the last six months, this month last
  (`withSpendHistory` in `src/lib/chart-calc.ts`, from the household page's
  12-month lookback window or the personal page's whole history; a row with
  nothing spent in the window gets none). Its accessible name lists the
  months and amounts. `CostAnalyzer`'s price trends use it too.
- `ProjectionChart`: Safe to spend's projected end-of-month line (see "Safe
  to spend").
- `AnimatedNumber` (client): Safe to spend's number and the four totals in
  `PeriodSummary` and `FixedBudgetSummary` count to a new value when it
  changes (600 ms, eased out), always in `tabular-nums`. The first render
  is the real value, as the server sent it, so a page load never flashes a
  wrong number; under `prefers-reduced-motion` the number just changes.
- Colours come from `chart-colors.ts`: `chart-1` … `chart-5` in series or
  row order, for marks only (DESIGN.md, Colour).

Covered by `src/lib/chart-calc.test.ts` and `e2e/ux-39.spec.ts`.

## Data export (CSV)

Three "Export CSV" buttons — inventory, one shopping list, and budget
transactions — each a plain `<Link>` (styled as a `Button`,
`src/components/export/export-button.tsx`'s `ExportButton`, shared
across all three) pointing at a Route Handler that streams that household's
own scoped data as a `.csv` download. No client-side JS is involved in the
download itself: the browser's native handling of a
`Content-Disposition: attachment` response does the work, so the button
needs no loading state and degrades to a plain link with JS disabled.

`ExportButton` is a generic `{ href, label }` link-styled-as-button, not
CSV-specific despite this section's name — the Profile page also has its
own "export my data" button (`src/app/dashboard/profile/export-data/route.ts`)
that reuses the same component for a `.json` (not `.csv`) download of just
the signed-in user's own data (profile fields, household memberships, and
personal-budget data — deliberately excluding household-*shared* data like
`InventoryItem`/`Transaction`, which the three CSV exports below already
make reachable to anyone with household access).

**"Export my data" contents** (SEC-10). The JSON has these top-level keys,
pinned by a key-path inline snapshot in `route.test.ts` so any change to the
shape is deliberate:
- `profile` (email, display name, created/verified dates, Swish number) and
  `preferences` (`locale`, `theme`, `weeklyDigestEnabled`,
  `inventoryViewPrefs`). Never `passwordHash` or `passwordChangedAt`.
- `householdMemberships`: household name, role, joined date.
- `pushSubscriptions`: one per browser with the push service's origin
  (e.g. `https://fcm.googleapis.com`), created date, quiet hours and time
  zone. The full `endpoint` URL and the `p256dh`/`auth` keys are left out:
  together they let anyone push to that device, an export file tends to
  get emailed and synced, and they're random browser-minted values rather
  than information about the user.
- `personalBudgetCategories` (with `id`), `personalTransactions`,
  `personalRecurringTemplates` (with `id` and acknowledgements),
  `personalPlannedExpenses` (with `id`). The ids are there so `categoryId`,
  `recurringTemplateId` and `plannedExpenseId` references resolve.
- The user's own part of shared features, each with the household name and
  just enough of the parent row to be readable: `householdNotes` they
  wrote; `householdTasks` assigned to or last completed by them
  (`assignedToMe`/`completedByMe`, no rotation list, since a task keeps only
  its latest completion this is all the task history there is);
  `transactionSplits`, `recurringTemplateSplits` and `plannedExpenseSplits`
  (their share of a split bill plus the bill's description/name, amount and
  date or due date);
  `memberSettlements` they paid or received (`direction`, the other
  member's display name, amount, date). Other members' shares and the
  household's full transaction list stay out.
- `invitationsSent`: the invite links the user made (household name,
  created, expiry and accepted dates), since UX-62 records who made each
  link. The `token` is left out: an unused one lets anyone join the
  household.
- The response sends `Cache-Control: private, no-store`, so no shared or
  browser cache keeps a copy.

- **Route Handlers**: `src/app/dashboard/inventory/export/route.ts`,
  `src/app/dashboard/shopping-list/[id]/export/route.ts`, and
  `src/app/dashboard/budget/export/route.ts` each re-derive the household via
  `requireHousehold()` — never a client-supplied id — the same as every page
  and Server Action in the app. The shopping list export additionally
  re-looks-up the list scoped by `householdId` (mirroring the detail page's
  own query) and 404s via `notFound()` if the `[id]` doesn't belong to the
  caller's household.
- **What's exported**: inventory exports every `InventoryItem` (name,
  category, quantity, unit, location, low-stock threshold, last known
  price); a shopping list export is that list's items (name, quantity,
  unit, estimated price, purchased yes/no, and GAP-5's note — last, so a
  consumer of the older five-column file keeps its column positions); the
  budget export is every
  `Transaction` in the **current calendar month** — the same
  `[monthStart, monthEnd)` window `PeriodSummary` already computes on the
  budget page, not the household's full transaction history — with date,
  category, type, amount, description, and recurring (yes/no).
- **CSV building**: `src/lib/csv.ts` (`buildCsv`/`csvResponse`) is a small
  hand-rolled helper — no library needed for this shape of data, and none
  was already installed for CSV per ground rule 9. `buildCsv` quotes/escapes
  a field (doubling internal quotes) only when it contains a comma, quote,
  or newline, and joins rows with CRLF per RFC 4180. **Numeric fields are
  never run through `Intl.NumberFormat`/locale formatting** — unlike the
  rest of the app's on-screen `createMoneyFormat` convention (which adds
  GAP-13's currency symbol when one is set),
  several locales this app supports (Swedish) use a comma as the decimal
  separator, which would collide with CSV's own comma delimiter and corrupt
  the file; plain `.`-decimal numbers keep the export parseable by any
  spreadsheet tool regardless of the viewer's locale. `buildCsv`/
  `escapeCsvField` are pure and unit-tested in `src/lib/csv.test.ts`.
- **Filenames**: `Content-Disposition: attachment; filename="..."` uses a
  translated prefix (`dict.export.<area>.fileNamePrefix`) plus a date/list
  slug for uniqueness — e.g. `inventory-2026-09-05.csv`,
  `shopping-list-weekly-groceries.csv` (slugified from the list's name),
  `budget-transactions-2026-09.csv`.
- **Column headers and the "Export CSV" button label are translated**
  (`dict.export` in both `en.ts`/`sv.ts`) like all other user-facing text —
  even though a CSV's headers aren't rendered UI, they're still text a
  person reads when they open the file.
- **Out of scope** (per the roadmap item): no PDF export, and no CSV import
  back into the app — this is export-only, one direction.

## Barcode scanning

A "Scan barcode" button sits next to the **Name** field on both the
inventory add-item form (`AddItemDialog`,
`src/components/inventory/add-item-dialog.tsx`) and the shopping list
ad-hoc-add form (`AddItemForm` inside `ShoppingListClient`,
`src/components/shopping/shopping-list-client.tsx`) — the two places a
household member most often types a grocery item's name from scratch. Both
wire the same shared component
(`BarcodeScannerButton`/`ScannedBarcodeNote`,
`src/components/shared/barcode-scanner.tsx`), which opens the device
camera, decodes a barcode client-side, and looks up a product name — but
never blocks or breaks manual entry, at any failure point.

- **Library choice**: no barcode-decoding library was already installed
  (checked `package.json` per ground rule 9). Researched current options
  rather than assuming one from training data — `@zxing/library` and the
  once-popular `html5-qrcode` are both effectively unmaintained;
  **`barcode-detector`** (npm, the actively maintained continuation of
  `@sec-ant/barcode-detector`, v3.2.2 as of this writing) was picked
  instead: it's a ponyfill of the standard Barcode Detection API backed by
  `zxing-wasm`, has exactly one dependency, and needs no bundler/WASM
  config — the `.wasm` binary is fetched at runtime from a CDN by the
  library itself, not bundled. It's imported dynamically
  (`await import("barcode-detector/ponyfill")`) inside the scan button's
  click handler rather than as a static top-level import, per Next's own
  "Loading External Libraries" lazy-loading guide
  (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`) — this
  keeps the decoder's JS/WASM entirely out of the initial page bundle and
  guarantees none of it ever executes during SSR.
- **Scanning flow** (`BarcodeScannerButton`): clicking "Scan barcode" opens
  a dialog and requests `navigator.mediaDevices.getUserMedia({ video: {
  facingMode: { ideal: "environment" } } })`. Once the stream is live, a
  `setInterval` loop (~350ms) draws the current video frame onto an
  off-screen `<canvas>` and calls `BarcodeDetector.detect(canvas)`,
  restricted to `ean_13`/`ean_8`/`upc_a`/`upc_e` — the retail barcode
  formats groceries actually carry, not QR/2D codes. The first successful
  decode stops the camera immediately (all `MediaStreamTrack`s are
  `.stop()`ed) and triggers the product lookup below.
- **Product lookup** (`lookupBarcodeAction`, `src/lib/actions/barcode.ts`):
  a Server Action — not a client-side `fetch` — that validates the decoded
  string is barcode-shaped (`isValidBarcodeFormat`, pure and unit-tested in
  the colocated `src/lib/barcode.test.ts`, split out of the `"use server"`
  file the same way `recipe-import.ts`'s pure parsing was split from its
  action, since a `"use server"` file may only export async functions),
  then calls Open Food Facts's free public API
  (`https://world.openfoodfacts.org/api/v2/product/<barcode>.json`, no API
  key) with a short timeout (5s, via `AbortController`) and identifies the
  app via a `User-Agent` header, per Open Food Facts's own API etiquette.
  Any failure — invalid barcode shape, network error, timeout, a 4xx/5xx
  response, no matching product, or a product with no `product_name` — is
  swallowed and reported back as `{ name: null }` rather than an error;
  there's nothing actionable a user could do about an Open Food Facts miss
  besides typing the name themselves, which the flow already falls back to.
  On a hit, the product's `categories_tags` are mapped to an
  auto-category (`categoryKeyFromOpenFoodFactsTags`, most specific tag
  first, skipping the catch-all `plant-based-foods-and-beverages` family)
  and returned as a localized `category`. The add-item form uses it to fill
  a *blank* Category field, and the scan queue sends it per item to bulk
  add, where it's used only when no shared category is set.
  Still calls `requireHousehold()` first, matching every other action in
  this app's "never a reachable, unauthenticated Server Action" convention,
  even though the household id itself isn't used for anything here.
- **Privacy**: the camera stream and every captured frame stay entirely
  client-side — decoding happens locally via the WASM decoder, and no
  frame or image is ever sent anywhere. The only thing that reaches the
  network is the decoded barcode's digits, sent from the server to Open
  Food Facts's product endpoint — and, since AUTO-6, only for a code the
  household hasn't linked to an item yet: a remembered code resolves from
  the household's own inventory and nothing leaves the server. The code
  itself is now stored with the household's inventory
  (`InventoryItem.barcode`, below), visible only to that household, like
  any other item field. No new cookie or browser storage is involved (the
  scan mode's Put away/Used up choice is plain component state). The
  privacy page's "What we collect" and "Third parties" sections say both.
- **Fallback behavior — this is the important half of the feature**: the
  "Scan barcode" button is purely additive next to a form that already
  works without it.
  - No camera / `getUserMedia` unsupported, permission denied, or any
    other `getUserMedia`/decoder-setup error: the dialog shows a short
    translated message (distinguishing a permission denial from a
    generally unavailable camera) and a Cancel button; the underlying
    add-item form's Name field is completely unaffected and still works
    exactly as before.
  - A successful scan with no Open Food Facts match (or the API being
    unreachable): the Name field is left as-is (not overwritten with
    nothing) and a small reference line — "Scanned barcode: `<number>`"
    (`ScannedBarcodeNote`) plus a translated "no product found, enter the
    name manually" note — appears under the field, so the user can still
    search by that number or just type the name, without losing the fact
    that a barcode was scanned.
  - A successful scan **with** a match pre-fills the Name field (still a
    plain editable, controlled input — the user can freely change it
    before submitting) and shows the same reference line, without the "not
    found" note.
  - The scanned number pre-fills the name and shows the reference line
    exactly like the recipe-import feature's "pre-fill, then let the user
    review/submit normally" shape — and, since AUTO-6, it's also sent with
    the add-item form (a hidden `barcode` field) and the scan queue's rows,
    so the item that gets created remembers its code (see below). The
    shopping list's advanced add form (`ShoppingItemFormDialog`) still only
    pre-fills; nothing it scans is stored.
- **i18n**: all new strings live in a new shared `barcodeScanner` dictionary
  namespace (`en.ts`/`sv.ts`) rather than being duplicated into `inventory`
  and `shoppingList`, since the component and its copy are identical in
  both places.

### Remembered barcodes and Scan mode (AUTO-6)

A barcode the household has linked to one of its items is remembered, so
scanning it again is a one-step stock change instead of a name to type.

- **Storage**: `InventoryItem.barcode String?` with
  `@@unique([householdId, barcode])` — one product per code per household
  (Postgres treats NULLs as distinct, so any number of items have none).
  Codes are stored normalized (`normalizeBarcode`, `src/lib/barcode.ts`,
  unit-tested): a 12-digit UPC-A is padded to its 13-digit GTIN form, since
  the decoder can report the same package either way. **Linking a code
  that's already on another item moves it** (`releaseBarcode`,
  `src/lib/inventory/barcode-link.ts`, run in the same transaction as the
  write that sets it): the latest explicit link is the correction that
  sticks, and a wrong link is fixed by linking again. Every path that sets a
  code uses it — the scan mode's "Add as new item"/"This is…", the add-item
  form, and the scan queue's bulk add (which also keeps only the first row
  per code, since `createMany` would otherwise fail on the index).
- **Scan mode** (`StockScanDialog`, `src/components/inventory/
  stock-scan-dialog.tsx`, the "Scan" button on the inventory page): the
  camera stays open and each scan applies straight away, in one of two
  modes toggled at the top — **Put away** (+1) or **Used up** (−1). A
  remembered code goes through `scanStockChangeAction(barcode, delta)`
  (`src/lib/actions/barcode.ts`), which resolves it household-scoped
  (`requireHousehold()`; never a client-supplied household) and applies the
  same floor-at-zero/2-decimal rule as `adjustQuantityAction`'s +/- taps
  (`nextQuantityAfterDelta`, `src/lib/inventory/stock-change.ts`, shared by
  both) plus the same `recordOutOfStockTransition` side effect — no
  "restocked" notification, that kind stays retired. Per the Guardrails it
  is an explicit action applied immediately with Undo, not confirmed first:
  a short toast confirms it, and a log in the dialog lists this session's
  scans with **Undo** per row, plus **…and add to list** on a "Used up"
  row that reached 0 (that's `markItemEmptyAction`'s list half — same
  list choice and dedupe as "Mark empty"). Undo lives in the dialog rather
  than on the toast because tapping a toast counts as an outside press on a
  modal Base UI dialog and would close the camera.
  `undoScanStockChangeAction(itemId, appliedDelta)` reverses the change the
  scan *actually* made (a "Used up" scan of an item already at 0 applied 0,
  so has no Undo) as a relative change, so an Undo after someone else's
  +/- doesn't wipe theirs out; it never undoes a link or a created item.
- **Repeat guard**: a code held in front of the lens is decoded every
  ~350ms, so the dialog ignores the same code until it has been out of
  frame for `SAME_CODE_REPEAT_MS` (2s) — `acceptScan`, pure and
  unit-tested; every sighting refreshes the window. Two identical cans are
  counted by showing one, taking it away, then showing the other. (The
  scan queue keeps its own cooldown instead, where holding a second can up
  is how it counts ×2.)
- **Unknown code**: `scanStockChangeAction` returns Open Food Facts' name
  and AUTO-2 category instead of changing anything, and the dialog asks
  once: **Add as new item** (`createItemFromBarcodeAction` — the editable
  name, Open Food Facts' category or else the usual AUTO-2 guess, starting
  stock 1 for Put away or 0 for Used up) or **This is…** an existing item
  (`linkBarcodeAction`, an `ItemCombobox` over the household's items),
  which links the code and applies the scan's change in one step, with the
  same Undo. **Skip** drops it. New scans are ignored while the question is
  open, and a product still in frame after answering isn't counted twice.
- **Never blocks manual entry**: a "type the barcode number" field under the
  camera runs the exact same flow, for a device with no camera, a denied
  permission, or a code the decoder won't read. The camera loop itself is
  `useBarcodeCamera` (`src/components/shared/use-barcode-camera.ts`),
  shared with the scan queue; `BarcodeScannerButton` keeps its own
  single-shot copy because it stops on the first hit.
- **Shopping list**: the smart add line (`SmartAddBar`) has a scan button
  (`BarcodeScannerButton` with an `onDetected` override).
  `findItemByBarcodeAction` resolves a remembered code, household-scoped,
  and its item is added through `smartAddShoppingListItemsAction` — the
  same dedupe ("already on the list") and price default as a typed name —
  in one scan. An unknown code puts Open Food Facts' name (if any) into the
  input for the user to check and press Enter, or asks them to type it.
- **Out of scope**: codes on `ShoppingListItem` and a place to view or
  clear an item's code in the edit form — re-linking it from the scan mode
  is the correction path. Receipt lines that print an EAN match against the
  stored code (AUTO-11, see "Receipt scanning" below).

## Receipt scanning

A "Register receipt" button (named "Scan receipt" before UX-22, to match the index page) on an active shopping list's detail page
(`ReceiptScanDialog`, `src/components/shopping/receipt-scan-dialog.tsx`,
wired into `ShoppingListClient`) lets a household member photograph a paper
receipt after a shop and, in one step, mark every matched list item
purchased with its actual price — instead of pricing and checking off each
item by hand. This is what feeds `PriceHistory` (and therefore the budget's
Cost analyzer and Groceries expense on list completion) in the common case,
so it directly serves "keep track of household spending". `RegisterReceiptDialog`
(the "Register receipt" button on the shopping-list overview page) is the
same photo → reviewed line items pipeline, just landing in a freshly created,
already-completed list instead of matching against one you built by hand.

**AI-first, OCR fallback.** The original client-side OCR pipeline
(`Tesseract.js` + the regex heuristics below) turned out to be the weak
link: real receipts vary enough in layout — multi-line item names, a store
that prints both a unit price and a line total, a slightly crumpled
receipt — that the "one name, one trailing price per line" heuristic
regularly missed or garbled lines. `scanReceiptPhotoAction`
(`src/lib/actions/receipt-scan.ts`) instead uploads the photo to a vision
model (the same Gemini → Gemini fallback → Anthropic attempt chain as AI
shelf scan below, sharing its `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` config)
and asks it to read the line items and currency directly — a vision model
reads a receipt the way a person would, rather than pattern-matching
printed columns, which is what actually fixes unreliable scans. When
neither key is configured, both dialogs fall back to the original fully
client-side OCR pipeline described below instead of losing the feature
outright — so receipt scanning still works with zero setup, just less
reliably than with a provider key set. Either path lands at the same
reviewable rows and the same `applyReceiptScanAction`/`registerReceiptAction`
below.

- **This was flagged as needing a paid vendor — it doesn't.** "Not yet
  built" previously bucketed receipt OCR with bank-sync and social login as
  needing a third-party account the product owner would have to provision.
  That assumption held for cloud OCR vendors (Google Vision, AWS Textract,
  ...), but **Tesseract.js** (npm, v7, MIT-derived/Apache-2.0, a WASM port
  of the Tesseract OCR engine) runs entirely client-side with no API key,
  no account, and no per-scan cost — so this shipped as a normal task
  instead of staying deferred.
- **OCR fallback flow**: the "Scan receipt" button is a plain `<Button>` that clicks
  a hidden `<input type="file" accept="image/*" capture="environment">` —
  `capture="environment"` opens the device's rear camera directly on
  mobile, and falls back to a normal file picker on desktop (no
  `getUserMedia`/live-video loop needed, unlike barcode scanning, since a
  single still photo of a receipt OCRs far better than a live camera
  frame). Once a file is chosen, `tesseract.js` is dynamically imported
  (`await import("tesseract.js")`, kept out of the initial bundle, same
  lazy-loading convention as `barcode-detector` above) and
  `createWorker(["eng", "swe"])` recognizes the `File` directly (a
  browser-supported input type — no canvas/base64 conversion needed) before
  being torn down with `worker.terminate()`.
- **Parsing** (`src/lib/receipt-parsing.ts`, pure and unit-tested,
  dependency-free like `item-matching.ts`): `parseReceiptText` splits the
  OCR'd text into lines and keeps only ones that look like a priced item —
  a trailing amount with exactly 2 decimal digits (what distinguishes a
  price from a bare quantity, weight, or barcode elsewhere on the line),
  with an optional leading "2 x " quantity prefix and an optional trailing
  currency token. A boilerplate stoplist (Swedish + English: "summa",
  "moms", "kort", "total", "vat", "kvitto", ...) drops non-item lines
  (subtotals, VAT, payment method, "thank you") even when they carry a
  trailing amount. `detectReceiptCurrency` separately scans the whole
  receipt for the most frequent currency symbol/code, since a single
  receipt is essentially always one currency.
- **Currency conversion**: every amount in this app is a plain `Float`, so
  `HOUSEHOLD_BASE_CURRENCY` (`src/lib/currency.ts`, currently `"SEK"`) is a
  single fixed constant. GAP-13's `Household.currencyCode` is a display
  label only and deliberately doesn't change what receipts convert to. If a receipt's detected
  (or user-corrected) currency differs, `applyReceiptScanAction`
  (`src/app/dashboard/shopping-list/actions.ts`) fetches a live rate from
  **Frankfurter** (`frankfurter.dev`, free ECB reference rates, no API key)
  via `fetchExchangeRate` (`src/lib/exchange-rate.ts`) and converts every
  matched line before saving; a failed fetch (offline, API down) reports an
  error and applies nothing, rather than silently recording an unconverted
  amount as if it were the base currency.
- **Review before anything is written**: OCR and matching are both
  heuristic, so nothing is auto-applied. `ReceiptScanDialog` shows every
  parsed line with an editable price (OCR misreads a digit occasionally)
  and a match dropdown pre-selected to the best fuzzy match against the
  list's *pending* items (reusing `findInventoryMatches` from
  `item-matching.ts` — generic enough to match against shopping-list items,
  not just inventory items) when its similarity score clears a threshold,
  else defaulting to "— Skip —" rather than guessing wrong. The user can
  fix any price, change any match, or skip any line before confirming.
- **Confident matches start accepted (AUTO-11)**: reviewing every line of
  a long receipt when most matches are obvious was the slow part, so both
  dialogs sort lines by confidence with `matchReceiptLines`
  (`src/lib/shopping/receipt-match.ts`, pure and unit-tested). There are
  two thresholds: `RECEIPT_PRESELECT_MIN_SCORE` (0.35, the old single
  threshold) pre-selects a best guess on a line that stays open for
  review, and the much stricter `RECEIPT_AUTO_ACCEPT_MIN_SCORE` (0.9, in
  practice "the same name after normalization") *plus* a
  `RECEIPT_AUTO_ACCEPT_MIN_MARGIN` (0.15) lead over the runner-up
  pre-accepts it. Pre-accepted lines are collapsed into an expandable
  "N items matched" summary (`AutoMatchedSection`) above the lines that
  still need a look; expanding shows the same editable rows, so any
  auto-accepted match or price can still be corrected. There's still one
  Apply button and nothing is written before it — review is shorter, not
  gone, which is what keeps this inside the Guardrails' "suggest, don't
  silently mutate". A row never moves between the two sections while it's
  being edited. Three more rules keep auto-accept conservative:
  - **Barcode**: when a receipt line prints an EAN/UPC that equals exactly
    one candidate's `InventoryItem.barcode` (AUTO-6), that's an exact match
    whatever the receipt's abbreviated name says. The vision model reports
    a per-line `barcode` when one is printed, and the OCR parser keeps a
    leading/trailing digit run as `barcode` instead of only stripping it.
    Both go through `receiptLineBarcode` (`src/lib/barcode.ts`), which
    only accepts GTIN-8/12/13/14 with a valid GS1 check digit — receipt
    lines are full of article/PLU numbers, and an auto-accept can't afford
    to trust one. Codes are normalized the same way as stored ones (12-digit
    UPC-A → GTIN-13). For `ReceiptScanDialog`, a list row's code is its
    linked inventory item's. Two candidates sharing a code (the same item on
    a list twice) leaves the line open.
  - **Learned aliases (MATCH-5)**: after the barcode, a line whose name
    is one of the household's `ItemAlias` names ("ÄGG 12P" taught as Egg,
    in a recipe review or by linking a shopping-list row) counts as an
    exact name match for the alias's item, unless some candidate is named
    exactly like the line (that one wins, through the fuzzy step). It
    auto-accepts when exactly one candidate is that item (for
    `ReceiptScanDialog`, a list row is its linked item), and the
    exclusive rule below still applies; two rows for the item leave it
    open with the first pre-selected. Untracked aliases are ignored. Both
    list pages load the household's tracked aliases next to their
    inventory query and pass them to the dialogs as data.
  - **Exclusive on a list**: in `ReceiptScanDialog` each pending row is
    bought once per receipt, so if two lines would both auto-accept the
    same row, both stay open instead. `RegisterReceiptDialog` doesn't apply
    this, since the same product twice on one receipt is normal there.
  The thresholds were set conservatively without a corpus of real
  receipts; loosen them only after checking against some.
- **Applying a scan** (`applyReceiptScanAction`): for every confirmed line,
  sets the shopping-list item's `estimatedPrice` (converted) and marks it
  `purchased`, then follows the household's `inventorySyncMode` (see "Put
  away" under the data model). In `ON_CHECK` mode it's the arrival, as
  before — `applyStockArrival` bumps the linked item's quantity, applies
  AUTO-7/GAP-28 and records `PriceHistory` — and the row is put away. In
  `ON_PUT_AWAY` mode the receipt only proves what was paid: `PriceHistory`
  (with the store) and `lastKnownPrice` are written now and the row is
  stamped `priceRecordedAt`, but the stock waits for the put-away step,
  which then doesn't record the price a second time; the list page opens
  the put-away dialog straight after. An unlinked row has no stock to wait
  for and no `PriceHistory` to write, so it's put away on the spot instead
  (otherwise it would stay matchable forever). Lines are applied one at a
  time, each claiming its row with a conditional `updateMany` (still
  unticked, or ticked with neither `putAwayAt` nor `priceRecordedAt`) and
  re-reading row and inventory item inside the transaction — so two lines
  for the same inventory item both land instead of one overwriting the
  other, and a line whose row a put-away or another receipt took first is
  skipped. This replaced SCALE-C's parallel per-line writes, which worked
  from one stale snapshot. A line can match any unticked row,
  or a ticked row with neither `putAwayAt` nor `priceRecordedAt`
  (`awaitsReceiptPrice` — the usual order in put-away mode is tick in the
  store, scan at home); a row whose stock or price is already recorded
  never matches, so nothing is counted twice. It's all batched across
  every scanned line in one transaction instead of one checkbox at a
  time, sequentially (see above; SCALE-C's concurrent `Promise.all` still
  applies to `resolveShoppingListMappingsAction`'s batch resolution, the
  `ResolveMappingsDialog` commit path, where each resolution only touches
  its own rows). De-dupes by `shoppingListItemId` server-side (in case two
  OCR'd lines were ever matched to the same item) so nothing is
  double-counted.
- **`RegisterReceiptDialog`'s own inventory match/create-new review**: since
  this flow has no existing shopping list to match against, each reviewed
  line instead gets matched against the household's *inventory* catalog —
  same `matchReceiptLines` call (non-exclusive), same pre-select and
  auto-accept thresholds as `ReceiptScanDialog` above, but a two-mode "Use existing"/"Create new"
  toggle (mirroring `ResolveMappingsDialog`'s row UI) instead of a
  skippable dropdown, since every line here always becomes a shopping-list
  item regardless of whether its inventory link resolves. A confident
  match pre-selects "Use existing" with that item chosen; anything else
  (including zero inventory items yet) defaults to "Create new" with an
  editable category, rather than silently leaving the line unlinked. The
  user's choice is sent explicitly to `registerReceiptAction`
  (`inventoryItemId` or `newItemCategory` per line) instead of the action
  re-guessing server-side — it only falls back to the old silent
  exact-name-then-fuzzy auto-match when neither is sent, kept for backward
  compatibility rather than as the primary path. That fallback reads the
  household's inventory once per receipt (PERF-16), on the first line that
  needs a fuzzy match, and matches every later line in memory (including
  items the same receipt just created). A registered receipt is
  after the shop by definition, so it updates inventory immediately in
  either `inventorySyncMode` and stamps every row `putAwayAt` (and
  `priceRecordedAt` when linked) — there's nothing left to put away.
- **Privacy**: when a vision provider is configured, the photo is uploaded
  to it for analysis — same tradeoff as AI shelf scan below, disclosed in
  this feature's comments the same way. In the OCR fallback path only
  (no provider configured), the photo is exactly the same stance as barcode
  scanning: read entirely client-side by the OCR worker and never uploaded
  anywhere. Either way, the server only ever receives the extracted item
  names, prices, and currency the user has already reviewed — never the
  photo itself.
- **No raw model output in logs (SEC-11)**: when a provider's reply isn't
  valid JSON, both this action and AI shelf scan log only its length and
  first 200 characters (`excerptForLog`, `src/lib/logger.ts`), never the
  whole reply — a receipt's payment block (masked card number, loyalty
  number) sits at the bottom, past what's kept. Regression tests in
  `receipt-scan.test.ts` and `inventory-scan.test.ts`.
- **i18n**: all new strings live under `shoppingList.receiptScan`/
  `shoppingList.registerReceipt` in `en.ts`/`sv.ts`.

## AI shelf scan (beta)

A "Scan a shelf" button (with a "Beta" badge, `AiShelfScanDialog`,
`src/components/inventory/ai-shelf-scan-dialog.tsx`) on the Inventory page
toolbar (`src/app/dashboard/inventory/page.tsx`) lets a household member
photograph a shelf, fridge, or cupboard and have AI guess the items on it
and how many — reviewed and corrected before anything is added, same
"AI/OCR suggests, human confirms" shape as barcode scanning and receipt
scanning above. Marked beta because vision-based counting is inherently
approximate (packaging occludes items, similar products get merged or
split) in a way this app's other scan features aren't; receipt scanning
above shares this feature's vision-provider chain but isn't itself beta,
since it has a fully client-side fallback for anyone without a key set,
where this feature has none.

- **Unlike barcode scanning (and receipt scanning's own OCR fallback) on
  privacy**: those never send the camera image anywhere — decoding/OCR both
  run entirely client-side. There's no equivalent client-side model for
  "what groceries are in this photo", so this feature's photo **is** uploaded to a
  third-party API for analysis. The dialog says so before the camera opens,
  and the photo itself is never persisted anywhere (not written to disk,
  not stored in the database) — only the reviewed name/quantity guesses
  are, exactly like the other two features' review step.
- **An ordered attempt chain, not a single provider pick**
  (`scanShelfPhotoAction`, `src/lib/actions/inventory-scan.ts`):
  `resolveAttempts()` builds a chain of up to three attempts — Gemini's
  primary model (`GEMINI_MODEL`, default the auto-updating
  `gemini-flash-latest` alias), then Gemini's *fallback* model
  (`GEMINI_FALLBACK_MODEL`, default `gemini-flash-lite-latest` — a
  genuinely smaller/separate model, not just a rename, so it's its own
  capacity pool), then Anthropic (Claude) — each entry only included when
  its provider's key is set, and an empty chain means the feature reports
  itself unconfigured. Gemini goes first because its free tier
  (`generativelanguage.googleapis.com`, no card required) makes this
  feature genuinely free to run at a single-household scale, where
  Anthropic's is metered from the first request — see `.env.example` for
  all three env vars. `callAttempts` walks the chain in order and moves to
  the *next* entry only when the current one reports itself busy
  (`provider_busy` — see the retry section just below), trying a different
  Gemini model before ever spending real money falling through to
  Anthropic, since Google's own guidance for an overloaded model is to try
  a different one rather than hammer the same one again. A real analysis
  failure (bad response shape, non-JSON output, ...) does **not** advance
  the chain — that's worth surfacing, not papering over by trying
  something else. Both providers are called directly via `fetch` (no SDK
  dependency added, matching this app's existing fetch-a-JSON-API
  convention in `lookupBarcodeAction`/`fetchExchangeRate`), each
  constrained to the same `{ items: [{ name, quantity }] }` output shape —
  Anthropic via a forced `report_shelf_items` tool call, Gemini via
  `responseSchema`-constrained JSON output (Gemini has no
  forced-tool-choice equivalent) — and validated through the same Zod
  schema either way, so the rest of the action and the whole review UI stay
  provider-agnostic. Without any key set, the dialog explains the feature
  isn't configured instead of erroring after a photo is taken, same
  fails-gracefully pattern as `RESEND_API_KEY`/`VAPID_PRIVATE_KEY`.
  Rate-limited per household (`checkRateLimit`, 20/hour) since a scan that
  reaches Anthropic costs real money — on Gemini's free tier, Google's own
  per-minute cap binds first.
- **Transient-failure handling**: each attempt in the chain is a single
  fetch, not its own internal retry loop — a busy response (Gemini: `503
  UNAVAILABLE`, commonly hit on the free-tier Flash model under load;
  Anthropic: `529 overloaded_error`; either: plain rate limiting, `429`)
  throws `provider_busy` and lets `callAttempts` move on to the next
  *different* model/provider rather than retrying the same one — that's
  both faster (no artificial backoff delay for a request that isn't being
  identically repeated) and, per Google's own guidance for the 503 case,
  more effective than hammering the same overloaded backend twice.
  `REQUEST_TIMEOUT_MS` is 50s (a live test measured ~40s for one
  successful Gemini free-tier call, comfortably past a shorter timeout)
  and is shared as one deadline across the *entire chain* — before
  actually starting the next attempt, `callAttempts` checks
  `deadlineAt - Date.now()` against `MIN_ATTEMPT_BUDGET_MS` (15s) and
  returns `provider_busy` immediately if another attempt couldn't
  realistically finish in what's left, rather than starting one doomed to
  be aborted mid-flight. That shared deadline firing itself (an attempt
  slow enough to eat the whole remaining budget) is caught in
  `scanShelfPhotoAction` as a plain `AbortError` and mapped to the same
  `provider_busy` message, not the generic failure — the raw
  `{name: "AbortError", message: "This operation was aborted"}` this
  produces if left unmapped is exactly what surfaced in testing before
  this handling existed. On Vercel, a Server Action's own runtime is
  capped well below a Route Handler's regardless of plan, and since a
  `"use server"` file can only export async functions,
  `src/app/dashboard/inventory/page.tsx` (the route invoking this action)
  exports `maxDuration = 60` instead — Next.js/Vercel honor that as the
  invoked action's own ceiling, kept comfortably above
  `REQUEST_TIMEOUT_MS` so this action's own graceful handling always wins
  the race against Vercel's harder kill. No effect on a self-hosted
  deployment, which has no such ceiling to begin with.
- **Client-side downscale**: the captured/chosen photo is drawn onto an
  off-screen `<canvas>` and re-encoded as JPEG capped at 1568px on its
  longest edge before being sent, both to keep the Server Action's request
  body small (Next's default 1MB body limit is raised to 6MB for this one
  action in `next.config.ts`) and because that's roughly the resolution
  past which either provider's vision models stop gaining any accuracy.
- **Review before anything is written**: identical shape to the other bulk
  inventory flows — a shared category/location applies to the whole batch
  (`ComboField`, matching `BulkScanDialog`/`BulkPasteDialog`'s existing "one
  shelf/drawer per session" assumption rather than per-item category,
  which isn't something `bulkCreateInventoryItemsAction` supports today),
  each guessed row's name/quantity is freely editable, rows can be removed,
  and nothing reaches the database until "Add N items" is pressed —
  reusing `bulkCreateInventoryItemsAction` unchanged, including its
  existing case-insensitive dedupe against what the household already has.
- **i18n**: all new strings live under `inventory.aiShelfScan` in
  `en.ts`/`sv.ts`; the shared category/location/remove/add-all copy is
  reused from `inventory.bulkScan` rather than duplicated, since it's the
  same UI pattern with identical wording.

## Meal planning

`/dashboard/meal-planning` (`MealPlanningView`, a client-side tab switch
between four tabs, "Planner", "Recipes", "Cook now" and "Meal prep" — no
new route needed for the split) covers
the `Recipe` / `RecipeIngredient` / `MealPlan` / `MealPlanEntry` models:

- **Recipes**: full CRUD (`createRecipeAction` / `updateRecipeAction` /
  `deleteRecipeAction` in `src/app/dashboard/meal-planning/actions.ts`) — a
  name, optional freeform instructions, and any number of ingredient rows
  (name + quantity + unit) added/removed client-side in
  `RecipeFormDialog` before submit. Editing replaces every ingredient row in
  a `$transaction` (delete-all then recreate) rather than diffing, which is
  simpler and fine at this scale (a handful of ingredients per recipe).
- **Ingredient → inventory linking (MATCH-1, MATCH-2, MATCH-3, MATCH-5)**: saving a recipe never
  creates an inventory item on its own; design in
  `docs/archive/RECIPE_INGREDIENT_MATCHING.md` §3.
  - **Matcher** (`src/lib/recipes/ingredient-match.ts`, pure): per row, in
    order: the row's existing link or Don't-track state (edit only, name
    unchanged), an exact `normalizeItemName` match, a learned alias
    (confident; see "Don't track and learned aliases" below), the
    built-in staples (only `water`/`vatten`/`ice`/`is` as the whole
    normalized name: Don't track pre-selected, but the row stays open), a
    plural/singular fold of the last word
    (English -s/-es, Swedish -ar/-or/-er/-na, both sides; only ever a
    suggestion, since "creamer" also folds to "cream"), then
    `findInventoryMatches`
    with the AUTO-11 thresholds (`MATCH_*` constants in
    `src/lib/item-matching.ts`, shared with the receipt matcher):
    confident at ≥ 0.9 with a ≥ 0.15 lead, a pre-selected suggestion at
    ≥ 0.35 (offered, not pre-selected: see "Dialog"), otherwise none. A trailing parenthesized part of the name
    ("gul lök (finhackad)") is ignored for matching and for the default
    "Create new" name. Each match also carries a unit class from
    `classifyUnits` (`src/lib/units.ts`): `same` after `canonicalUnit`
    (st/pcs, msk/tbsp, tsk/tsp, liter/l, …), `convertible` by the generic
    table, `known` when only the item's saved conversions reach it (see
    "Unit conversions" below), or `unknown`.
  - **Preview**: `previewIngredientMatchesAction` (read-only,
    `requireHousehold`, one inventory `findMany`) returns the matches, the
    household's items (with their saved unit conversions) and categories,
    and a guessed category for each row without a confident match.
  - **Ingredient name Enter (UX-93)**: Enter in an ingredient name never
    submits the recipe. `ComboField`'s optional `onEnter` swallows an
    Enter with no suggestion highlighted and the dialog moves focus to
    that row's quantity (Enter on a highlighted suggestion still picks
    it). The popup's `Use "X"` row is a real button: tapping it keeps the
    typed value, closes the popup and moves on the same way. Inventory
    dialogs don't pass `onEnter`, so their Enter behaviour is unchanged.
  - **Recipe form order and wording (UX-98)**: the form runs in the order
    a recipe is written: Name and Portions, Ingredients, Sub-recipes,
    Instructions, Tags, then optional nutrition. The Instructions field
    says "One step per line — each becomes a step in Cook mode" (linked
    with `aria-describedby`). Tag chips are 14 px text and 44 px tall on
    phones and touch screens, 8 px apart. Quantity and Unit (and a
    sub-recipe's Batches) carry accessible names, not just placeholders.
    The sub-recipe hint is plain language. A recipe's ingredient quantity
    pluralises its unit ("3 cloves", "2 klyftor") in the recipe sheet and
    Cook mode via `unitLabelForQuantity()` and the dictionary's
    `unitsPlural` map; one and fractions of one stay singular.
  - **Combo button names (UX-129)**: every `ComboField` (category,
    location, unit, name) names its × "Clear {field}" (the field's own
    label, lower-cased, via the required `label` prop) and its chevron
    "Show suggestions", in English and Swedish (`comboboxClear`,
    `comboboxShowSuggestions` beside the other combobox strings), so a
    screen reader no longer announces two bare "button"s per field.
    `e2e/combo-button-names.spec.ts` finds them by role and name.
  - **Dialog**: pressing Save in `RecipeFormDialog` previews first. When
    every row is confident and its unit is `same`/`convertible`/`known`
    (or the row was already linked when the recipe was opened), the recipe saves
    straight away and a toast says "Saved · N ingredients linked to your
    pantry". Otherwise the dialog swaps to a "Match ingredients" step
    (`ingredient-review-step.tsx`, a content swap with a Back button, not
    a nested dialog): confident rows are collapsed in an
    `AutoMatchedSection`, the rest listed under "Needs a look" with
    "Use existing" (an `ItemCombobox`, best candidates first) or "Create
    new" (name, category, unit). Only a confident match (or a name that
    exactly equals several items) starts on "Use existing"; a weaker
    suggestion (a loose fuzzy hit or a plural fold) starts on "Create new"
    and needs a tap to accept, so one tap on "Create recipe" never links
    Rice to Ricotta (`defaultReviewChoice`, UX-90). The suggestion is
    already chosen in the picker, so that tap lands on the guessed item. The new item's unit defaults per kind:
    count units stay (canonicalized), other volumes → `l`, weights → `g`,
    spoon measures, pinches and unknown units → `pcs`. Each open row says
    why it's open ("Closest match: X. Tap Use existing if it's right." or
    "Nothing close…") and whether the pantry unit reconciles; one that doesn't gets
    the three unit choices (see "Unit conversions" below). An untouched
    default unit gets a neutral note, not the mismatch warning. Saving with an incomplete row shows a count at the top
    (`role="alert"`), marks the field `aria-invalid` with its error in
    `aria-describedby`, and focuses it. Switching steps scrolls the form to
    the top and focuses the step's title. A server error is focused from an
    effect on the action's result, once it has rendered. Only while the
    preview runs does the button read "Checking ingredients…"; during the
    save itself it reads "Creating…"/"Saving…". Step 2 has
    a text Back button in the footer as well as the header
    arrow.
    "Create all new" flips every unconfident row to "Create new". Back
    keeps decisions for rows whose name and unit didn't change, and the
    step-1 button then reads "Next: match ingredients". A saved row's
    `inventoryItemId` rides along in the dialog, so editing a recipe keeps
    its links unless a row is renamed.
  - **Save** (`resolveIngredientDecisions` in `recipe-actions.ts`): each
    row posts `ingredientDecision` (`existing` | `new` | `untracked`) with
    `ingredientItemId` or `ingredientNewName`/`NewCategory`/`NewUnit`, as
    parallel FormData arrays. Every chosen item id is checked in one
    household-scoped `findMany`; an unknown or foreign id rejects the
    save. `new` rows are deduped by normalized name and created in one
    `createManyAndReturn` (quantity 0, threshold 0, the chosen unit); a
    `new` name that already exists exactly links to that item instead. A
    row with no decision (older client, direct POST) links only on an
    exact name and otherwise stays unlinked. New items and the recipe are
    written in one interactive `$transaction`. Rows are capped at 100
    (the recipe part of SEC-7).
  - **Don't track and learned aliases (MATCH-2)**: a third review choice,
    "Don't track", saves the row with `RecipeIngredient.untracked = true`
    and no link, and never creates anything. The row stays on the recipe
    card, but `expandFromGraph` (so the shopping-list bridge, "Mark as
    cooked" and the Cook tab), the cost estimate and "use it up" skip it.
    A row with no link that isn't untracked (its item was deleted) keeps
    the old match-by-name fallback. "Don't track the rest" flips every
    unconfident row; "Create all new" leaves Don't-track rows alone. The
    save learns into `ItemAlias` (`householdId`, `normalizedName` of the
    name without a trailing "(…)", nullable `inventoryItemId`), upserted
    per name in the same transaction (so two saves teaching the same name
    at once can't collide on the unique index; the last one wins, and an
    alias whose new item somehow wasn't created is skipped rather than
    written as Don't track): linking a name to an item whose
    normalized name differs ("eggs" → Egg, including a new item created
    under another name) aliases it to that item, and Don't track aliases
    it to null. `previewIngredientMatchesAction` loads the household's
    aliases alongside its items: an item alias is a confident match and an
    untracked alias a confident Don't track, so neither is asked again.
    Deleting an item cascades its aliases. An imported row's prep note
    (the parser's `note`, passed straight through to the form row) and
    original line are saved in `RecipeIngredient.note` and
    `rawText` (capped at 200/300 characters); the note shows under the
    row in the dialog and after the name in the recipe's sheet, and the
    original line is dropped once the row is edited. A name typed by hand
    keeps its "(…)", which matching still ignores.
  - **Aliases outside recipes (MATCH-5)**: the same `ItemAlias` rows link
    shopping lists and receipts, so fixing "eggs → Egg" once fixes it
    everywhere. `src/lib/item-alias.ts` holds the pure lookup
    (`createAliasLookup`, keyed by `normalizeItemName` of the whole name,
    tracked aliases only) and `learnItemAlias`. Every caller loads the
    household's aliases once per request next to the inventory query it
    already runs and passes them in as data: `createInventoryLinker`
    (pasted/CSV import, templates, the meal-plan bridge) resolves exact
    name → alias → single confident fuzzy match; the smart add line checks
    the alias right after its exact name; the receipt matcher treats an
    alias as an exact match (see "Receipt scanning"); and
    `ResolveMappingsDialog` pre-selects the alias's item and lists it first
    (`mappingSuggestions`, `src/lib/shopping/mapping-suggestions.ts`),
    else the best fuzzy match as before. An **untracked** alias (Don't
    track) is a recipe answer, not a shopping link: it links nothing, the
    row stays unlinked for "Resolve mappings", and it doesn't block the
    fuzzy step either, so a row gets exactly what it got before aliases.
    An alias whose item isn't in the household's inventory is skipped.
    Learning also runs the other way: linking an **unlinked** shopping-list
    row to an existing item whose normalized name differs, through
    `resolveShoppingListMappingsAction` (the batch dialog) or
    `linkShoppingListItemAction` (the row's edit dialog), upserts an alias
    in the same transaction with `learnItemAlias` (household-scoped, the
    item already checked against the household, INSERT … ON CONFLICT so
    concurrent teaches don't collide; the latest answer wins). Re-pointing
    an already linked row and "Create new" teach nothing.
  - **Review ingredient matches (MATCH-5)**: a button in each recipe's sheet
    (hidden for a recipe with no ingredients) opens `RecipeFormDialog`
    (`startAtReview`) straight at the "Match ingredients" step for that
    recipe, with the matched rows expanded. It runs the same read-only
    `previewIngredientMatchesAction` over the rows as saved, sending each
    row's link and Don't-track state, so a linked row comes back as "Use
    existing" with its item, an untracked one as "Don't track", and only a
    row with neither (its item was deleted) goes through the matcher.
    Save is disabled until the preview has loaded. Saving is the normal
    `updateRecipeAction` with a decision for every row, so a moved link is
    saved and learned as an alias exactly as in an edit, and a row the
    user didn't touch is saved with the link it had. Back leads to the
    recipe's fields.
  - **Unit conversions (MATCH-3)**: `ItemUnitConversion`
    (`inventoryItemId`, `fromUnit` stored as `canonicalUnit`, `factor` > 0,
    unique per item and unit, cascade on item delete) means "1 `fromUnit`
    = `factor` × the item's unit". `convertForItem(qty, fromUnit, item,
    conversions)` in `src/lib/units.ts` tries the same unit, the generic
    table, then one of the item's conversions for exactly that unit, then
    one reached through the generic table ("1 kg" → g → pcs); a factor
    that isn't a positive number is ignored. In the review, a row whose
    unit is `unknown` for the chosen (or new) item offers "Remember for
    this item" ("1 pcs = [2000] g", written the way people know it: the
    item's unit first when it's a count, or a volume against a recipe
    weight, and the recipe's unit first otherwise), "In this recipe only"
    ("[0.15] pcs") and "Decide when cooking". Remember is pre-selected and
    pre-filled, marked "≈", when `unitConversionHint`
    (`src/lib/recipes/unit-hints.ts`: about 20 staples with a typical
    density or piece weight, e.g. flour ≈ 0.6 g/ml, egg ≈ 55 g) covers the
    item and both units; otherwise Decide when cooking is the default, and
    it's always the default for a row that wasn't up for review. An empty
    or non-positive amount blocks the save like any incomplete row. The
    save posts `ingredientUnitAction` (`none` | `remember` | `override` |
    `defer`) with `ingredientUnitFactor` (per recipe unit, 1e-6–1e6) or
    `ingredientOverrideQuantity`; the server ignores them for a unit the
    generic table already reconciles, and for a Create new row that ends
    up on an item counted in another unit than the one the user answered
    for (its name already exists, or an earlier row made the item in
    another unit), where the choice is dropped and the row is left to be
    decided when cooking. The review applies the same factor bounds, so
    an out-of-range factor is flagged on the row. `remember` upserts the conversion
    in the recipe's transaction, only for an item checked against the
    household or created by this save; `override` stores the row in the
    item's unit and amount, keeping the original line in `rawText`
    (built from the row when it had none). An item's conversions are
    listed, added, edited and deleted on its item page, where "Change
    unit…" re-expresses them; the item form can't change the unit of an
    item that has any (see "Item page (MATCH-6)" under Inventory). `parseComponentRows`
  in the same file batches its sub-recipe existence check the same way — one
  `recipe.findMany` across every candidate id instead of a `findFirst` per
  row — while `wouldCreateCycle`'s per-candidate graph walk stays as-is
  (it's not a flat lookup).
- **Weekly planner**: a Monday-start week grid (one card per day, one slot
  per `MealType`) addressed by a `?week=yyyy-mm-dd` search param on
  `/dashboard/meal-planning` (default: the Monday of the current week).
  Every date — the param, `MealPlan.weekStartDate`, and `MealPlanEntry.date`
  — is normalized to UTC midnight (`src/app/dashboard/meal-planning/date-utils.ts`)
  so it round-trips through the URL and Postgres without local-timezone
  drift shifting it to a neighboring day. A `MealPlan` row is created lazily
  (`prisma.mealPlan.upsert` on the `[householdId, weekStartDate]` unique
  constraint) the first time a meal is actually added to that week, not on
  page view, so browsing to an empty future/past week doesn't write rows.
- **Days and controls (UX-5, UX-21)**: a day card lists only what's
  planned, in slot order, then one "+ Add meal" button, and the dialog asks
  for the slot (a "Meal" select: Dinner preselected, or the first empty
  slot once dinner is planned). Empty slots get no rows of their own, so
  an empty week is 7 buttons and a week of dinners isn't 21 "Add meal"
  rows on a phone (DESIGN.md M6). The controls are one row: ‹ ›, the week
  range, "This week" (only when another week is shown) and a ⋯ menu ("More
  planner actions") holding "Copy last week" (empty week only), "Fill
  empty days" and "Add missing ingredients to shopping list" (the week's
  main shopping-list action is the bottom "Add N missing" button, UX-91,
  see "Meal-plan → shopping-list bridge"). On phones
  that row is sticky at the top of the scrolling page (the shopping list's
  frosted add-bar style), so the week and its arrows stay in view. On
  load, the current week scrolls today's card into view, below the sticky
  row, when it isn't already fully visible (the old "Jump to today" button
  is gone). Today's card says so in words (UX-99): a "Today" badge
  beside the day number and `aria-current="date"`, besides the ring (never
  colour alone). Each day's button is named by its day ("Add meal, Mon 12"),
  and a recipe's star by the recipe ("Favorite Greek salad"), so a screen
  reader's button list isn't seven identical "Add meal"s. The two recaps (variety and nutrition) sit under the week,
  inside the Planner tab's Suspense boundary, so they appear together with
  the planner and an empty or dismissed one never collapses a slot after
  the first paint (that kept /meal-planning over the UX-42 CLS budget).
  `e2e/meal-planner-empty-slots.spec.ts` and
  `e2e/meal-planner-rows.spec.ts` cover it.
- **Meal rows and their sheet**: each planned meal is one tappable row
  (`MealEntryRow`): the slot, the name and portions, a "Prepped" badge
  (GAP-49) and a "Cooked" tick with the word, and a chevron. Tapping it
  opens a sheet titled with the meal ("Dinner · Thu 15 · 4 portions")
  holding labelled actions: "Mark as cooked" (or "Mark as eaten" for a
  prepped meal) as the one primary, then Cook, Edit meal, Move meal and
  "Don't use prep", each only when it applies; a custom meal says why it
  has no "Mark as cooked". "Remove meal" sits last, under a rule, apart
  from the rest (M2). It replaced five unlabelled icon buttons on every
  row. The sheet hands off through dialog handles (`createDialogHandle`,
  the shopping list's ⋯-menu pattern): it closes as the chosen dialog
  opens, so closing that one, or the phone's back, lands on the planner.
- **Assigning a meal**: `addMealEntryAction` assigns either an existing
  `Recipe` (picked from a searchable list, UX-96) or a freeform meal name
  (`MealPlanEntry.freeformName`, when the special "Custom meal…" option is
  chosen) to a date + `MealType` slot. When the household has a recipe or
  a meal-prep batch to pick, the add dialog opens on that picker with
  nothing chosen (an empty "Search recipes" field over the list) rather than on
  "Custom meal…" and an empty name field (M4: pick, don't type); adding
  without a choice gets "Choose a recipe or enter a meal name". With
  nothing to pick it opens on the name field as before. There's no uniqueness constraint on
  `(date, mealType)` — multiple entries can stack in one slot (e.g. two
  snacks), matching the schema.
- **Copy last week** (BACKLOG GAP-23): an empty week's planner ⋯ menu
  shows a "Copy last week" item (`copyLastWeek` in
  `week-planner.tsx`) that calls `copyWeekAction(fromWeekStart,
  toWeekStart)` in `planner-actions.ts` as a click action. Both keys are
  Zod-validated as `yyyy-mm-dd` Mondays and must differ; the household
  comes from `requireHousehold()` as always. The action reads the source
  week's entries and moves each one by the whole-week day offset (Tuesday
  stays Tuesday), keeping `mealType`, `recipeId`/`freeformName` and
  `portions`. `consumedAt` is never copied. Recipe ids are re-checked
  against the household in one `recipe.findMany`, and an entry that ends up
  with neither a recipe nor a name is dropped. Any target slot
  (date + `mealType`) that already has an entry is skipped, not overwritten.
  The target `MealPlan` is upserted lazily, like `addMealEntryAction`
  does, and only if there's at least one row to write. Rows are inserted
  with one `createManyAndReturn`. The toast shows how many meals were
  copied, with an Undo that calls `undoCopyWeekAction(entryIds)`. That
  deletes exactly those ids, scoped to the household and to entries not
  marked cooked, or linked to a prepared batch (GAP-49), since: either
  makes the entry real, and deleting a linked one would lose the batch's
  portions. When last week has nothing to copy, the toast says
  so and nothing is written. The button is only offered on an empty week:
  the action would handle a partly filled one, but a copy that silently
  works around existing meals is harder to predict.
- **Fill empty days** (BACKLOG GAP-45): a "Fill empty days" item in the
  planner header's ⋯ menu, which keeps the controls one row on a phone
  (`FillEmptyDaysDialog`,
  `src/components/meal-planning/fill-empty-days-dialog.tsx`), shown while at
  least one day has no entries and hasn't passed yet. It opens a preview with
  one proposed dinner per such day, taken from favorites first
  (`Recipe.isFavorite`) and then the household's other recipes once
  favorites run out (UX-97), skipping recipes already on the week's plan and
  never the same recipe twice (`proposeDinners` in `fill-empty-days.ts`,
  each group in name order). With fewer unplanned recipes than empty days
  the later days are simply left out, and the dialog says so; with no
  recipes at all it says to add some.
  The proposal is computed on the client from data the page already has and
  **nothing is written** until "Add dinners"; Cancel or closing discards it,
  and reopening re-proposes. Each row has a swap button that moves to the
  next unused recipe (`nextSwap`, favorites first), so the no-repeat rule holds without a
  free picker. Accepting calls `fillEmptyDaysAction(weekStart, picks)` in
  `planner-actions.ts`: the week must be a Monday, picks are at most seven
  with unique in-week dates and unique recipes, the recipes are re-checked
  against the household in one `findMany`, a day that gained an entry since
  the preview opened is skipped, and the DINNER rows get the recipe's own
  `servings` as portions. The `MealPlan` is upserted lazily and only if
  there's a row to write. The toast ("Planned N dinners") has an Undo that
  reuses `undoCopyWeekAction` with the written ids. No schema change.
  `e2e/meal-planner-fill-empty-days.spec.ts` covers cancel, swap, accept
  (entries present after reload) and undo.
- **Editing a meal entry**: an entry that hasn't been cooked yet has a
  pencil button. It opens the same `MealEntryDialog` in `mode="edit"`,
  backed by `updateMealEntryAction`, which changes the entry's recipe or
  freeform name and its portions. Each recipe entry in the planner shows
  its portion count next to the name ("Lasagna · 2 portions").
- **Moving a meal entry (GAP-30)**: next to the pencil, an uncooked entry
  has a move button (`MoveMealDialog`,
  `src/components/meal-planning/move-meal-dialog.tsx`) with a date picker
  and a meal-type select, the same picker "Add to plan" uses. No
  drag-and-drop: the picker works the same on a phone, where the planner
  stacks into one column, and can reach any week. It's backed by
  `moveMealEntryAction`, a sibling of `updateMealEntryAction` that only
  changes `date`, `mealType` and `mealPlanId`, so the recipe, freeform name
  and portions carry over untouched.
  - The target week is derived on the server from the picked date
    (`getWeekStart`). The client sends no week key, so an entry can't be
    filed under a `MealPlan` whose week doesn't contain its date. A date in
    another week find-or-creates that week's `MealPlan` the way
    `addMealEntryAction` does. The source week's plan row stays even if the
    move empties it.
  - Slots stack like they do for add: moving into a slot that already has a
    meal puts both there. There's no uniqueness constraint on
    (date, meal type).
  - **Cooked meals can't be moved.** The button is hidden once an entry has
    `consumedAt` (like the pencil), and the action refuses with "A cooked
    meal can't be moved". A cooked entry's day and slot record when the meal
    was eaten and its ingredients left inventory, so moving it would rewrite
    history rather than change a plan.
  - Moving an entry dismisses any open "Meal not logged" reminder for it in
    the same transaction. Rescheduling a meal answers that nudge. The
    reminder is dismissed, not deleted, so the "at most once per entry,
    ever" rule still holds.
  - The success toast names the meal. When the new date is in a different
    week than the one on screen, the meal disappears from view, so the toast
    says so and offers "View that week", the same as "Add to plan".
- **Scaling a recipe to how many it's feeding (GAP-11)**: every recipe
  entry carries `MealPlanEntry.portions`, the number of people that slot
  is cooking for. The meal entry dialog's "Portions" field sets it. Picking
  a recipe pre-fills it with that recipe's own `Recipe.servings` ("one
  full recipe"), and the user can change it to any whole number from 1 to
  1,000. The add and update actions validate it with Zod
  (`z.coerce.number().int().min(1).max(1_000)`), and when it's left out
  they fall back to the recipe's `servings`. A freeform entry has no
  recipe, so its portions are never used. Ingredient quantities are scaled
  by `portionsMultiplier(portions, servings)` =
  `portions / servings` (`src/app/dashboard/meal-planning/recipe-expansion.ts`,
  tested in `recipe-expansion.test.ts`). That value is the `multiplier`
  passed to `expandRecipeIngredients`, which carries it down through
  every sub-recipe. A recipe for 4 planned for 2 therefore puts half of
  every ingredient (sub-recipes included) on the shopping list. The same
  helper feeds both the shopping-list bridge and "Mark as cooked" below,
  so what a meal is predicted to need and what cooking it takes out of
  inventory always agree. When the ratio can't be computed (`servings` or
  `portions` missing, 0 or less, or not finite), the multiplier is 1 and
  the recipe counts as written. A 0 would drop every ingredient, and an
  Infinity would propose buying an impossible amount. "What can I cook
  right now?" (`getCookableRecipes`) isn't tied to a plan entry, so it
  always checks one full batch (multiplier 1). There's no separate
  "servings override" column. An earlier proposal for one would have
  duplicated `portions`, which already has this job.
  - **One graph fetch per request, not per recipe (PERF-1)**: expanding a
    recipe (including its sub-recipes) walks an in-memory
    `Map<recipeId, RecipeGraphNode>` built by `loadRecipeGraph`
    (`recipe-expansion.ts`) — one `recipe.findMany` for the whole
    household. `expandRecipeIngredients` is the one-shot convenience for a
    caller expanding a single recipe (`previewCookedIngredientsAction`,
    `markMealEntryCookedAction`): it loads the graph itself, then walks it.
    A caller expanding *several* recipes in one request —
    `getCookableRecipes` (every recipe in the Cook tab, against full
    household inventory) and `previewMissingIngredientsAction` (every
    planned entry in the chosen date range) — instead calls
    `loadRecipeGraph` once and calls the pure, non-DB-touching
    `expandFromGraph` per recipe/entry against that shared result. Before
    this, both call sites called `expandRecipeIngredients` in a loop, so
    each recipe/entry re-ran the whole-household query on its own: a
    50-recipe household loading the Cook tab (server-rendered even when
    that tab is hidden) issued 50 queries fetching O(R²) rows total, each
    competing for a pg pool connection. Cycle handling, scaling and
    component-recipe resolution are unchanged — only how many times the
    graph is fetched.
- Weekday header labels (Mon–Sun) come from the `mealPlanning` dictionary
  namespace rather than `Intl`/the browser's locale, so they follow the
  app's own language toggle instead of the visitor's OS/browser language.

### Recipe nutrition info

`Recipe` carries four optional fields — `caloriesPerServing Int?`,
`proteinGramsPerServing Float?`, `carbsGramsPerServing Float?`,
`fatGramsPerServing Float?` — for a household to note a recipe's nutrition
by hand. All four are **manual-entry only**: there is no lookup against a
nutrition API (USDA, Edamam, or similar) anywhere in this feature, and
adding one is explicitly out of scope — it would need its own SSRF-safe-fetch
review, the same as the recipe-URL-import feature below, and is a separate,
larger effort. Every field is nullable and independent of the others (a
recipe can have calories set with the rest left blank).

- **Per serving, not totals**: `Recipe.servings` already exists (how many
  portions the ingredient list makes), so these four track the same
  per-serving framing rather than adding a totals-vs-per-serving toggle —
  the per-serving number is what's actually useful when reading a recipe
  card, and keeping a single unit avoids a second field/conversion per
  nutrient.
- **Form**: `RecipeFormDialog` keeps the four inputs collapsed behind a
  plain "Add nutrition info" toggle button (uncontrolled `useState<boolean>`,
  defaulting open only when editing a recipe that already has at least one
  value set) rather than always-visible fields — no collapsible/disclosure
  primitive existed in `src/components/ui/` and this is a secondary,
  rarely-filled part of the form. None of the four inputs are `required`,
  matching how `instructions` is already optional here.
- **Persistence**: `createRecipeAction`/`updateRecipeAction`
  (`src/app/dashboard/meal-planning/recipe-actions.ts`) parse each field as
  an optional Zod string, transforming a blank/omitted value to `null`
  (never `undefined`) — the same optional-string-to-nullable convention
  `InventoryItem.expiresAt` uses in `src/app/dashboard/inventory/actions.ts`
  — so editing a recipe to clear a previously-set nutrition value actually
  writes `null` on save rather than leaving the old value untouched.
  `caloriesPerServing` is additionally rounded to the nearest whole number
  (matching its `Int` column) since the input allows only whole calories.
- **Display**: `RecipeManager` renders a nutrition summary line
  (`"320 kcal · 20g protein · 30g carbs · 10g fat"`, only the fields that
  are actually set) under a recipe's ingredient/sub-recipe summary — never
  shown at all for a recipe with all four fields null, which is expected to
  be the common case.

### Recipe cost estimate (GAP-15)

Each recipe on the Recipes tab shows a rough cost to make it, e.g.
`"~45.00 total · ~11.25/portion"`, on its own line under the nutrition
summary. No schema change: it joins data that already exists —
`RecipeIngredient` → its linked `InventoryItem.lastKnownPrice` (kept current
by AUTO-4, above) and the purchased shopping-list line that set it — through
the same unit table (`src/lib/units.ts`) the
meal-plan → shopping-list bridge uses.

- **Per-unit price**: `lastKnownPrice` is the price of one purchased
  shopping-list *line*, whatever quantity that line was for (a 500 g pack
  of flour for 24 records 24), not the price of one of the item's unit. So
  `unitPriceFromLastPurchase` recovers the line that set it — the newest
  purchased `ShoppingListItem` linked to the item whose `estimatedPrice`
  equals `lastKnownPrice` (every writer of `lastKnownPrice` leaves one) —
  converts that line's `quantity`/`unit` into the item's unit, and divides:
  24 ÷ 500 g = 0.048 per g. Matching on the price, not just taking the
  newest row, matters because `ShoppingListItem` only has `createdAt`, not a
  purchase time.
- **Calculation**: `computeRecipeCost(ingredients, servings)`
  (`src/app/dashboard/meal-planning/recipe-cost.ts`, pure, unit-tested in
  `recipe-cost.test.ts`) converts each ingredient's quantity into its linked
  item's own unit — `convertForItem`: the same unit, the generic table,
  then the item's saved conversions (MATCH-3; `page.tsx` loads them for
  the priced items in one query alongside the purchase lines) — and
  multiplies by that per-unit price (200 g of the
  flour above is 9.60). `total` and `perServing` (`total / servings`) are
  rounded to 2 decimals.
- **Skipped, not guessed**: an ingredient with no linked inventory item, a
  linked item that has never been priced, a price whose purchase line can't
  be found (its list was deleted, or the price was corrected afterwards), a
  purchase line in a unit that can't be converted into the item's (the
  typical "1 pcs" receipt line for an item kept in grams, unless the item
  has a saved conversion for pcs), or a recipe unit that can't be
  converted into the item's (volume vs. weight, or an unrecognized unit
  like "clove" against "pcs", with no saved conversion) is left out and counted in
  `skippedCount`. The card then appends "N ingredients not priced" so the
  total reads as a partial estimate. A price of 0 counts as priced. A
  multi-pack entered as "1 pcs" of an item counted in pcs still reads as one
  piece — the same way inventory stock counted it.
- **Hidden when unknown**: if no ingredient at all could be priced the
  function returns `null` and no line is shown, same as the nutrition line.
- **Own ingredients only**: a sub-recipe's (`RecipeComponent`) ingredients
  aren't added in, matching how the nutrition line is per recipe.
- **Data flow**: `RecipesTabSection` (`meal-planning/page.tsx`) computes a
  `recipeCosts` map keyed by recipe id from the already-cached core fetch
  (`lastKnownPrice` was added to its inventory `select`) plus one extra
  query on this tab only: the household's purchased, priced shopping-list
  lines for the inventory items some recipe links to, newest first. It
  passes the map with the `locale` to `RecipeManager`. Amounts use the app's
  `createMoneyFormat` convention (locale-aware, 2 decimals, with the
  household's GAP-13 currency symbol when one is set), prefixed with "~" to mark them as estimates; the line's tooltip
  explains they come from what was last paid.

### Weekly nutrition recap

A dismissible summary card on the Planner tab (BACKLOG GAP-2) that sums the
*currently-displayed week's* planned entries' per-serving nutrition fields
(above) into one line — e.g. `"This week's planned meals: 1000 kcal · 70g
protein · 80g carbs · 30g fat"`. It sits directly under the existing
`MealVarietyRecap` card and mirrors its shape exactly (dashed-border row,
leading icon, one-line text, trailing dismiss button), but is a separate
component and computation, since the two summarize different things: variety
counts distinct recipes over a trailing 30-day window regardless of which
week is on screen, while the nutrition recap totals nutrition for just the
one week currently shown.

- **Computation**: `computeNutritionRecap`
  (`src/app/dashboard/meal-planning/nutrition-recap-calc.ts`) is a pure
  function over the week's `MealPlanEntry` rows (already loaded with their
  `Recipe` joined in for the planner grid, so this adds no extra query). Each
  of the four nutrition fields is summed **independently** — a recipe with
  calories but no protein entered still contributes its calories — by
  multiplying the recipe's per-serving figure by that entry's `portions`
  (already a serving count, not a multiplier on `Recipe.servings`, so no
  further scaling is needed). A freeform entry (`recipeId: null`) and a
  recipe with all four fields null never contribute. A total stays `null`
  (not `0`) when nothing in the week set that field, so the summary line
  only lists fields the household actually entered, same "quiet week
  produces nothing, not a zero" framing as the variety recap.
- **Not a goal tracker**: there is no macro target anywhere in this feature —
  no "goal" field, no over/under coloring, no progress bar. It only ever
  states what was planned. A goal-setting layer on top of this is explicitly
  out of scope; it would be a much bigger, opt-in feature worth considering
  later only if this recap turns out to get used.
- **Display**: `MealNutritionRecap`
  (`src/components/meal-planning/meal-nutrition-recap.tsx`) renders only
  when `contributingEntryCount > 0`, reusing the same
  `nutritionCaloriesValue`/`nutritionProteinValue`/`nutritionCarbsValue`/`nutritionFatValue`
  dictionary templates `RecipeManager`'s per-recipe nutrition line uses, so
  the units read identically in both places.
- **Dismissal**: persists in `localStorage` under
  `mealPlanning.nutritionRecapDismissedWeek` (listed in
  `src/lib/cookie-inventory.ts`), keyed by the planner's own `weekStartKey` —
  unlike `MealVarietyRecap`'s dismissed-*count* key, this recap is
  inherently tied to one specific week, so it uses the same per-week-key
  approach as `TasksWeeklyRecap` (`src/components/tasks/tasks-weekly-recap.tsx`)
  instead: dismissing this week's recap doesn't hide a different week's, and
  navigating back to an already-dismissed week keeps it hidden.

### Recipe import from URL

`RecipeFormDialog` (`src/components/meal-planning/recipe-form-dialog.tsx`,
used for both create and edit) has an "Import from a URL" input + button
above the manual fields, in its own sibling `<form>` (an HTML form can't
nest inside the create/edit form) bound to `importRecipeFromUrlAction`
(`src/app/dashboard/meal-planning/actions.ts`). Importing never saves
anything by itself — it only pre-fills the name/instructions/ingredient-row
state (which had to move from uncontrolled `defaultValue`s to controlled
React state to support this) so the user can review and edit before
submitting the normal create/save action, per the "never auto-save an
imported recipe" requirement.

- **Parsing** (`src/lib/recipe-import.ts`, pure functions, no network,
  unit-tested with inline HTML/JSON fixtures in
  `src/lib/recipe-import.test.ts`): a regex extracts every `<script
  type="application/ld+json">` block's contents (`extractJsonLdBlocks`);
  each is `JSON.parse`d (retrying after a light HTML-entity decode for sites
  that escape their own JSON-LD) and scanned for an object whose `@type`
  includes `"Recipe"`, including one nested inside an `@graph` array
  (`findRecipeNode`). No DOM parser (`cheerio`/`jsdom`) was added — neither
  was already installed (checked `package.json` per the ground rules) and
  the regex approach worked against real recipe sites tried during
  development.
  - `name` maps directly. `recipeInstructions` (a string, an array of
    strings, or an array of `HowToStep`/`HowToSection` objects) is flattened
    to plain text, one step per line (`flattenInstructions`).
  - `recipeIngredient` (or the older `ingredients` field some sites still
    emit) is a flat array of strings like `"2 cups flour"`;
    `parseIngredientString` best-effort-splits each via a leading-number
    regex (handling plain integers/decimals, simple fractions, and mixed
    numbers like `"1 1/2"`) plus a fixed list of common unit words. When
    there's no leading number, or a recognized unit word isn't the very next
    word, the whole string goes into `name` with quantity `1` rather than
    guessing wrong, per the task's explicit instruction — e.g. `"2 cups
    flour"` → `{quantity: 2, unit: "cups", name: "flour"}`, `"2 eggs"` →
    `{quantity: 2, unit: "pcs", name: "eggs"}` (no recognized unit word, but
    a confident leading number), `"a pinch of salt"` → `{quantity: 1, unit:
    "pcs", name: "a pinch of salt"}` (no leading number at all).
  - **Richer ingredient lines (MATCH-4)**: the leading number may also be a
    unicode fraction (`½ ¼ ¾ ⅓ ⅔ …`, `1½`, `1 ½`, and `1⁄2` with a fraction
    slash), a comma decimal (`1,5`), an English thousands separator
    (`1,000`, read as 1000; only a non-zero lead of 1–3 digits followed by
    groups of exactly three, so `0,125` and `1,25` stay decimals), or a range (`2-3`, `2–3`, `½-1`),
    which takes the upper bound and keeps `2–3` in the note. A leading
    `ca`/`ca.`/`c:a`/`cirka`/`ungefär`/`about`/`approx.`/`approximately` is
    dropped. A unit glued to the number (`500g`, `2dl`) is read like a
    spaced one, and a parenthesized pack size between number and unit
    (`1 (400 g) burk tomater`) doesn't hide the unit. The name is then
    split into the thing itself and an optional `note`: text inside
    parentheses, text after the first comma, and a leading preparation word
    go to the note, joined with `, ` and led by the range. The leading list
    is kept to words that never name a packaged product (`finhackad`,
    `grovhackad`, `pressade`, and adverb forms like `fint hackad` /
    `finely chopped`), so `krossade tomater`, `riven ost`, `skivad mandel`,
    `crushed red pepper`, `minced garlic`, `chopped tomatoes`, `kokta
    linser` and `ground beef` stay whole; after a comma any word is a note
    (`parmesan, riven`). `"1 gul lök,
    finhackad"` → `{quantity: 1, unit: "pcs", name: "gul lök", note:
    "finhackad"}`. The note never empties the name; if it would, the text
    stays whole. Every parsed row also keeps `rawText`, the line as written
    (whitespace collapsed). `parseIngredientLine` wraps
    `parseIngredientString` and splits the fixed pair "salt och peppar" /
    "salt and pepper" / "salt & pepper" / "salt, peppar" (and
    `svartpeppar`, `black pepper`, …) into two rows that share quantity, unit, note and `rawText`; no
    other "X and Y" is split, so "sweet and sour sauce" stays one row. All
    three extraction tiers use `parseIngredientLine`. Units are passed
    through as written (`st` stays `st`); canonicalizing them is the
    matcher's job. Until recipe ingredients have a note column,
    `parseRecipeFromHtml` hands the form each row with the note appended to
    the name in parentheses (`"gul lök (finhackad)"`), so the user still
    sees it, and rounds each quantity to two decimals (`⅓` → `0.33`); the
    tier parsers keep `name` and `note` apart and the exact quantity. This relies on
    MATCH-1's matcher ignoring a trailing parenthesized part when it links
    rows to inventory items.
  - **Fallbacks for non-JSON-LD pages (GAP-31)**: if no usable Recipe
    JSON-LD is found, `parseRecipeFromHtml` tries two best-effort tiers, in
    order, stopping at the first that yields something. JSON-LD always wins
    when present, and its output is unchanged apart from the new `source`
    field. Both fallbacks first strip `<script>`/`<style>`/`<noscript>`/
    `<template>`/`<svg>` and HTML comments so markup inside them can't be
    mistaken for content, and both stay regex/string-based (a small
    same-tag depth counter, `sliceElement`, finds an element's matching
    close tag, with a 200k-char scan cap so malformed markup can't make it
    quadratic on a 3MB page).
    1. **schema.org Microdata** (`parseMicrodataRecipe`): the first element
       with `itemscope` and an `itemtype` of `http(s)://schema.org/Recipe`.
       Only the Recipe's *own* `itemprop`s count — one inside a nested
       `itemscope` (the author's `Person`, a review) is skipped, so the
       author's `name` never becomes the recipe name, while a nested
       `HowToStep` that is itself `itemprop="recipeInstructions"` still
       counts, as its full text. Reads `name` (falling back to the page's
       `<h1>`/`<title>`), `recipeIngredient` (or legacy `ingredients`, each
       run through `parseIngredientString`), and `recipeInstructions` (one
       line per block element). A `content` attribute overrides visible
       text, on `<meta>` and elsewhere. `recipeYield` isn't mapped, same as
       the JSON-LD tier, which doesn't map it to servings either.
    2. **Heading heuristic** (`parseHeuristicRecipe`): name from the first
       `<h1>`, else `<title>` minus a ` | Site name`/` - Site name` suffix;
       ingredients from the `<ul>`/`<ol>` items after an `<h1>`–`<h6>`
       whose whole text is "Ingredients"/"Ingredienser" (plus a few other
       languages, an optional trailing colon, and "… till 4 portioner"/"…
       for 4 servings"), continuing past sub-headings ("For the glaze")
       until a heading at the same or a higher level or a method heading;
       instructions the same way after "Instructions"/"Method"/"Gör så
       här"/…. A section with no list falls back to its `<p>`s (where an
       unclosed `<p>` ends at the next block element). No ingredients means
       no result — a page title alone would "succeed" on every blog post.
  - The result carries `source: "jsonld" | "microdata" | "heuristic"`
    (`ImportedRecipe`), passed through `ImportRecipeState.recipe.source` to
    the form. If all three tiers find nothing, `parseRecipeFromHtml`
    returns `null` and the action surfaces
    `dict.mealPlanning.importErrorNoRecipeFound`. That's still expected on
    some real-world pages and isn't treated as a bug.
- **SSRF guard**: this is a server-side fetch of a user-supplied URL, so
  `validateRecipeUrl` (pure) rejects anything that isn't `http:`/`https:`,
  `localhost`/`*.localhost`, and an IP-literal hostname in a
  private/loopback/link-local/reserved range (checked via small CIDR-range
  helpers for both IPv4 and IPv6, including IPv4-mapped IPv6 addresses).
  `fetchRecipeHtml` is built on `node:http`/`node:https` rather than
  `fetch`, specifically so DNS resolution can be pinned: `createPinnedPublicLookup`
  is passed as the `lookup` option on every request, so the *same* `dns.lookup`
  call that gets checked against the private/reserved ranges is the one Node
  connects to — there's no separate "validate, then let fetch resolve again
  to connect" step for a TTL-0/hostile DNS server to answer differently the
  second time (SEC-2; that gap used to exist between a pre-flight
  `assertResolvesToPublicAddress` check and `fetch`'s own resolution).
  Redirects are followed manually specifically so each hop gets its own
  fresh, pinned resolution before being followed, rather than trusting
  automatic redirect handling. The response body is read via a capped
  streaming reader (3MB) rather than buffered in full, and the whole fetch
  (connect through body read) has an 8s timeout via `AbortController` that
  stays armed until the body finishes reading, not just until headers
  arrive. One consequence of not using `fetch`: no `Accept-Encoding` is
  sent, so responses arrive uncompressed rather than via `fetch`'s automatic
  gzip/br negotiation — heavier over the wire, but still capped at 3MB and
  this only ever fetches one page per import. `recipe-import.test.ts`
  exercises this network-dependent path by mocking `node:dns`/`node:http`/
  `node:https` (never a real connection) — covering the DNS-rebinding guard
  and the abort timer staying armed through the body read — while the pure
  parsing and pure URL-scheme/IP-literal validation stay unit-tested as
  before. A faked `node:http`/`node:https` can only prove
  `createPinnedPublicLookup` satisfies whatever contract the fake itself
  expects, not Node's real one — `net`'s `autoSelectFamily` (on by default
  since Node 20) makes `http(s).request` always call `lookup` with
  `{ all: true, ... }`, and a `lookup` that ignores `options.all` breaks
  every real request with `ERR_INVALID_IP_ADDRESS`. `recipe-import.real-http.test.ts`
  (deliberately a separate file, so it can leave `node:http`/`node:https`
  unmocked) proves the real contract end-to-end: it spins up a real
  `http.createServer` on loopback and runs `fetchRecipeHtml` against it for
  real, mocking only `node:dns` (so a made-up hostname resolves to that
  server) and, for the one case that needs a real connection to succeed,
  swapping in a different private-address check via the test-only
  `_setPrivateAddressCheckForTests` seam — loopback is genuinely private,
  so that override is what lets the "succeeds end-to-end" case connect at
  all; the "refuses and never connects" case in the same file uses the
  real, unmodified guard. `importRecipeFromUrlAction` (`recipe-actions.ts`)
  also rate-limits this per household
  (`checkRateLimit("recipe-import:<householdId>", 20/hour)`,
  `dict.mealPlanning.importErrorRateLimited` on refusal) — this action
  makes the server fetch an arbitrary URL, so without a limit a household
  could use it to hammer a third-party host, or repeatedly probe internal
  addresses past the guard above.
- **Feedback**: `importRecipeFromUrlAction` returns `ImportRecipeState`
  (`ActionState & { recipe?: {...} }`, following the same
  `(prevState, formData) => Promise<State>` shape as every other
  `useActionState`-bound action in this file) with a translated `error`
  string on failure or the parsed `recipe` on success; `RecipeFormDialog`
  shows a translated success line ("Imported — review the fields below,
  then save.") rather than closing the dialog, since the point is manual
  review before saving. For a `microdata` or `heuristic` result it shows a
  warning-styled "Review before saving" notice (`importLowConfidence`, in
  both dictionaries) instead, saying the fields were guessed from the
  page's layout and may be incomplete or wrong.

### Meal-plan → shopping-list bridge

A planned week's primary action (UX-91) is "Add N missing to shopping list",
where N is the number of ingredients the visible week still needs (counted
on the server by `loadMissingIngredients`, `missing-for-range.ts`, the same
diff the dialog previews). It is a `PrimaryAction` button at the bottom of
the planner, floating above the bottom bar on phones (M2), and it is hidden
on an empty week or when nothing is missing. It opens the review dialog
below; the ⋯ menu keeps "Add missing ingredients to shopping list" for
other date ranges. After adding, the toast says how many items landed ("Added
2 items to "Weekly shop"", or "Everything was already on …" when all were
duplicates) and has an "Open list" action that goes to that list
(`addMissingIngredientsToShoppingListAction` returns `{ listId, addedCount }`).
The review dialog (`MissingIngredientsDialog`,
`src/components/meal-planning/missing-ingredients-dialog.tsx`) opens from
that button or the ⋯ menu in the weekly planner (`WeekPlanner`). By default it's scoped to the whole visible week — the
pattern every competitor researched (Mealime, Paprika, Plan to Eat, Whisk)
uses — but it can cover any date range up to 31 days (GAP-32):

- **Date range (GAP-32)**: a "Plan period" `<Select>` at the top of the
  dialog offers "This week" (the visible planner week, `[Monday, next
  Monday)`; always selected when the dialog opens, so the default is
  unchanged), "This week and next" (the visible week plus the following one,
  anchored on the planner's week rather than today, same as "This week"),
  and "Custom dates…", which shows From/Through date inputs (Through is
  inclusive in the UI and shifted one day to an exclusive end before
  calling). Changing the period re-runs the preview; a stale response from a
  slower earlier request is ignored. The action takes a half-open
  `{ from, to }` pair of `yyyy-mm-dd` keys, validated with Zod by
  `parseMissingIngredientsRange` in `missing-ingredients.ts` — both must be
  real calendar days, `to` after `from`, and the span at most
  `MAX_MISSING_INGREDIENTS_RANGE_DAYS` (31), enough for "the next two weeks
  before a big trip" or a whole month without letting one preview fan out
  into hundreds of recipe expansions. The dialog runs the same check and
  shows an inline error instead of calling; the server rejects anything
  else with "Invalid date range" without querying. No schema change: the
  range filters `MealPlanEntry.date` directly (scoped through
  `mealPlan: { householdId }` from the session), so it spans however many
  weekly `MealPlan` rows fall inside it, or starts mid-week. For "This week"
  that selects the same entries the old single-`weekStartDate` lookup did,
  since the planner only dates an entry on its own plan's seven days.
  `addMissingIngredientsToShoppingListAction` takes no range: it commits
  exactly the reviewed rows the preview returned, so preview and apply can't
  disagree about which days were included.
- **Diffing**: opening the dialog calls `previewMissingIngredientsAction`
  (`src/app/dashboard/meal-planning/cooking-actions.ts`), a read-only preview — no
  rows are written until the user commits. It collects every
  `MealPlanEntry` with a `recipeId` dated inside the chosen range (freeform
  entries have no ingredients and are skipped via `recipeId: { not: null }`),
  gathers each recipe's `RecipeIngredient` rows, and resolves each to its
  linked `InventoryItem`. `RecipeIngredient.inventoryItemId` can be null —
  a row saved without a match (see "Ingredient → inventory linking"
  above), or one whose item was since deleted (`onDelete: SetNull`); that
  case falls back to the same case-insensitive name match the
  find-or-create paths elsewhere in this app use, against a fresh query of
  the household's current inventory.
- **Aggregation/diff**: the pure "sum required quantity per resolved item
  across every recipe/day, subtract what's on hand once (not per
  occurrence), keep only the positive shortfall" step is
  `computeMissingIngredients` (`src/app/dashboard/meal-planning/missing-ingredients.ts`,
  colocated `missing-ingredients.test.ts`) — split out from `actions.ts`
  (a `"use server"` file, which may only export async functions) so it's
  unit-testable without mocking Prisma, the same reasoning the recipe-import
  task's parsing logic uses. Only ingredients whose required quantity
  exceeds current stock are proposed; an item the household already has
  enough of is never suggested. A recipe ingredient's unit and its linked
  inventory item's unit are reconciled via a small fixed conversion table
  (`src/lib/units.ts`, covering the metric/US volume and weight units
  KNOWN_UNITS already recognizes when parsing imported recipes) — e.g. 1
  liter of olive oil on hand correctly covers a recipe that calls for 3
  tablespoons. **Known simplification**: this table only converts within
  the same dimension (volume↔volume, weight↔weight); it can't cross
  dimensions (cups of flour vs grams of flour needs ingredient-specific
  density we don't have) or convert an unrecognized/count-style unit
  ("clove", "can", "pcs", ...), matching this app's existing preference for
  simple, hand-rolled logic over precision it wasn't asked for. Requirements
  for the same ingredient in mutually convertible units are merged into one
  line (converted into whichever unit was seen first) so the review list —
  and the shopping-list item it produces — never splits one ingredient
  across rows just because two recipes phrased the amount differently;
  requirements in an unconvertible unit still get their own line, as
  before. **Per-item conversions (MATCH-3)**: a requirement only the
  item's saved `ItemUnitConversion`s reconcile (`convertForItem`, see
  "Ingredient → inventory linking") is restated in the item's own unit
  first, so it joins that unit's line and on-hand stock covers it; only a
  unit with no conversion at all is flagged `unitMismatch`. The
  conversions come in with the recipe graph's one query (and the loose
  name-match fallback's inventory query), never a query per recipe
  (PERF-1); the Cook tab uses the same path.
- **Review before committing**: the dialog lists each proposed ingredient
  (name + suggested quantity/unit) behind a checkbox (all checked by
  default, individually deselectable), a target-list `<Select>` (any
  `ACTIVE` shopping list, or a "New shopping list…" sentinel — same sentinel
  pattern as `CUSTOM_RECIPE_SENTINEL`, here `NEW_SHOPPING_LIST_SENTINEL` in
  `meal-types.ts`) with an optional name field when creating new, and a
  submit button disabled until at least one item is checked. Nothing is
  written until the user confirms.
- **Committing**: `addMissingIngredientsToShoppingListAction` (same file)
  creates the new list if requested (defaulting its name the same way
  `createShoppingListAction` does), then links every checked ingredient
  with `createInventoryLinker` (exact name, else the household's learned
  alias (MATCH-5), else one clear fuzzy match — the same rule as a pasted
  list or template) over one inventory and one alias fetch,
  and writes every row in a single `shoppingListItem.createMany`. A row
  with no match is added **unlinked** for "Resolve mappings" on the list;
  it never creates an inventory item (MATCH-1). Items (or unlinked names)
  already pending (unpurchased) on the target list are skipped rather than
  duplicated, mirroring `generateFromLowStockAction`'s
  existing dedupe in `src/app/dashboard/shopping-list/actions.ts`. On
  success the dialog closes and a `sonner` toast confirms which list the
  items were added to.
- **Substitution hints (GAP-25)**: a missing ingredient with a common,
  reliable swap gets a muted "Try instead: …" line under it in the review
  list ("no buttermilk? milk with 1 tbsp lemon juice per cup…"), the next
  step Paprika and Plan to Eat offer besides "buy it". The table is
  `src/lib/inventory/substitutions.ts` (colocated
  `substitutions.test.ts`): a static list of about two dozen staples
  (dairy, eggs, leaveners, starches, sugars, wine, vinegar, alliums), each
  listed under its English and Swedish names, stored normalized with the
  shared `normalizeItemName` and mapped to a stable key, the same approach
  as AUTO-2's category dictionary. The hint text is per locale in
  `mealPlanning.substitutions.<key>` (en.ts/sv.ts), so Swedish users get
  Swedish products and measures (filmjölk, msk, dl) rather than a
  translated US tip. A test checks that both dictionaries cover exactly the
  table's keys. Matching is deliberately stricter than auto-categorization:
  the whole ingredient name must be a listed name, allowing only case,
  punctuation and an English plural `-s` on the last word. "Chocolate
  milk" or "egg noodles" therefore get no hint, because a wrong cooking
  instruction is worse than none. The lookup runs in the client dialog
  (the table is static and dependency-free), and the hint is advisory
  only: it never changes what gets added to the shopping list. No AI, no
  schema change.

### Mark meal as cooked → inventory decrement

A "Mark as cooked" button (`MarkCookedDialog`,
`src/components/meal-planning/mark-cooked-dialog.tsx`, the primary action
in a planned meal's sheet in `WeekPlanner`) lets a
household decrement inventory for the ingredients a specific `MealPlanEntry`
actually used, once they've cooked it.

- **Competitor research**: checked how Grocy, Paprika, AnyList, and Mealime
  handle this. Paprika/AnyList only use pantry state to pre-check items off
  a *generated shopping list*; Mealime has no pantry awareness at all.
  Grocy is the one competitor that decrements stock for a cooked recipe —
  via a manual "consume" action with a fulfillment/preview step first, not
  an automatic decrement tied to the calendar. That manual-trigger-with-
  preview pattern is what's copied here, for the same reason Grocy uses
  it: a meal plan diverges from what's actually cooked (skipped, doubled,
  an ingredient swapped out), and even with the small unit-conversion table
  described above (`src/lib/units.ts`) there are still unconvertible cases
  (an unrecognized unit, or one from a different dimension) — a silent
  automatic decrement could drift inventory numbers wrong with no easy fix.
- **Idempotency**: `MealPlanEntry.consumedAt` (null until cooked) makes
  `markMealEntryCookedAction` a no-op on a repeat/stale submit, mirroring
  `RecurringTemplateAck`'s idempotent-acknowledgement pattern elsewhere in
  this app. Once set, `MealEntryRow` swaps the button for a static
  "Cooked" checkmark. Only entries with a linked `recipeId` get the
  button — a freeform entry has no ingredients to decrement.
- **Preview**: opening the dialog calls `previewCookedIngredientsAction`
  (`src/app/dashboard/meal-planning/actions.ts`), which reuses the exact
  same `expandRecipeIngredients` call and `portionsMultiplier` scaling
  as the shopping-list bridge above, plus its same loose name-match
  fallback for an ingredient whose linked `InventoryItem` was since
  deleted. Unlike that bridge, an ingredient that still doesn't resolve to
  an existing `InventoryItem` is simply dropped from the list — there's
  nothing to decrement for it, and (unlike the shopping-list case) nothing
  useful to propose creating either.
- **Aggregation**: `computeCookedIngredients`
  (`src/app/dashboard/meal-planning/cooked-ingredients.ts`, colocated
  `cooked-ingredients.test.ts`) sums each resolved `InventoryItem`'s
  required quantity across ingredient rows. Decrementing is always
  denominated in the inventory item's own unit (never the recipe
  ingredient's); the same `src/lib/units.ts` table used by the shopping-list
  bridge converts a recipe row's unit into it where the two are recognized
  and in the same dimension, and otherwise the item's saved conversions do
  (`convertForItem`, MATCH-3: "300 g" of flour counted in 2 kg bags
  suggests 0.15). A row that still doesn't reconcile (an unrecognized
  unit, or a different dimension with no saved conversion) is flagged
  (`unitMismatch`) and suggests `0` rather than a guessed conversion —
  the household sees the recipe's own required quantity/unit alongside it
  and enters the equivalent themselves.
- **Review before committing**: every row is checked by default with an
  **editable** quantity input (unlike the shopping-list bridge's read-only
  suggested quantity — this is a real mutation, so the default must be
  correctable before it's applied), plus on-hand quantity for context.
  Nothing is written until the user submits.
- **Committing**: `markMealEntryCookedAction` re-verifies each submitted
  item belongs to the household, clamps each decrement at 0 (same as
  `adjustQuantityAction` in `src/app/dashboard/inventory/actions.ts`), and
  sets `consumedAt`, all inside one `$transaction`.
- **Short-lived undo only**: once marked cooked, it's final — consistent
  with "no in-place edit for meal entries" above, and for the same inventory-
  drift reason a meal plan can diverge from what was actually cooked. The one
  exception is `undoMarkMealEntryCookedAction`
  (`src/app/dashboard/meal-planning/cooking-actions.ts`), fired from an
  "Undo" action on the confirmation toast (`MarkCookedDialog`) that's visible
  for a few seconds after submitting — it targets the fat-finger case (an
  accidental tap on the wrong entry), not a considered correction made later.
  It reverses the exact rows just submitted (re-verified against the
  household, same as the commit path) and clears `consumedAt`, inside its own
  `$transaction`; it's idempotent like the commit action (a no-op once
  `consumedAt` is already null, so a stale/double-clicked toast can't credit
  inventory back twice). Once that window closes there's no further undo — a
  wrong decrement discovered later is corrected the same way any inventory
  number is corrected: the existing +/- adjuster on the inventory page.
  When the cook pushed ingredients into low stock (AUTO-8), the toast says
  how many were added to "Next shop", and the same Undo also removes those
  rows via `undoAutoAddedItemsAction` — undoing the cook undoes everything
  it caused.
  Deleting the meal-plan entry afterward doesn't reverse the decrement
  either, for the same reason.
- **One word for portions (UX-95)**: English says "portions" everywhere a
  recipe's yield shows (recipe list and form, per-portion nutrition and
  cost, planner, Mark as cooked, Meal prep); the Prisma column stays
  `servings`.
- **The add-meal sheet names the day and searches recipes (UX-96)**: the
  title reads "Add dinner · Mon 12" (the slot currently picked, then the
  day), so the sheet says what it adds and where. The "Recipe" field is a
  search input (`role=combobox`) with its list rendered inline in the sheet
  (`ComboboxInlineList`, `<Combobox inline open>`), not a popup that only
  got the sliver above the sheet's edge: it filters as you type, shows
  about five 44 px rows before scrolling, and says "No recipe matches"
  when empty. Order is "Custom meal…", "From meal prep" (when a batch has
  portions left), then favourites, then recently cooked recipes
  (`orderRecipesForPicker`, from `getRecipeCookedStats`, passed down by
  `PlannerTabSection`), then the rest alphabetically. The typed text is
  only a filter; the chosen row keeps its check mark. Pinned by
  `e2e/meal-planner-rows.spec.ts`. The blurred page behind is every
  sheet's shared backdrop and is unchanged.
- **Leftovers (GAP-8)**: the dialog has an optional "Portions left over"
  number input, blank by default. Blank or 0 means no leftovers, and
  nothing is ever inferred from `servings` vs `portions` (Guardrails:
  suggest, don't silently mutate). The value is validated by
  `leftoverServingsSchema` (`src/app/dashboard/meal-planning/leftovers.ts`,
  colocated `leftovers.test.ts`): a whole number from 0 to 100, where 100 is
  a typo guard rather than a real limit. An invalid value rejects the whole
  cook before anything is written. When it's above 0,
  `markMealEntryCookedAction` records the leftovers **in the same
  `$transaction`** as the decrement, so a cook that rolls back never leaves
  a stray batch behind:
  - **Since GAP-49 the leftovers are a `PreparedBatch`** of the cooked
    recipe (see "Meal prep (GAP-49)" below), the same thing a prep session
    records: `totalPortions` = `remainingPortions` = the servings typed,
    `cookedByMemberId` the session member (`findSessionMemberId` in
    `prep-assign.ts`), and the default eat-by date
    (`defaultBatchExpiry`, cooked time + `LEFTOVERS_SHELF_LIFE_DAYS`, 3
    days). Three days is the conservative end of the usual 3–4 day
    guidance for cooked food, and the same value
    `SHELF_LIFE_CATEGORY_DEFAULTS` uses for meat. A batch can be planned
    portion by portion and shows on the Meal prep tab and the dashboard
    card; the old inventory row could only sit in the inventory list with
    an expiry badge, and nothing could plan from it. Every cook of the
    same dish makes its own batch with its own eat-by date, rather than
    merging into one row that can only carry one date.
  - **The old "Leftovers: …" inventory rows are no longer created**, but
    the ones that already exist are left alone (no data migration). They
    are ordinary inventory items now: edited, used up or deleted from the
    inventory page like any other.
  - A meal that is itself eaten from a batch has no leftovers field (see
    "Mark as eaten" below), and the action ignores one a stale dialog
    still posts.
  - **Undo**: the action returns a `LeftoversChange` (`{ batchId }`).
    `MarkCookedDialog` passes it to `undoMarkMealEntryCookedAction`, which
    validates it with `leftoversChangeSchema` and deletes the batch inside
    the undo's own transaction, behind the same `consumedAt` idempotency
    guard. The delete is a `deleteMany` with `householdId` in the filter,
    so a `batchId` from another household matches nothing. Once "Plan
    leftovers" (below) has put a portion of it on the plan the batch is
    real, so, like `undoRecordPrepAction`, the undo keeps it and only skips
    that part; the ingredients are still credited back. A malformed
    payload also skips only the leftovers part.
  - When both happen, the confirmation toast shows the AUTO-8 "added to
    Next shop" message instead of the leftovers one ("saved 2 portions to
    Meal prep"), so there's only one toast. A single Undo still reverses
    both.
- **Plan leftovers (GAP-39)**: when a cook recorded leftovers of a recipe,
  the confirmation toast also has a "Plan leftovers" button next to Undo.
  Tapping it calls `suggestLeftoversDayAction` (`planner-actions.ts`,
  read-only): the first day after the later of today and the cooked meal's
  date with no `DINNER` entry, found by `nextFreeDinnerDay` in `leftovers.ts`
  over the next 60 days of the household's plan (colocated tests). It then
  opens the existing `AddToPlanDialog` (now also usable controlled, without
  its own trigger, with a prefilled date and a hint line) with that recipe,
  the leftover servings as portions and the suggested day. It stays a
  suggestion: nothing is added until the household presses "Add to plan";
  closing the dialog adds nothing. On confirm the dialog posts the
  leftovers batch's id as `preparedBatchId`, so `addMealEntryAction` plans
  the slot through `assignInTx` and it eats from the batch (it gets the
  Prepped badge, and the portions come off the batch) instead of being a
  fresh cook of the same recipe. The day can be changed, and assigning
  never replaces another meal: a slot with something else planned fails
  with "That meal slot already has something planned", so a day that
  already has a dinner is never overwritten. The portions field isn't
  capped at the batch's remaining portions in the dialog; asking for more
  fails on the server with "Not enough portions left in this batch". No
  schema change, setting or automatic scheduling. `e2e/plan-leftovers.spec.ts`
  covers confirming (including the Prepped badge on the new slot) and
  dismissing.

### Meal prep (GAP-49)

A household that batch-cooks ("Sunday: 8 portions of chili, 6 of curry")
records each dish as a `PreparedBatch` and spends its portions across the
planner, so the plan and the fridge agree on how much is left. Design:
`docs/archive/MEAL_PREP_DESIGN.md`. It lives on a
fourth meal-planning tab, **Meal prep** (`?tab=prep`, `PrepTab` in
`src/components/meal-planning/prep-tab.tsx`), plus a "From meal prep"
source in the add-meal dialog and a card on the home dashboard. No schema
change: the `PreparedBatch` model and the two `MealPlanEntry` fields
landed earlier (PR #179, see the data model above). No browser storage.

- **Data rules.** `remainingPortions` is the portions not yet handed to a
  planner slot, and the invariant is `0 ≤ remainingPortions ≤
  totalPortions`. A slot eating from a batch has `preparedBatchId` set,
  `preparedPortionsUsed = portions = n` (n ≥ 1), and `recipeId` equal to
  the batch's recipe. Every write path below keeps those in step, which is
  why an edit that changes the dish or the portions unlinks the entry
  rather than leaving it half-linked. A prep is 1–5 dishes
  (`MAX_PREP_DISHES`), each 1–100 portions (`MAX_LEFTOVER_SERVINGS`). The
  default eat-by date is `defaultBatchExpiry` (cooked time + 3 days, the
  leftovers shelf life), overridable per dish. The schemas and arithmetic
  are pure, in `prepared-batch-calc.ts` (`recordPrepSchema`,
  `assignPortionsSchema`, `portionsAfterReturn`, `isActiveBatch`, …,
  colocated tests). A batch is **active** while it has portions left or any
  uneaten entry still links to it (once every linked meal is eaten, an
  emptied batch is done); `getActiveBatches`
  (`prepared-batches.ts`, `cache()`-wrapped) loads only those, soonest
  eat-by first, then oldest cook. Inactive batches aren't shown anywhere
  and aren't cleaned up in the background; they go when discarded or with
  their recipe.
- **Assigning: a conditional decrement.** Every path that hands portions
  to slots (Plan portions, "From meal prep", Plan leftovers) goes through
  `assignInTx` (`src/app/dashboard/meal-planning/prep-assign.ts`, a plain
  server module rather than a `"use server"` file, so it can run inside
  another action's transaction without becoming an endpoint of its own).
  It takes the total in one `updateMany` whose filter includes
  `remainingPortions >= n` and the household, so two concurrent assigns can
  never drive the count negative: the second matches no row and throws
  `PrepAssignError("prepNotEnoughPortions")`, which rolls the whole
  transaction back. Then per slot it finds or creates that week's
  `MealPlan` and either creates a linked entry or links the slot's existing
  entry, but only when every entry there is this dish, unlinked and not
  yet cooked ("lasagna on Thursday" becomes "lasagna from the batch").
  Another dish, a freeform meal, another batch's slot or a cooked meal is
  the household's plan, so the slot is taken (`prepSlotTaken`). That link
  is guarded too (`preparedBatchId: null, consumedAt: null` in the filter).
  All slots land or none do.
- **Returning: an optimistic write.** Unplanning, deleting or editing a
  linked entry gives its portions back through `returnEntryPortionsInTx`,
  after the caller has reset or deleted the entry with a filter on the
  values it read (so a double click returns the portions once). The batch
  update is optimistic: it only writes if `remainingPortions` still has the
  value just read, capped at `totalPortions` by `portionsAfterReturn`. A
  concurrent assign in between would otherwise be overwritten and its
  portions handed out twice. On a miss it throws `BatchChangedError`, the
  whole transaction (the entry write too) rolls back, and the action
  returns the translated generic error, "Something went wrong. Please try
  again.", without reporting it to Sentry: it's an expected race, and the
  household just retries. A batch already gone has nothing to take
  portions back.
- **Deleting the recipe.** `deleteRecipeAction` deletes the recipe's
  batches with it (cascade), but first, in the same transaction, unlinks
  every entry eating from them (`preparedBatchId` null and
  `preparedPortionsUsed` 0), since the FK's `SetNull` alone would clear
  only the id and leave the pair out of step. The meals stay planned and
  cook fresh.
- **Record prep.** The tab's full-width "Record prep" button
  (`RecordPrepDialog`, `record-prep-dialog.tsx`) opens a two-step dialog:
  dish rows (recipe select, a `PortionStepper` defaulting to the recipe's
  servings, an optional eat-by date, "Add another dish" up to 5), then the
  same ingredient review checklist "Mark as cooked" uses
  (`CookedIngredientsChecklist`), over every dish's ingredients scaled to
  `portions / recipe.servings`. `previewPrepIngredientsAction` merges the
  dishes into one row per inventory item, since the checklist submits one
  decrement per item (rice under both the curry and the chili). The
  suggested amounts are in the item's own unit, so they always add up. The
  recipe's own required amounts only add up while the dishes agree on the
  unit: 1125 g of flour plus 3 dl isn't "1128" of anything, so a row whose
  dishes use different units states the need in the item's unit instead,
  from the summed suggestion. `recordPrepAction` checks every recipe id
  against the household before writing anything, then in one transaction
  deducts the reviewed rows and runs the AUTO-8 low-stock "Next shop"
  auto-add (`deductCookedIngredients` in `cook-inventory.ts`, shared with
  `markMealEntryCookedAction`, so a prep and a cook never disagree on how
  stock moves) and creates one batch per dish, all with one `cookedAt`.
  The toast ("Recorded 2 dishes · 14 portions") has Undo and, for a
  one-dish prep, a "Plan portions" shortcut. **Undo**
  (`undoRecordPrepAction`) deletes the batches and credits the rows back
  (`creditCookedIngredients`), and the client takes the auto-added rows
  off "Next shop" with `undoAutoAddedItemsAction`, as mark-cooked does,
  but only after the prep undo has succeeded: the two run in sequence, so
  a refused undo leaves the prep and its "Next shop" rows in place and
  toasts the refusal. It
  is idempotent (batches already gone credit nothing) and **refuses** with
  "Some of these portions are already planned. Unplan them first." once
  any portion is on the plan: by then the prep is real, and undoing it
  would silently unplan meals. Like mark-cooked's undo, a deduction that
  was clamped at 0 is credited back in full.
- **Plan portions.** Each batch card's primary action (disabled while the
  batch has no portions left) opens
  `PlanPortionsDialog` (`plan-portions-dialog.tsx`), starting on the week
  of the later of today and the cook date. It reads weeks itself with
  `loadPlanSlotsAction` rather than the page's `?week=`, so paging weeks
  never moves the Planner tab, and selections are kept across weeks so
  one save can plan this week's dinners and next Monday's lunch. Each day
  lists its four meal slots, grouped by day on phones. A slot is
  selectable when it's empty or only plans this dish fresh (the same rule
  `assignInTx` re-checks on save); a slot with something else shows that
  dish's name, disabled, with a "Taken" label (never greying alone).
  **Days before today are hidden** (UX-100): prepped food can't be
  eaten in the past, so the first week lists today onward, Previous week
  is disabled there, and the first pickable slot is scrolled into view
  when a week loads (the server would still accept a past slot,
  harmlessly). A selected slot gets a portions stepper
  (default 1), and a live "3 of 5 left after this" counter turns into
  "2 portions too many — only 5 left" and disables save when over. Each
  save is capped at 28 selected slots in total, however many weeks they
  span (`assignPortionsSchema`; 28 is one week of four meals a day). The
  dialog doesn't guard the cap, so a save with a 29th slot is rejected by
  the server as invalid input. When a save fails (out of portions, a slot
  taken since it was read), nothing was written, so the dialog reloads
  the week and drops selections that are no longer selectable. When the
  request never arrives (offline, weak signal), loading and saving both
  catch the rejection and show "Couldn't reach the server. Check your
  connection and try again." with a retry, in the dialog rather than the
  page's error boundary (DESIGN.md M8).
- **"From meal prep" in the add-meal dialog.** When any batch has
  portions left, `MealEntryDialog`'s recipe select gains a "From meal
  prep" option: pick the batch ("Chili · 5 left") and a portions stepper
  capped at what's left. It posts `preparedBatchId`, and
  `addMealEntryAction` re-checks the batch belongs to the household and
  routes it through `assignInTx` (one portion unless the form says
  otherwise), ignoring any recipe or freeform name. Only when adding:
  editing a meal into a batch slot isn't offered.
- **On the planner.** A linked entry's row shows a "Prepped" badge and,
  while uneaten, its sheet has a "Don't use prep" button
  (`unassignBatchPortionAction`): the meal stays planned, cooks fresh, and
  its portions go back to the batch. Its cook button reads "Mark as eaten"
  with a fork-and-knife icon.
  That dialog has no ingredient checklist and no leftovers field, since
  the ingredients came off at prep time and the portions off the batch
  when the slot was planned. It posts no item rows, and its undo passes
  none, so even an entry edited while the dialog was open can't credit
  undeducted rows back. `markMealEntryCookedAction` and its undo, for a
  linked entry, only set and clear `consumedAt` whatever a stale dialog
  posts. An eaten meal keeps its portions eaten: unplanning isn't offered,
  and deleting it doesn't return them.
- **Delete and edit return portions.** `deleteMealEntryAction` (now
  returning `ActionState`) deletes an uneaten linked entry and returns its
  portions in one transaction; on a `BatchChangedError` the confirm dialog
  toasts the error and the meal stays planned. `updateMealEntryAction`
  keeps the link while the recipe and the portions stay the same, but
  when either changes it unlinks the entry first in the same transaction
  (guarded on the values it read), returning the portions (unless it was eaten), and the
  meal cooks fresh. Moving a linked entry keeps the link, since its
  portions don't change.
- **Copy week doesn't carry links.** `copyWeekAction` and
  `fillEmptyDaysAction` copy recipe, freeform name and portions only; a
  copied slot cooks fresh. Copying the link would spend portions the
  batch never handed out (a unit test pins it).
- **Discard and its undo.** "Discard" on a card (confirm, then an undo
  toast) runs `discardBatchAction`: in one transaction it resets every
  linked entry to `null`/0 (the FK's `SetNull` would clear only the id),
  deletes the batch, and returns a `DiscardSnapshot` of the batch and the
  entries that drew portions. The meals stay planned and cook fresh.
  `undoDiscardBatchAction` re-validates the snapshot (`discardSnapshotSchema`,
  which also rejects `remainingPortions` above `totalPortions`), re-checks
  the recipe and the cook against the household (a cook who left since is
  dropped, unattributed), and recreates the batch under its old id; a
  repeated Undo finds it back and does nothing. The snapshot records
  whether each entry was already eaten at the discard. It re-links only
  entries that are still the household's, still unlinked, still the
  batch's dish and portion count, and still eaten or uneaten as they were,
  so an entry edited after the discard keeps its new state rather than
  breaking the linked-entry invariant, and an uneaten one cooked fresh
  since isn't claimed by the batch. An entry that can't be re-linked has
  its portions returned to the batch instead of vanishing, unless it was
  eaten at the discard: those portions were spent then. A malformed or no-longer-fitting snapshot is a silent no-op.
- **Home dashboard card.** `src/app/dashboard/page.tsx` shows a "Meal
  prep" card only when some active batch has portions left: up to three,
  soonest eat-by first, each with "5 of 8 portions left · Eat by <day>"
  and a "View meal prep" link to `?tab=prep`. A batch whose last
  portions are only planned stays on the Prep tab but not on the card,
  where there's nothing left to eat. Dates are formatted in UTC, like the
  Prep tab, so the server and every browser name the same day.
- **Tenancy.** Every action calls `requireHousehold()`, re-checks every
  batch, entry and recipe id from the client against the household, and
  writes in one `$transaction`. Batches are found with `householdId` in the
  filter, entries through `mealPlan: { householdId }`.
- **Tests.** `prepared-batch-calc.test.ts`, `prepared-batches.test.ts`,
  `prep-actions.test.ts` (tenancy with foreign ids, validation, over-assign
  and partial assign rolled back, return on unassign and delete, the
  optimistic race, undo refused once planned, discard and re-link guards),
  plus `planner-actions.test.ts` and `cooking-actions.test.ts` (a linked
  entry eaten without deduction, leftovers creating a batch, copy week
  without links). `e2e/meal-prep.spec.ts` runs on desktop and mobile. The
  first test records a batch (ingredients off inventory), opens Plan
  portions from the toast, checks past days are hidden (Previous week disabled) and a slot
  with another dish is greyed with its name and a "Taken" label, steps portions to the cap,
  sees the overdraw message, saves, reloads for the count and the Prepped
  badges, deletes one slot to get its portion back, marks the other eaten
  with inventory unchanged, and discards. The second checks the dashboard
  card and its link, adds a planner meal "From meal prep", and gives it
  back with "Don't use prep".

### "Use it up" recipe suggestions

BACKLOG GAP-1, from the 2026-09-23 competitive gap scan: Grocy's headline
feature is surfacing recipes whose ingredients overlap with what's expiring
soon or already running low, instead of only listing every recipe flat. The
Recipes tab (`RecipeManager`) renders a dismissible chip row
(`UseItUpSuggestions`, `src/components/meal-planning/use-it-up-suggestions.tsx`)
above the recipe list — e.g. "Chicken stir-fry uses 2 things expiring soon" —
computed by `computeUseItUpSuggestions`
(`src/lib/inventory/use-it-up-calc.ts`, colocated `use-it-up-calc.test.ts`).

- **Read-only, and deliberately a *partial*-overlap ranking**: unlike
  `getCookableRecipes` ("Cook now," full-match — at most a couple of
  ingredients missing, see cookable-recipes.ts), a recipe can rank here even
  with plenty of *other* missing ingredients, as long as it uses at least one
  item worth working into tonight's cooking. It never creates a `MealPlan`
  entry or writes to `InventoryItem` — a suggestion only ever links out to
  the recipe already sitting in the same tab (BACKLOG.md's Guardrails).
- **What counts as "worth using up"**: an `InventoryItem` with `quantity > 0`
  (see below) whose `getExpiryStatus` (`src/lib/inventory/expiry.ts`) is
  `"expired"` or `"soon"`, or whose `getStockStatus`
  (`src/lib/stock-status.ts`) is `"low"` — the same two predicates the
  inventory table and notification center already use, computed once in
  `page.tsx` from the same `inventoryItem.findMany` already fetched for the
  ingredient-name autocomplete rather than a second query. An item that's
  both expiring and low is reported as `"expiring"` — the more urgent
  framing.
- **Zero-quantity gate**: `reasonFor` (`use-it-up-calc.ts`) excludes any item
  at `quantity <= 0` from *both* reasons — you can't "use up" something you
  already have none of; that gap belongs to the shopping-list bridge, not
  this feature. This matters in practice, not just in theory: every
  ingredient created from a recipe's "Create new" row starts at
  `quantity: 0, lowStockThreshold: 0` (see "Ingredient → inventory linking" above), which
  makes `getStockStatus` report it as `"out"` from the moment it's created.
  Without this gate almost any recipe with a freshly-added ingredient would
  misleadingly surface a suggestion (caught in PR #24 review before merge).
- **Matching ingredients to inventory**: prefers each `RecipeIngredient`'s
  linked `inventoryItemId`, falling back to a case-insensitive name match —
  the same loose-match fallback `getCookableRecipes` uses for an ingredient
  whose link was cleared by a since-deleted inventory item (`onDelete:
  SetNull`). A recipe's match count is deduplicated by matched item id, so
  the same ingredient listed twice doesn't inflate it.
- **Ranking**: sorted by match count descending, then — on a tie — a
  suggestion with an expiring-reason match ahead of one that's low-stock-only
  (using up something already low makes it run out even sooner, so it's the
  less urgent of the two on equal footing), then a starred recipe ahead of
  an un-starred one (see "Recipe favorites" below), then recipe name, capped at 5
  suggestions — the same "keep it short and actionable" reasoning as
  `MAX_MISSING_TO_SURFACE` in cookable-recipes.ts. **Product call (PR #24
  review)**: low-stock stays as a first-class reason rather than being
  dropped — a slowly-dwindling item is a legitimate signal, not just noise —
  but this expiring-first tie-break keeps the more urgent framing on top
  when both apply.
- **Chip wording**: reason-specific ("uses N things expiring soon" / "…
  running low") when every match in a suggestion agrees, a neutral "expiring
  soon or running low" phrasing when a suggestion mixes both.
- **Dismissal**: per-recipe, persisted in `localStorage`
  (`mealPlanning.useItUpDismissed`, listed in `src/lib/cookie-inventory.ts`)
  keyed by recipe id → a signature of the matched ingredient names, mirroring
  `MealVarietyRecap`'s count-keyed dismissal: a dismissed "uses milk, eggs"
  chip stays hidden, but a since-changed "uses flour, sugar" nudge for the
  same recipe isn't suppressed by yesterday's dismissal. Dismissal is
  per-device only, same as `MealVarietyRecap`.

### Recipe last cooked

BACKLOG GAP-46: each `RecipeManager` row (in its meta line, and in full in
the recipe's sheet) shows how often and when its recipe
was last cooked, e.g. "Cooked 3 times, last 12 Sep", so a household can see
what has dropped out of rotation. No schema change: it reads back
`MealPlanEntry.consumedAt`, which "Mark as cooked" already sets.

- **Query**: `getRecipeCookedStats(householdId)` in
  `src/app/dashboard/meal-planning/recipe-cooked-stats.ts` is one `groupBy
  recipeId` over the household's entries (`mealPlan: { householdId }`) that
  have a recipe and a `consumedAt`, taking the count and the latest
  `consumedAt`. It runs only for the Recipes tab, with the household from
  `requireHousehold()`; covered by the colocated unit test.
- **Label**: `mealPlanning.recipeCookedValue` is a `{ one, other }` pair in
  `en.ts` and `sv.ts`. A never-cooked recipe has no entry and shows no line
  (not "0 times"). The date is the UTC day of the latest `consumedAt`, as the
  planner formats its days, so the server render and every browser agree.
- **Not in scope**: no sort or filter by last cooked; the list stays
  alphabetical.

### Recipe favorites

BACKLOG GAP-18, from the same competitive gap scan: AnyList and Paprika let
a household mark the recipes it actually likes and use that to bias
suggestions. `Recipe.isFavorite Boolean @default(false)` (migration
`recipe_is_favorite`) is a single household-wide flag — not a per-member
rating or a star scale, the same minimal-first call `HouseholdTask` v1 made
for assignment. It answers "which recipes does this household like", and
any member's star is everyone's star.

- **Toggle**: a star button at the start of each `RecipeManager` row, left
  of the part that opens the recipe's sheet. It's a click action
  (`toggleRecipeFavoriteAction(recipeId)` in
  `src/app/dashboard/meal-planning/recipe-actions.ts`) called inside its own
  `useTransition`, with `useOptimistic` so the star fills immediately and
  snaps back if the save fails (the same pattern as `AutoAddSetting`). The
  action flips the stored value itself rather than accepting a desired
  state from the client, and scopes its lookup to `requireHousehold()`'s
  household, so a foreign recipe id is a silent no-op (the same IDOR guard
  as `deleteRecipeAction`). Accessibility: the button has a stable
  localized `aria-label` (`mealPlanning.favoriteAriaLabel`) and conveys
  on/off through `aria-pressed`, so the label doesn't flip as well.
- **A tiebreaker, never a filter**: favorites never hide an un-starred
  recipe and never outrank a better match. In the Cook tab
  (`computeCookableRecipes`, `cookable-recipes.ts`) the sort is missing-
  ingredient count, then favorites first, then name. A starred recipe
  missing one thing still sorts below an un-starred one missing nothing,
  and a starred recipe missing more than `MAX_MISSING_TO_SURFACE` still
  drops out. In "use it up" (`computeUseItUpSuggestions`) the star comes
  after both waste-prevention keys (match count, then expiring-before-low-
  stock) and before name. Both orders are covered by the colocated
  pure-calc tests.
- **Not in scope**: no favorites-only filter or separate page, and the
  Recipes list itself stays alphabetical. The star is visible there, and
  search already narrows the list.

### Recipe sheet: Add to plan and instructions (UX-92)

A recipe's sheet on the Recipes tab (`RecipeRow` in `recipe-manager.tsx`)
answers "what's for dinner?" without opening Cook or Edit.

- **Instructions**: when the recipe has any, the steps appear as a numbered
  list under the ingredients (`splitSteps`, the same one-step-per-line split
  Cook mode uses). A recipe without instructions shows no section.
- **Add to plan**: the first button in the sheet's action list. It closes the
  sheet and opens the same `AddToPlanDialog` the Cook now tab uses (date,
  meal type, portions defaulting to the recipe's servings), controlled by the
  row. The Planner tab's week is passed in as `plannerWeekStartKey`, so a
  date in another week gets the "View that week" toast. Covered by
  `e2e/recipe-sheet-plan.spec.ts`.

### Cook mode (GAP-42)

Paprika, Mealie and Tandoor all have a "cook" view. Squirrel showed a
recipe's `instructions` only inside the edit form, a dialog that dims
mid-recipe. `CookModeDialog` (`src/components/meal-planning/cook-mode-dialog.tsx`)
is a full-screen read view for cooking from a phone.

- **Entry points**: a "Cook" button in a recipe's sheet (its primary
  action, beside "Edit recipe" in the footer that sticks to the sheet's
  bottom on phones, so a long ingredient list never scrolls it out of
  reach, M2) and in a planned meal's sheet (`MealEntryRow`). Both only exist
  when the recipe has non-blank instructions.
- **Content**: the title and portion count, the ingredients, then the
  steps in large type. Steps are `instructions` split one per line
  (`splitSteps`, `src/lib/cook-mode-calc.ts`). Sub-recipe components aren't
  expanded; their own recipes have their own Cook view.
- **Scaling**: opened from the recipe list, amounts are the recipe's own
  (`Recipe.servings` portions). Opened from the planner it passes the meal
  entry's `portions`, and each amount is multiplied by `portions /
  servings` (`cookScale`, guarded against a zero value) and shown to two
  decimals in the locale's format (`formatCookQuantity`).
- **Ticking steps**: each step is a whole-card button with `aria-pressed`;
  a done step is dimmed, struck through and shows a check instead of its
  number. State is component-only: nothing is saved or stored in the
  browser (no `cookie-inventory.ts` entry), so reopening starts fresh.
- **Step timers (GAP-50)**: `parseStepDuration` (`cook-mode-calc.ts`)
  reads a duration from a step's text in English and Swedish ("simmer 15
  minutes", "koka i 10 min", "1,5 timmar", "1 hour 30 minutes", seconds
  too). A range ("10-12 min", "10 till 12 min") uses its upper bound so the
  timer never rings early; back-to-back phrases are added; with several
  separate durations in one step the first wins; nothing is returned over
  24 h or for a zero. A step with a duration shows a "Start 15 min timer"
  button under it (44 px target); a running timer shows a countdown chip
  (`role="timer"`, "14:32") and a "Stop timer" button. Several steps can run
  at once. When one ends, a sticky `role="alert"` banner ("Timer done for
  step 2") stays at the top of the view until dismissed, and the phone
  vibrates briefly where `navigator.vibrate` exists. The timer stores its
  end time, not a counter, so a throttled background tab catches up when it
  wakes. It lives in the dialog only: no push, no background work, nothing
  stored in the browser (no `cookie-inventory.ts` entry), and closing the
  view drops every timer. Works with no AI key.
- **Wake lock**: the dialog content calls `useScreenWakeLock(open)` (the
  AUTO-3 hook the shopping list uses), so the screen stays on while the view
  is open and the lock is released on close. Where the API is missing or
  denied it silently does nothing.
- **Closing**: a full-width "Close" button at the bottom of the scroller
  (thumb zone) and Escape; the round close icon is dropped in favour of it.
- **Progress, Next step and Done (UX-94)**: closing (the Close button,
  Escape, the back gesture or a swipe down) with a timer running or a step
  ticked asks "Stop cooking?" first ("Your timer will stop and your ticked
  steps will be cleared." / "Your ticked steps will be cleared."), with
  "Keep cooking" and "Stop cooking"; a fresh view, or one with only
  ingredients ticked, closes at once (`hasCookProgress`). The first
  unticked step is outlined and labelled "Current step"
  (`aria-current="step"`, `currentStepIndex`). The bottom bar's primary
  "Next step" (56 px) ticks it and scrolls the next into view (instant under
  reduced motion). Once every step is ticked, a view opened from a planned,
  not yet cooked meal swaps it for a primary "Done — mark as cooked" that
  closes cook mode without the prompt and opens that meal's mark-as-cooked
  review; opened from the recipe list there is no meal, so only Close
  remains. Ingredients are tickable rows (44 px, `aria-pressed`, check and
  strike-through) for gathering during prep. All still component state.
- **Tests**: `cook-mode-calc.test.ts` (splitting, scaling, formatting,
  duration parsing); `e2e/cook-mode.spec.ts` opens the view, ticks and
  un-ticks a step and closes back to the list, and starts and stops a step
  timer, on desktop and mobile. The seeded "Pancakes" recipe has two steps
  for the first; "Porridge" has a "10-12 minutes" step for the timer.
  UX-94 adds the close prompt (ticked step and running timer), Next step
  with ingredient ticking, and Done from a planned meal opening the
  mark-as-cooked review.

### Copy a recipe as text (GAP-43)

Sending a recipe to a friend used to mean retyping it. Each recipe's sheet
has a "Copy as text" button (under "Review ingredient matches"; the sheet stays open) that puts
the recipe on the clipboard as plain text and confirms with a toast.

- **Format**: `formatRecipeText` (`src/lib/recipe-text.ts`, pure): name,
  servings line, an "Ingredients" list (`- 3 dl Wheat flour`, prep note in
  brackets, an ingredient with no quantity is just its name), then
  "Instructions" as numbered steps (`splitSteps`). A recipe with no
  ingredients or no instructions leaves that section out. Labels come from
  the dictionary (`ingredientsLabel`, `instructionsLabel`, `servingsCount`),
  so the text is in the viewer's language; amounts use `formatCookQuantity`
  and the household's unit labels.
- **Deliberately not built**: no public share link or token, no import into
  another household. Every read stays behind `requireHousehold()` (decided
  2026-10-05, see PRODUCT.md). No schema change, no new browser storage.
- **Clipboard**: the success toast waits for `clipboard.writeText`; on a
  rejection (unfocused page, denied permission) an error toast shows.
- **Tests**: `recipe-text.test.ts` (both locales, no quantity, no
  instructions, no ingredients); `e2e/copy-recipe-text.spec.ts` clicks the
  button on desktop and mobile, asserts the toast and the clipboard text.

### Duplicate a recipe (GAP-48)

Making a variant (vegetarian lasagne, half batch) used to mean retyping
the ingredients and steps. A recipe's sheet has a "Duplicate" button
(under "Copy as text") that copies the recipe, closes the sheet, opens the
copy in the edit dialog and shows an "Undo" toast (8 seconds).

- **Action**: `duplicateRecipeAction(recipeId)`
  (`src/app/dashboard/meal-planning/recipe-actions.ts`) is a click action.
  It reads the source with `{ id, householdId }` from `requireHousehold()`,
  so another household's id is "Recipe not found" and nothing is written.
  The copy is named `duplicateRecipeName` ("{name} (copy)" / "(kopia)"),
  with the original name shortened to keep it within the 120-character
  limit. It carries instructions, servings, nutrition, tags, ingredient
  rows (pantry link, Don't-track flag, raw text, prep note) and sub-recipes.
  The favorite flag resets; cooked history, prepared batches and meal-plan
  entries stay with the original.
- **No shared rows**: ingredient and sub-recipe rows are created anew for
  the copy, so editing one recipe never changes the other.
- **Opening the copy**: the row of the new recipe opens its edit dialog when
  it arrives in the refreshed list (`RecipeManager` holds the new id).
- **Undo**: deletes the copy through `deleteRecipeAction`, so it is refused
  (with that action's error) if the copy has since become a sub-recipe.
- No schema change, no new browser storage.
- **Tests**: `recipe-actions.test.ts` (foreign id rejected, fields copied,
  favorite reset, new rows not shared, long names);
  `e2e/duplicate-recipe.spec.ts` duplicates a recipe, asserts the edit dialog
  and both recipes after a reload, and the Undo, on desktop and mobile.

### Recipe dietary tags (GAP-29)

From the competitive gap scan: Mealime and Plan to Eat let a household mark
a recipe vegetarian, gluten-free and so on and filter the recipe list by it.
`Recipe.tags String[] @default([])` (migration `recipe_tags`) holds keys
from a **closed** set defined once in `src/lib/recipe-tags.ts`
(`RECIPE_TAGS`): `vegan`, `vegetarian`, `glutenFree`, `dairyFree`,
`nutFree`, `lowCarb`, `quick`. The array order is the display order
everywhere.

- **Keys stored, labels from the dictionary**: the same split as AUTO-2's
  `inventory.autoCategories`. Labels live in `mealPlanning.recipeTags` in
  both `en.ts` and `sv.ts` (a test asserts every key has both), so
  switching language relabels every recipe and the filter compares exact
  keys, not free text. Not free-form on purpose: "veg", "veggie" and
  "vegetarian" typed on three recipes would split one filter three ways.
- **Validation**: `parseRecipeTags` (a plain membership check against `RECIPE_TAGS`) dedupes,
  sorts into canonical order and **drops** unknown values rather than
  rejecting the save, so a stale tab offering a since-removed tag can't make
  a recipe unsaveable. `createRecipeAction`/`updateRecipeAction` run the
  posted `tags` values (`FormData.getAll("tags")`) through it and never
  store anything else. An update replaces the whole set, like ingredients
  and components, so posting none clears them. `page.tsx` parses the stored
  column again on read, so a key later removed from the set just
  disappears instead of rendering raw. It's a plain `text[]`, not a Postgres
  enum or join table: the set is tiny, filtering happens client-side over
  the already-loaded list, and growing it needs only a key plus two labels,
  no migration.
  *Bundle size (PERF-7)*: `recipe-tags.ts` is imported by the client
  `recipe-manager.tsx` and `recipe-form-dialog.tsx`, so it must stay
  free of `zod` (which put a ~99 KB gz chunk into the meal-planning page).
  `isRecipeTag` is a `Set` lookup for that reason.
- **Form**: `RecipeFormDialog` (create and edit) shows every tag as a
  toggle chip (`aria-pressed`, the starter-picker look) under
  instructions, posted as one hidden `tags` input per selected tag.
- **Import**: the JSON-LD tier maps schema.org `suitableForDiet`
  (`tagsFromSchemaOrgDiet`, bare `VeganDiet` or full
  `https://schema.org/VeganDiet` URLs, string or array) for the unambiguous
  diets only: `VeganDiet` → vegan, `VegetarianDiet` → vegetarian,
  `GlutenFreeDiet` → glutenFree. `LowLactoseDiet` isn't dairy-free, and the
  other `RestrictedDiet` values have no tag, so they're ignored. The
  Microdata and heading-heuristic tiers are already guesses and always
  return `tags: []`. Imported tags are only *added* to the chips for review
  (never un-ticking one the user chose) and, like everything else imported,
  are only saved on submit.
- **Filter**: a tag `Select` ("All tags" or one tag) sits beside the name
  search above the `RecipeManager` list, the same all-or-one pattern as the
  inventory page's category and location filters. Both must match. It's a
  single row, so there's no folded mobile "Filters" dialog. The filter
  isn't persisted, and neither is the search. `recipeMatchesTag` treats
  `vegan` as implying `vegetarian` and `dairyFree` at filter time (a vegan
  recipe shows under either without ticking three chips, and an import that
  only says `VeganDiet` isn't hidden under "Vegetarian"). The implication is
  never written into the column, so un-ticking vegan later leaves nothing
  stale behind.
- **Rows**: each recipe row's meta line starts with its tags, and the
  recipe's sheet shows them as small secondary `Badge`s under the title.
  Rows without tags look as before.
- **Not in scope**: multi-tag (AND/OR) filtering, custom household tags,
  and using tags in the Cook tab or "use it up" ranking.

## Household tasks

`/dashboard/tasks` (`TasksClient`) — "Household Tasks v1", built from
[`docs/archive/JOY_GAP_BACKLOG.md`](./docs/archive/JOY_GAP_BACKLOG.md) item 6, the one Joy Gap ticket
that closes an actual product gap (a shared task list) rather than a tone
change. One flat, shared `HouseholdTask` list per household — deliberately
**not** a chore-chart/points/rewards system like Tody or OurHome: no fixed
due dates or calendar schedule, no per-person scoring, counts, streaks or
leaderboard, in v1 or planned. Tasks can repeat on a simple interval and a
repeating task can rotate between people (both below), but that's only ever
"whose turn is it", never a tally. Squirrel's audience is adult household
co-managers, not kids earning rewards.

- **Model**: `HouseholdTask` (`householdId`, `title`, nullable
  `assignedToMemberId`, nullable `completedAt`, nullable
  `completedByMemberId`, nullable `recurrenceIntervalDays`, nullable `recurrenceAnchorAt`,
  `rotationMemberIds String[]`, nullable `rotationPreviousAssigneeId`). `completedAt` is a nullable-timestamp-as-status
  (not a boolean/enum), mirroring `MealPlanEntry.consumedAt`.
  `assignedToMemberId`/`completedByMemberId` are two independent, both-
  nullable fields — a task can be completed by someone other than whoever
  it was assigned to, and an unassigned task can still be completed. Both
  use `onDelete: SetNull` (never `Cascade`), the same tradeoff
  `Transaction.recurringTemplateId` makes for its template: a member leaving the household
  unassigns/un-attributes their tasks rather than deleting task history.
- **Create and edit share one dialog (UX-24)**: both modes of
  `TaskFormDialog` have a title field (so a task can be renamed;
  `updateTaskAction` takes an optional trimmed `title`, 1-120 characters), a
  Cancel button and one primary submit.
- **Add task button (UX-4)**: the header button always shows its "Add task"
  label. It used to collapse to a lone "+" below `sm`, leaving the page's one
  primary action with no visible words on phones. `flows.spec.ts` asserts the
  visible text on the mobile project.
- **Recurrence**: `recurrenceIntervalDays` (1–90, the dialog offers every
  1, 2, 3 or 7 days; null = one-off) is the whole model — no rrule or
  weekday schedule. Nothing is written when a task reopens:
  `isTaskOpen` (`src/app/dashboard/tasks/recurrence.ts`) derives
  open/completed from `completedAt` and the interval at read time, and
  page.tsx, the dashboard's "my tasks" card and the toggle action all call
  it with the same `now` and time zone. Completing again overwrites
  `completedAt`, so there's no completion-history table (the earlier
  `completedAt` still counts for the week it happened in, e.g. in the
  weekly recap). While a recurring task is shown completed the row reads
  "Next due <date>" (`getNextDueDate`).
- **Rescheduling runs on the local day (UX-137)**: the next due moment is
  always a local midnight, never "the tick plus 24 h". An interval under 7
  days counts from the start of the local day it was ticked on, so a daily
  chore ticked at 23:40 reopens at 00:00 and its row never reads "Next due"
  with today's date. An interval of a week or more keeps a fixed anchor
  day: occurrences fall on the anchor's local day and every N days after
  it, and a tick (late, or early because the chore was already open) closes
  only the occurrence it falls in, so a Saturday chore done on Thursday is
  still a Saturday chore. The anchor is the local day in
  `HouseholdTask.recurrenceAnchorAt` (UX-144): set when a task is created
  with an interval and re-set to the day of the edit whenever its interval
  changes (cleared when the repeat is removed; saving the same interval
  leaves it), so "every Thursday" is a matter of editing the task on a
  Thursday. Null (rows from before the column) reads `createdAt`.
  `task-anchor-day.spec.ts` covers the edit. "Local" is the
  visitor's browser zone: `TimeZoneCookie` (dashboard layout) keeps the
  `time_zone` cookie equal to it and refreshes once when it changes;
  `getTimeZone()` (`src/lib/get-time-zone.ts`) reads it, falling back to
  UTC before the first visit has set it. `recurring-task-day.spec.ts`
  covers it (the day rolling over is back-dated in Postgres, since the
  server clock can't be moved).
- **Taking turns (GAP-38)**: an opt-in round-robin on a *repeating* task,
  like Grocy's chores or OurHome. `rotationMemberIds` is the ordered list of
  people taking turns; empty = no rotation. Valid only with a recurrence and
  at least two people, no duplicates, at most 20, and every id must belong
  to the session household (checked server-side in `createTaskAction`/
  `updateTaskAction`; a forged id is "Member not found"). While rotating,
  the assignee is "whose turn it is now" and must be one of those people
  (defaults to the first). A `String[]` rather than a join table, same
  call as `Household.categoryOrderManual`: always read and written whole,
  in order, never queried by member. No FK, so a member who leaves stays
  in the array until the task is next saved (the edit dialog only offers
  current members).
  - **Who's next** is `nextAssigneeInRotation` (`src/lib/task-rotation.ts`,
    pure and unit-tested): walk forward from the current assignee's slot,
    wrapping around, to the next person still in the household. A departed
    member's slot still counts as a position but they're skipped; an
    assignee not in the list (or unassigned) starts from the first active
    person; one active person keeps it; nobody active leaves the assignee
    as it is (or null if they've left too).
  - **Advancing** happens in `toggleTaskCompletedAction` when the task is
    completed, not when it reopens (reopening never writes, see above), so
    the next person sees it in their dashboard's "my tasks" straight away.
    It advances from the *assignee*, not the completer: helping out on
    someone else's turn doesn't reorder the rotation. The write (and the
    undo below) is an `updateMany` guarded on the `completedAt` it read, so
    a double-tap or two members ticking at once advances only once; the
    losing request is a no-op success.
  - **Undo**: completion also stores who had the turn in
    `rotationPreviousAssigneeId`. Un-completing a rotating task restores
    that person instead of advancing again (if they've left, it goes back
    to unassigned, like `onDelete: SetNull` would). An explicit edit resets
    `rotationPreviousAssigneeId` to whoever the edit assigned, so undo never
    reverts a human's choice.
  - Deliberately no counts, streaks, "done most" or member-vs-member
    comparison anywhere — the row only says "Next: <name>".
- **Actions** (`src/app/dashboard/tasks/actions.ts`): `createTaskAction`
  (form action), `updateTaskAction` (assignee, recurrence and rotation;
  title isn't editable), `toggleTaskCompletedAction` (flips `completedAt`
  between `null` and `new Date()` — or, for a recurring task past its
  interval, completes it again — always attributing completion to the
  *caller's own* household-member id, never a client-supplied one; on
  un-complete (UX-102), `completedAt` and `completedByMemberId` are put back
  exactly from `previousCompletedAt` / `previousCompletedByMemberId`, which
  the tick filled with the completion it overwrote — so a tick-untick on a
  never-done task shows no "Last done by", and a recurring task keeps its
  real earlier completion; a previous completer who has left the household
  restores as no one),
  `deleteTaskAction`.
- **UI**: one shared `TaskFormDialog` for create and edit (title on
  create, assignee, repeat; once a task repeats and the household has two
  or more members, a "Take turns" list with add, remove and up/down; the
  first person added starts from the assignee as #1, and a one-person
  list shows "Add at least one more person" as an error and disables
  Add) and a
  flat list split into open/completed sections, matching
  `ShoppingListClient`'s shape. An unassigned task shows a neutral
  "Unassigned" badge; a completed task credits its completer by name, never
  a count. A repeating task shows a "Repeats every N days" badge, and a
  rotating one "Next: <name>" — for an open task the person after the
  current assignee, for a completed one the person it has already passed
  to.
- **Weekly recap**: `src/app/dashboard/tasks/weekly-recap-calc.ts`
  (`computeWeeklyTaskRecap`) groups the current Monday-start week's
  completed tasks by completer, in first-appearance order — **never** sorted
  or labeled by per-person count, which would read as a leaderboard. A quiet
  week renders nothing (`TasksWeeklyRecap`, dismissible, mirrors
  `MealVarietyRecap`'s shape exactly), same non-goal as the meal-planning
  variety recap.
- **Title opens, tick completes (UX-101)**: tapping a task's title opens
  its edit dialog (the title is a button that clicks the row's hidden
  `data-swipe-edit` button, the same hand-off the swipe tray and the ⋯ menu
  use). Only the checkbox or a right swipe completes or reopens a task, so a
  stray tap while scrolling can't complete one silently
  (`e2e/task-title-opens.spec.ts`).
- **Labelled title with a length counter (UX-107)**: the task dialog's title
  field has a visible "Task title" label (not just a placeholder). From 100
  characters a status line under it reads "{n} of 120 characters" and turns
  destructive at the 120 cap (`maxLength` and the server schema), so input
  never stops without a word (`e2e/task-title-counter.spec.ts`).
- **Ticking a task (UX-104)**: a tick toasts "Done: {title}" with Undo (the
  same toggle back, 5 s), since the row leaves for "Completed" below the
  fold. The weekly recap is frozen at the list as the page opened, so the
  first tick of the week doesn't shift rows. Ticking the last open task
  shows a mascot "You're all caught up!" card in place of the open section
  (squirrel rises in once; static under reduced motion; no count or
  streak). It clears when a task is open again (Undo, a new task).
- **All caught up, and old one-offs that leave (UX-105)**: with no open
  task (and at least one completed) the mascot "You're all caught up!" card
  shows above Completed on every visit, not only right after a tick, so the
  page never opens straight on the Completed list. One-offs ticked more than
  7 days before the server's `now` (`isOlderCompletedOneOff`,
  `src/app/dashboard/tasks/older-completed.ts`) collapse behind a "Show N
  older" button under the Completed rows (toggles to "Hide older"); nothing
  is deleted. Repeating tasks never collapse. The open/closed state is
  per-visit, not stored (`e2e/task-caught-up.spec.ts`).
- **Compact rows, and a Mine filter (UX-106)**: a task row is one line on a
  phone, checkbox, title and assignee badge, at most 56 px (about eight tasks
  a screen, up from four). Repeat, next due, whose turn and who did it wrap
  in a small line under the title instead of pushing the actions onto a
  second and third line, and a long assignee name is cut short (full name as
  the tooltip). Below `sm` the row carries neither Edit and Delete icons nor
  a ⋯: Edit and Delete are in the swipe tray, and the edit sheet (a tap on
  the title) has a quiet **Delete** button that closes the sheet and hands
  over to the row's own trash button, so the same confirm dialog opens
  (M7: the sheet is the visible path). From `sm` up the icons stay.
  Above the list, in a household of two or more, an **Everyone / Mine**
  toggle (`aria-pressed` buttons) shows only the tasks assigned to you
  (`filterTasks`, `src/app/dashboard/tasks/task-filter.ts`: open or
  completed; unassigned tasks only show under Everyone). The weekly recap
  stays household-wide. The choice is remembered per device in localStorage
  under `tasks.filter` (`TASKS_FILTER_STORAGE_KEY`, listed on the privacy
  page; `useLocalPreference`). Nothing stored means Everyone, so a first
  visit never hides a task (`e2e/task-compact-rows.spec.ts`).
- **Nav**: lives behind the mobile "More" menu alongside Meal Planning/
  Personal Budget/Household/Profile (`src/components/dashboard/nav-items.ts`)
  rather than the primary mobile bar — revisit only if usage shows it
  deserves that placement.
- **Deferred**: a dedicated "tasks cleared" bell notification (item 6d) was
  considered and explicitly deferred — the weekly recap already gives
  completions a positive surface, and a notification on top risks the same
  "positive notifications become noise" failure the bell's other good-news
  kinds guard against, for a domain with no usage data yet. Revisit once
  6a-6c have real usage to judge against.

## Household notes board

GAP-16. A "Notes" card on the Household page (`/dashboard/household`) for
things everyone should know that don't fit a shopping-list item or a task —
"the plumber's coming Thursday", "we're out of the good coffee, don't buy
the other one". Cozi's family journal/notes is its most-cited differentiator
from a pure list/calendar app; this is the minimal version of it.

- **Model**: `HouseholdNote` (`householdId` with `onDelete: Cascade`,
  nullable `authorMemberId`, `body`, `createdAt`), indexed on `householdId`.
  `authorMemberId` uses `onDelete: SetNull`, the same tradeoff
  `HouseholdTask.completedByMemberId` makes: a member leaving keeps the
  notes they wrote (still useful to everyone else) and the UI shows
  "Former member" as the author instead of the note disappearing.
- **Actions** (`src/app/dashboard/household/notes-actions.ts`):
  `createNoteAction` is a form action (`useActionState`); the body is
  trimmed and must be 1–`NOTE_BODY_MAX_LENGTH` (1000, in
  `src/lib/household-notes.ts`, shared with the textarea's `maxLength`)
  characters. The author is always the caller's own household-member id,
  resolved from the session, never a client-supplied one.
  `deleteNoteAction` is a click action behind the shared `ConfirmDialog`.
  Both scope every query by the session household from
  `requireHousehold()`; delete is a `deleteMany` on `{ id, householdId }`,
  so another household's note id is a silent no-op.
- **Permissions**: any member may delete any note, not just its author or
  the owner — same as `deleteShoppingListAction`. The board is shared
  scratch space, a note is usually cleared by whoever dealt with it, and
  gating it would strand notes from members who've left.
- **UI** (`src/components/household/household-notes.tsx`): an add form
  above a flat, newest-first list. Each note shows its body (line breaks
  kept), the author's display name (or "Former member") and the date, with
  the year only when it isn't the current one. Add and delete only — no
  edit, pinning or rich text in v1.
- **Not a notification trigger**: adding a note creates no bell
  notification or push. A bell badge must mean something's wrong (see
  "Notification center"); the notes board is just a page you check.

## Calendar feed

GAP-3. A read-only iCalendar (`.ics`) feed of the household's meal plan and
monthly bill due dates, so the plan shows up in the calendar app people
already have open (Cozi's core differentiator). Calendar apps subscribe by
URL and re-fetch on their own; nothing is ever written back.

- **Opt-in, off by default.** `Household.calendarFeedToken String? @unique`
  (migration `20260925203000_household_calendar_feed_token`); null means the
  feed is off. Calendar apps can't send cookies, so the token in the URL is
  the only credential and anyone holding the link can read the feed. That's
  why it isn't on until someone chooses it.
- **Token**: 32 bytes from `crypto.randomBytes`, base64url (43 characters),
  generated by `generateCalendarFeedToken` (`src/lib/calendar-feed.ts`).
  Bigger than the `randomUUID()` other links use because this one never
  expires on its own and lives in calendar apps' settings indefinitely.
- **Management is owner-only** (`enableCalendarFeedAction`,
  `regenerateCalendarFeedAction`, `disableCalendarFeedAction` in
  `src/lib/actions/household.ts`, checked against the session's `role`).
  Unlike the per-list shopping share link, which any member manages, this
  publishes the whole household's meal plan and bill names, so turning it on
  is treated as administration. Enable only sets a token while the column is
  still null (`updateMany` with `calendarFeedToken: null` in the filter), so
  a double click can't silently rotate a link someone just subscribed to.
  Regenerate replaces the token, which is how a leaked link is revoked: the
  old URL 404s on its next fetch. Disable sets it back to null; turning the
  feed on again gives a new link.
- **UI** (`CalendarFeedSetting`, `src/components/household/calendar-feed-setting.tsx`):
  a card on the Household page that always states, before and after turning
  it on, that anyone with the link can see planned meals and bill names
  without logging in and that amounts are never included. Once on, every
  member sees the URL with a copy button and an "Open in calendar app" link
  (the same URL with the `webcal://` scheme, which opens the subscribe
  prompt on phones). The owner also gets "Get a new link" and "Turn off",
  both behind a `ConfirmDialog` since both break existing subscriptions. A
  contributor with the feed off sees that the owner can turn it on. The URL
  is built server-side from `APP_URL` (request headers only as the local-dev
  fallback), the same order as `absoluteAppUrl`.
- **Route**: `src/app/api/calendar/[token]/route.ts`. Under `/api`, which
  `src/proxy.ts`'s matcher excludes, so it never gets the login redirect.
  A malformed token 404s before any database or rate-limit work. The rest go
  through `checkRateLimit` (120 requests an hour per token: keyed on the
  token, not the IP, because Google Calendar fetches every feed from a
  shared pool of addresses) and then a `findUnique` on the unique index.
  Unknown, malformed and turned-off tokens all get the same plain 404.
  Responses are `Cache-Control: private, no-store` so turning the feed off
  or regenerating takes effect on the next fetch, plus
  `X-Robots-Tag: noindex`.
- **Language**: the feed has no session, so the viewer's locale is put in
  the URL (`?lang=en|sv`, `calendarFeedPath`) when the link is shown. Each
  member's copy of the link gets event titles in their own language; an
  unknown value falls back to English.
- **What's in it** (`buildCalendarFeedEvents`, `src/lib/calendar-feed.ts`):
  a window from 30 days back to 183 days ahead (`calendarFeedWindow`), as
  all-day events.
  - Meal-plan entries, titled "Dinner: Lasagna" (slot label from
    `mealPlanning.mealType*`, then the recipe name, else the freeform name;
    just the slot when a deleted recipe left neither). Ordered breakfast →
    snack within a day. Capped at 2000 entries per response.
  - Active `EXPENSE` recurring templates, titled "Due: Rent", one event per
    due day. Only MONTHLY templates with a `dayOfMonth` have a real due day;
    WEEKLY/YEARLY templates don't (the schema ignores `dayOfMonth` for them),
    and making one up from `createdAt` would put the bill on a day nobody
    chose, so they're left out. Due days are expanded by
    `expandMonthlyDueDates` (`src/lib/recurring-template-calc.ts`), which
    clamps a day past a short month's end to its last day (the 31st becomes
    30 April, 28/29 February). Income and savings templates, and the
    personal budget, aren't included.
  - **No amounts**, recipes, notes or member names. The link works without
    a login and gets pasted into third-party calendar services, so the feed
    carries only what a calendar entry needs.
- **UIDs** are stable across fetches so clients update events in place:
  `meal-<entryId>@squirrel-calendar-feed` and
  `bill-<templateId>-<YYYYMMDD>@squirrel-calendar-feed` (changing a bill's
  due day reads as old events removed and new ones added).
- **iCalendar writer** (`src/lib/ical.ts`, pure, no library): RFC 5545 CRLF
  line endings (including after the last line), lines folded at 75 octets
  (counted in UTF-8 bytes and never splitting a multi-byte character), TEXT
  values escaped (`\`, `;`, `,`, line breaks as `\n`, other control
  characters dropped), `DTSTAMP` in UTC, `DTSTART;VALUE=DATE` plus an
  exclusive next-day `DTEND`, and `TRANSP:TRANSPARENT` so a planned dinner
  doesn't mark anyone busy. Dates are read in UTC because meal dates are
  UTC-midnight days and a DATE value has no time zone. The calendar is
  named "<household> (Squirrel)" and hints a 6-hour refresh
  (`REFRESH-INTERVAL` and `X-PUBLISHED-TTL`).

## Theming

The app supports light, dark, and system themes via **next-themes**
(`ThemeProvider attribute="class" defaultTheme={…} enableSystem` in
`src/app/layout.tsx`), which toggles a `light`/`dark` class on `<html>` and
handles the flash-of-wrong-theme problem itself (an inline script sets the
class before first paint, reading its own `localStorage` key — this is the
same technique, and it's the reason `<html>` has `suppressHydrationWarning`
and no longer hardcodes a `dark` class). **UX-51**: a browser with no stored theme follows the
system's light/dark setting (`defaultTheme` is the signed-in account's saved
theme, else `"system"`; the `User.theme` column now defaults to `system`, and
accounts made before keep the `dark` they were given). The browser chrome
colour follows the page: `layout.tsx`'s `themeColor` lists both schemes by
media query (`THEME_COLORS` in `theme-choice.ts`) for first paint, and once
hydrated `ThemeColorSync` writes the resolved theme's colour to every tag, so
a chosen theme keeps matching chrome when the system scheme flips. The toggle is `useThemeCycle()`
(`src/components/theme/use-theme-cycle.ts`), cycling light → dark → system,
used in the sidebar (desktop), the bottom nav's "More" menu (mobile; the menu
stays open on a theme tap) and, for logged-out visitors, `PublicThemeToggle`
in the legal footer beside the language toggle. Each shortcut names the
setting in use ("Theme: Dark" with the matching icon, "Language: English"),
not the next one. The Profile's Preferences section has the full choice as
segmented radio groups, Language (English / Svenska) and Appearance (Light /
Dark / System), in `PreferencesControls`; a language tap checks its segment
at once (`useOptimistic`) and dims the group until the server has answered
(M5). `e2e/ux-51.spec.ts` covers it.

Both themes share the same `body` background technique: a
`radial-gradient(circle, var(--gradient-start), var(--gradient-end))` (set
in `globals.css`'s `@layer base`), where `--gradient-start`/`--gradient-end`
are defined per-theme in `:root` (light: soft lavender-white,
`#f3ecfb` → `#fefcff`) and `.dark` (the original near-black purple,
`#180828` → `#0a0414`). Don't reintroduce a plain `bg-background` on
`body` — it would paint over the gradient with a flat color. The dark
gradient's outer stop is deliberately near-black, not literal `#000000` —
because the background uses `background-attachment: fixed`, it's recentered
on the viewport at every scroll position, so on a page taller than one
screen (the landing page, mainly) content near the top/bottom edge of a
scrolled viewport sits in the gradient's outer stop; a true black there made
`bg-card` surfaces nearly invisible. Keep both themes' outer stops
non-extreme for this reason.

The light palette (`:root` in `globals.css`) isn't shadcn's generic gray
default — it carries the same violet tint as dark mode (soft
lavender-tinted neutrals, a slightly darker violet `--primary` for contrast
against a light background) so the brand reads as one consistent world in
either theme, not "dark mode with a plain light mode bolted on". When
adjusting either palette, keep them visually paired (same hue family,
inverted lightness) rather than tuning one in isolation.

The look is deliberately playful, not corporate-neutral — colorful, rounded,
a little bouncy. Keep new UI consistent with this rather than reverting to
flat grayscale:

- **Fonts**: `Nunito` (`--font-nunito`, mapped to `--font-sans`) is the body
  font; `Baloo 2` (`--font-baloo`, mapped to both `--font-heading` and
  `--font-display`) is the rounded, chunky display font for headings. Both
  are loaded via `next/font/google` in `src/app/layout.tsx`. `CardTitle` and
  `DialogTitle` already apply `font-heading` — any new heading-style text
  should use the `font-heading` (or `font-display` for large hero copy)
  utility rather than the default body font, so headings stay visually
  distinct app-wide. `Geist_Mono` (`--font-mono`) is unchanged.
- **Color**: the neutral tokens (`card`, `popover`, `secondary`, `muted`,
  `accent`, `sidebar*`) carry a subtle violet tint (`oklch(... 290)` /
  `oklch(... 300)`) instead of pure grayscale, so surfaces read as part of
  the same purple-toned world as the background gradient. `--primary`,
  `--ring`, and `--sidebar-primary` all share one vivid violet/magenta hue
  (`oklch(0.66 0.22 300)`) so buttons, focus rings, and the active sidebar
  item feel like one consistent brand color rather than three different
  accents. `--chart-1..5` are a small rainbow (pink/amber/teal/violet/green)
  for future charts. Amber (`bg-amber-500`, see `inventory-table.tsx`) is
  reserved for the "low stock" semantic and shouldn't be reused as a generic
  accent color. When adding new colored UI, pick from these existing tokens
  before introducing a new ad-hoc color.
- **Radius**: `--radius` is `0.9rem` (bumped up from shadcn's default
  `0.625rem`) — this is the single lever for the app's rounded, friendly
  corners on buttons/inputs/cards/dialogs/badges. Change it there, not per
  component, to keep rounding consistent.
- **Icons**: `lucide-react` is already a dependency and used throughout nav
  (`nav-items.ts`). Prefer adding a leading `lucide-react` icon to primary
  buttons and form inputs where it reinforces meaning (see
  `login-form.tsx`/`signup-form.tsx` for the input pattern: a `relative`
  wrapper, an absolutely-positioned icon at `left-2.5`, and `pl-8` on the
  `Input`). Don't add icons purely for decoration where they don't clarify
  the action.
- **Buttons/inputs**: `Button`'s default variant carries a colored shadow and
  a small lift-on-hover/press-down-on-active motion; `Input` has a 1px
  (`border`) `--input` outline, the same weight as the card rings. These are
  defined once in `src/components/ui/button.tsx` / `input.tsx` — every usage
  inherits them automatically, so don't override with one-off `shadow-none`
  or `border-2` tweaks unless a specific screen genuinely needs a heavier
  control. Disabled solid buttons (`default`, `secondary`) keep full opacity
  on a `muted` fill with `muted-foreground` text instead of fading: white at
  50% opacity over the faded primary was ~1.5:1 in the light theme.
- **Contrast**: every text colour holds 4.5:1 on the surfaces it's painted
  on, and field outlines (`--input`) and the focus ring hold 3:1, in both
  themes. `src/app/globals-contrast.test.ts` reads `globals.css` and fails
  `npm test` when a token change breaks a pair, naming the pair and ratio.
  The status colours (`--destructive`, `--warning`, `--attention`,
  `--success`) are tuned to be text on a `--status-tint` (10% light, 20%
  dark) mix of themselves — that's how Badge, the destructive Button and
  toasts use them — not only on a plain surface. The active segmented tab
  is a ringed `card` pill lifted off the `muted` track (the `secondary`
  fill was 1.03:1 against it). The phone sticky bars (inventory search,
  shopping-list add line) are translucent with a blur
  (`bg-background/85`, `backdrop-blur-sm`) so they melt into the page
  gradient instead of painting a flat band over it. Dark
  `--primary-foreground`
  is a deep purple ink, not white: the lighter dark-theme purple can't hold
  4.5:1 with white text. Because dark `--input` is white at 35% (for the 3:1
  outline), the dark field fills in `components/ui/*` use it at small
  fractions (`bg-input/13`, hover `/20`, disabled `/35`) so fields look as
  they did at 15%; light disabled fields use `bg-input/15`.
- **Success colour**: green text and icons that mean good news (a healthy
  or balanced budget, income, done, saved, "enabled") use `text-success`,
  not `text-chart-5`. `chart-5` is the same green tuned for chart marks and
  is only 3.2:1 as text on a light card; it stays for chart bars, legend
  dots and avatar fills. The same rule covers the other chart tokens: the
  overview stat numbers use `warning` (low stock), `primary` (shopping) and
  `foreground` (total), not `chart-1/2` as text (3.5:1 and 2.9:1).
- **Toasts**: `src/components/ui/sonner.tsx` turns on Sonner's `richColors`
  and points each outcome type at the app's tokens: `toast.success` green
  (`--success`), `toast.error` red (`--destructive`), `toast.warning` amber
  (`--warning`), each as its colour on a `--status-tint` of it over the
  popover with a 30% border (mixed `in oklab`: an `oklch` mix swings the
  hue through the popover's violet, turning green blue). `toast.info` and plain `toast()` stay neutral
  (popover) — they're news, not an outcome. The variables have to be set
  inline on the Toaster, since Sonner's stylesheet sets the same ones on
  that element per theme.
  **Placement (UX-48)**: below 640 px (the BottomNav range, which the
  Toaster checks itself with `matchMedia`, since Sonner's own phone
  breakpoint is 600 px) toasts sit at the top, centred, below
  `env(safe-area-inset-top)`. The bottom edge there is the BottomNav, a
  bottom sheet's sticky footer ("Complete list", the share link's "Copy")
  and the shopping "Next up" dock, and no bottom offset clears all three,
  so a toast no longer hides a footer button or a dock row. From 640 px up
  they keep Sonner's bottom-right corner. The pure choice is
  `toastPlacement` (`src/components/ui/toast-placement.ts`). Tests:
  `toast-placement.test.ts`; `e2e/toasts-clear-controls.spec.ts` finishes a
  list with a "Didn't get it" row and asserts "Complete list" stays clear
  and clickable, and that a toast misses the dock. Under `pointer: coarse` the action ("Undo")
  button is 44 px (`globals.css`).
- **Copy-link buttons** (household invite, shopping-list share link,
  calendar feed) are one component, `CopyLinkButton`
  (`src/components/ui/copy-link-button.tsx`). It awaits
  `clipboard.writeText` and shows "Copied" only on success; a rejection
  shows an error toast telling the user to copy the selected link by hand.
  On a coarse-pointer device with `navigator.share`, a "Share" button
  opens the system share sheet.

## Access control (landing / auth pages vs. the app)

`src/proxy.ts` (Auth.js's edge middleware, run for every non-API request —
see the matcher there) is the single source of truth for this and should
stay that way rather than re-adding per-page redirect checks:

- **Logged out**: only `/`, `/login`, `/signup`, and `/join/[token]` are
  reachable. Anything under `/dashboard` redirects to `/login`. There is no
  other page — the app doesn't have a public marketing section beyond the
  landing page.
- **Logged in**: `/`, `/login`, and `/signup` all redirect to `/dashboard` —
  a logged-in user can never see the landing/marketing page or the auth
  forms via any navigation path (typing the URL, a stale bookmark, browser
  back, a `<Link href="/">`, etc.), since the redirect happens in middleware
  before the page renders.
- **Exception**: `/join/[token]` is reachable both logged in (shows
  `AcceptInviteForm`) and logged out (shows `JoinSignupForm`, which creates
  the account) — see "Sharing" above. It's intentionally excluded from the
  logged-in redirect rule because it's a distinct action (accept/join a
  specific household), not the generic landing/auth flow.
- `/api/*` isn't matched at all, which is what lets the token-only calendar
  feed (`/api/calendar/[token]`, see "Calendar feed") answer calendar apps
  that have no session. Anything added under `/api` must do its own auth.
- Because middleware already redirects logged-in visitors away from `/`,
  `src/app/page.tsx` does **not** duplicate that check with its own
  `auth()` call — don't re-add one there; it'd be a second session lookup
  for a redirect that can never fire.

### Public page titles and link previews (UX-64)

- Every public route has a localised `<title>` and exactly one `<h1>`. The
  root layout's title template appends " · Squirrel", so a page passes only
  its own name: "Log in · Squirrel" / "Logga in · Squirrel". The landing page
  uses an absolute title ("Squirrel: run your household like a dream team").
  Dashboard pages set none and keep the plain "Squirrel".
- Pages build their metadata through `src/lib/page-metadata.ts`
  (`buildMetadata`, `titleOnlyMetadata`), which also emits the `og:` and
  `twitter:` tags. A child's `openGraph` replaces the parent's, so every page
  that wants a preview gets the full set from that helper.
- `/`, `/join/[token]` and `/share/shopping-list/[token]` are the pages that
  get passed around, so their previews are specific: an invite is titled
  "Join {household}" with a description naming the household, and a shared
  list is titled with the list's name. A dead token gets the generic
  "Invalid invite" / "Link not found" title and no household or list name.
  The share page's lookup is rate limited, so `generateMetadata` and the page
  share one `cache()`d call.
- The preview image is `/icon-512-maskable.png`, made absolute by the root
  layout's `metadataBase` (from `APP_URL`). With `APP_URL` unset it points at
  localhost, which only matters in local dev.
- The page's `<h1>` is the card title: `CardTitle` takes `as="h1"`. The text
  for the titles with no other home is in the dictionaries' `meta` section;
  `/privacy` and `/terms` titles are localised while their bodies stay English.
- Covered by `e2e/public-titles.spec.ts`.

### Session revocation on password change (SCALE-H)

Sessions are stateless JWTs, so there's no session row to delete when a
password changes. Without extra work a stolen session cookie would survive
a password reset — exactly the moment someone is trying to lock an
intruder out. The fix is a password "version" stamped into the token:

- `User.passwordChangedAt` (nullable) is set to `now()` by both
  `resetPasswordAction` (forgot-password link) and `updatePasswordAction`
  (profile page), in the same `update` that writes the new `passwordHash`.
- At sign-in, `authorize()` (`src/lib/auth.ts`) returns it and the `jwt`
  callback (`src/lib/auth.config.ts`) stores it as `token.pwdChangedAt`
  (epoch ms, or null); the `session` callback exposes it as
  `session.user.pwdChangedAt`. The callbacks only read what `authorize()`
  handed them, so `auth.config.ts` stays Edge-safe.
- `requireHousehold()` and `requireUserId()` (`src/lib/session.ts`) compare
  it with the database on every request. `requireHousehold` gets
  `passwordChangedAt` in the same `user.findUnique` that loads the
  memberships, so it costs no extra round trip; `requireUserId` adds one
  small `select`. The rule lives in `isSessionRevoked()`
  (`src/lib/session-revocation.ts`): DB null → never changed, every token
  valid (deploying this logged nobody out); otherwise the token is revoked
  if its claim is missing/null or older than the DB value. A token for a
  user row that no longer exists is revoked too.
- `proxy.ts` can't do this check (Edge runtime, no Prisma), so it still
  sees a revoked cookie as "logged in". That's why a revoked session is
  **not** sent to `/login`: `proxy.ts` would bounce it to `/dashboard`, which
  would bounce it back, forever. It's sent to `/session-expired`
  (`src/app/session-expired/route.ts`), a Route Handler (Server Component
  renders can't write cookies) that re-runs `isSessionRevoked()` itself and
  only then calls `signOut({ redirectTo: "/login?expired=password" })`. A
  still-valid session hitting that URL is just redirected to `/dashboard`,
  so it can't be abused as a cross-site GET logout link. `/login` shows
  "You were signed out because your password was changed" for
  `?expired=password`.
- Code that calls `auth()` directly without either guard (`/join/[token]`,
  `/verify-email/[token]`, the locale/theme preference sync) isn't
  covered — none of it exposes account or household data. Everything under
  `/dashboard` and every data-touching Server Action goes through one of
  the two guards.
- This revocation doesn't reach `PushSubscription` (Web Push, not a
  session cookie), so `resetPasswordAction` and `updatePasswordAction` also
  `deleteMany` every `PushSubscription` row for the user in the same
  transaction as the `passwordChangedAt` stamp (SEC-5). `logoutAction`
  drops just this device's subscription, on both the server (its DB row)
  and the browser (`subscription.unsubscribe()`), since only client-side
  JS knows which subscription is this device's — every logout entry point
  (the sidebar and bottom-nav menus, and the no-household page's
  `LogoutButton`) calls `src/lib/push-client.ts`'s `useLogout()` hook
  instead of `logoutAction` directly, which also exposes a `pending` flag
  so the button disables itself during the lookup. This makes logout
  require JavaScript (it no longer degrades to a plain form submit), which
  matches the rest of the sidebar/bottom-nav's other buttons (theme,
  locale) — none of them work without JS either.

### Login rate limiting (SEC-1)

The per-email login throttle (`checkRateLimit("login:<email>")`,
`LOGIN_RATE_LIMIT` = 10 attempts / 10 minutes — see its doc comment for why
this throttles instead of locking accounts out) lives inside the
Credentials provider's `authorize` callback in `src/lib/auth.ts`, not in
`loginAction` (`src/lib/actions/auth.ts`). It used to be the other way
round, which left it bypassable: Auth.js also serves
`POST /api/auth/callback/credentials` directly (paired with
`GET /api/auth/csrf`), and that route calls `authorize` without ever going
through `loginAction`, so a script hitting it directly got unlimited
password guesses against any known email.

- `authorize` trims and lowercases the submitted email itself before using
  it as both the rate-limit key and the `prisma.user.findUnique` lookup —
  `loginAction`'s Zod schema already does this, but `authorize` is also
  reachable from that credentials callback route, which never runs through
  `loginSchema`.
- The check runs before the `user.findUnique` call and before
  `bcrypt.compare`, and regardless of whether the account exists, so a
  throttled attempt never pays either cost and an unknown email doesn't
  skip the bucket.
- On the limit tripping, `authorize` throws `RateLimitedSignin` — a
  `CredentialsSignin` subclass with `code = "rate-limited"`, the same
  pattern `EmailNotVerifiedSignin` already used for the "verify your email"
  case. `loginAction` catches it (checked before the generic `AuthError`
  branch, same as `EmailNotVerifiedSignin`) and returns its existing "Too
  many attempts. Please wait a few minutes and try again." message, so the
  user-facing behavior is unchanged from before the fix.
- `loginAction` no longer has a rate-limit check of its own: a pre-check
  there would consume a second attempt from the same bucket `authorize`
  already checks for that same sign-in, silently halving the effective
  limit. `signIn("credentials", ...)` always calls `authorize` internally,
  so one call to `loginAction` still means exactly one throttle check.

### Dependency audit findings (SEC-12)

`npm audit --omit=dev` still reports `prisma`'s transitive `mysql2` and
`deepmerge-ts` (via `@prisma/config`) as high, and the fix npm offers is a
downgrade to prisma 6, so it isn't taken. Moving `prisma` to
`devDependencies` is not the answer: it **already is** one. The finding
survives `--omit=dev` because `@prisma/client` declares `prisma` as an
*optional peer dependency* (`"prisma": "*"`), which npm 7+ installs and
audits as part of the production tree. Both packages only run in the CLI
(`migrate deploy`, `generate`); the deployed app imports `@prisma/client` and
`@prisma/adapter-pg`, never `mysql2` (the datasource is Postgres) or
`@prisma/config`. `scripts/vercel-build.mjs` needs the CLI at build time
and Vercel installs devDependencies for builds, so `prisma` stays where it
is. The real fix is upstream (a Prisma release with patched `mysql2` and
`deepmerge-ts`); re-run the audit when MAINT-12's Dependabot config proposes
a Prisma bump. `next-auth` is still `5.0.0-beta.32`; there is no stable v5,
so watch its advisories through the same Dependabot config.

## Navigation & responsive layout

Nav sections (Overview, Inventory, Shopping list, Meal planning, Budget,
Household, Profile) are defined once in `src/components/dashboard/nav-items.ts`
(icon + href + a `NavKey`, e.g. `"overview"` — **not** a label string; the
label comes from `dict.nav[key]`, see "Internationalization") and consumed
by both layouts below — add a section there, not in the sidebar/bottom-nav
components directly.

- **Desktop (`sm` and up)**: `src/components/dashboard/sidebar.tsx` renders a
  left sidebar with an icon + label per section, the `HouseholdSwitcher` at
  the top, and (bottom to top) the sidebar-collapse toggle, log out, the
  theme toggle, the language toggle, and the notification bell pinned to the
  bottom (see "Notification center" below). Expanded by default; a toggle
  collapses it to an icon-only rail (`w-16` vs `w-56`). The expanded/collapsed
  state is written to the `sidebar_expanded` cookie (`SIDEBAR_COOKIE` in
  `nav-items.ts`) on toggle and read server-side in
  `src/app/dashboard/layout.tsx` so the initial render matches — no
  client-side flash.
- **Mobile (below `sm`)**: `src/components/dashboard/bottom-nav.tsx` renders a
  fixed bottom bar with 5 icons: Overview, Inventory, Shopping list, Budget,
  and a "More" dropdown menu holding Meal planning, Household, Profile, the
  language toggle, the theme toggle, the notification bell (as a nested
  submenu — see "Notification center" below), and log out
  (`overflowMobileNavItems`/`primaryMobileNavItems` in `nav-items.ts`). Meal
  planning and Household are in the overflow rather than the primary bar
  because they see lower daily use than inventory/shopping/budget. The
  dashboard `<main>` gets extra bottom padding (`pb-24 sm:pb-8`) so content
  isn't hidden behind the fixed bar.
- On mobile the sidebar is hidden entirely; the `HouseholdSwitcher` instead
  appears in a slim header above the page content (`sm:hidden`), since it
  isn't part of the bottom bar. There is no standalone "+" in the header
  or sidebar: "Create household" is the last item of the switcher's
  dropdown, below a separator, on phone and desktop (UX-46; it used to be
  a bare "+" that read as "add an item" on every page).
  A long household name (the field allows 60 characters) is clamped (two
  lines on a phone, one on desktop) with the full name in its `title` and in
  the dropdown: the trigger `Button` overrides its base `shrink-0
  whitespace-nowrap`, so the chevron stays on screen at 412 and 1280
  px (UX-47, `e2e/ux-47.spec.ts`).
- **Where you are (UX-27)**: the current page is marked in both layouts
  (`aria-current="page"` plus the active fill). On a phone, What's new and
  the notification centre belong to the "More" menu, so while one is open
  "More" is the highlighted tab (`isMoreMenuActive` in `nav-items.ts`). The
  bottom bar's labels and the notification badge are 12 px (`text-xs`),
  the M9 exception written into DESIGN.md. The collapsed sidebar's
  icon-only controls carry an `aria-label` and a hover/focus Tooltip
  (`components/ui/tooltip.tsx`, Base UI) instead of a `title`, which touch
  never shows; the footer's What's new and notification bell are marked
  active on their own pages like the section links.
- **In between (640 px wide and up, but a tablet or a phone in landscape;
  UX-7)**: these get the desktop shell, so it has to hold at 810×1080 and
  863×393 too. The content column next to the sidebar is `min-w-0`, so a
  wide row wraps instead of widening the page. The sidebar is `h-dvh`; on a
  short screen (the `short:` variant, `max-height: 500px`, defined in
  `globals.css`) the whole aside scrolls and the nav list takes its
  natural height, instead of the nav getting a sliver of inner scroll
  between the household switcher and the footer. The aside pads
  `env(safe-area-inset-left)` (content-box, so `w-56`/`w-16` stay the
  content width) and its footer the bottom inset; `main` pads the right
  inset, and the left one on phones where there's no sidebar. The
  inventory page pins itself to the viewport with an inner-scrolling
  table only under `roomy:` (`lg` wide and at least 600 px tall), where
  that leaves room for more than a row; elsewhere the document scrolls and
  the table header scrolls away with it (the table is wider than the
  column there and keeps its own horizontal scroll, which a sticky header
  can't see past). Its header row stays stacked until `lg`.
  Back-links (`← All shopping lists`, the item catalog's) are
  `inline-flex whitespace-nowrap`, so the arrow stays on the label's line.
- **Overview first screen (UX-26)**: the overview (`src/app/dashboard/page.tsx`)
  leads with today (the Today block, UX-70, then your budget), so the "Get set up" card
  (`src/components/dashboard/getting-started.tsx`) stays short.
  **UX-69**: every step is a row with a chevron and a 14 px description;
  open ones come first, finished (or skipped) ones stay below as ticked
  rows (title only), all under an "N of M done" `progressbar`. The steps are
  household, pantry, shopping list, "Plan this week's meals" (done once the
  household has any meal plan entry) and household budget. There is no
  personal-budget step: the "Your budget" card below is that feature's one
  call to action. When the last step is done the card gives way to a
  one-off "You're all set" mascot moment
  (`src/components/dashboard/getting-started-all-set.tsx`, entrance
  animation `motion-safe:` only), which records the per-browser,
  per-household cookie `getting_started_done_<householdId>` (1 year, via
  `markGettingStartedCelebratedAction`, listed in `cookie-inventory.ts`)
  so it never shows again; it stays until closed or navigated away from.
  Its `X` ("Hide the setup card") hides it for good via
  `dismissGettingStartedAction` (`src/lib/actions/household.ts`), a
  per-browser, per-household cookie (`getting_started_dismissed_<householdId>`,
  1 year, read by `src/lib/getting-started-dismiss.ts`, listed in
  `cookie-inventory.ts`), the same mechanism as the household step's "Skip
  this step". Every step is still reachable from the navigation, so hiding
  loses nothing. The "View …" buttons at the foot of the overview cards use
  `mt-auto` so cards side by side line them up, and their labels wrap rather
  than push the chevron outside the card on narrow (tablet) columns.
  Covered by `e2e/overview.spec.ts`.
- **Overview "Today" block (UX-70)**: the first thing on the overview,
  above the setup card, answers "what needs me now?"
  (`src/components/dashboard/today-block.tsx`, fed by
  `src/app/dashboard/page.tsx`). It replaces the old "Your tasks" card
  (which counted only tasks assigned to you and showed plain text). It
  holds:
  - **Tasks**: the open tasks assigned to you plus the unassigned ones
    (another member's are left out), yours first, oldest first within each
    group, up to 5, then a "N more tasks" link to `/dashboard/tasks`.
    Unassigned ones carry an "Unassigned" hint. Each has a checkbox
    (44 px target on phones) that calls `toggleTaskCompletedAction`
    optimistically: it shows ticked at once and stays in place, struck
    through, so nothing moves under the thumb (also after the save
    revalidates the page and the server list drops it: the block keeps
    ticked rows locally, at their old place); a failed save puts it back
    with a toast, and the "Done" toast offers Undo. A recurring task counts
    as open again once its interval has passed (`isTaskOpen`).
  - **Tonight's dinner**: the household's `DINNER` plan entries for today's
    UTC date (planner dates are UTC midnights), by recipe or free-text
    name; "nothing planned" otherwise. Links to the meal planner.
  - **Household safe to spend**: shown once the household budget has
    categories, as the same number as the budget page's Safe to spend
    (`loadHouseholdSafeToSpend`, `src/lib/household-safe-to-spend.ts`,
    feeding the same `computeSafeToSpend`), in the household's display
    currency and coloured by status. Links to `/dashboard/budget`.
  - **Expiring items**: the count of in-stock items past or within
    `EXPIRY_WARNING_DAYS` of their expiry date (`getExpiryStatus`); the
    row is hidden at 0. Links to `/dashboard/inventory`.
  Covered by `e2e/overview-today.spec.ts` (desktop and mobile; mobile at
  412 x 839 asserts every row is on the first screen) and
  `src/lib/household-safe-to-spend.test.ts`.
- **Public pages (UX-28)**: the token-link pages (join, shared shopping
  list, reset password, verify email, unsubscribe) show every invalid or
  finished state in one `StatusCard` (`src/components/auth/status-card.tsx`):
  brand mark, tinted icon, title, message and a 44 px recovery link.
  `/reset-password/<token>` checks the link first
  (`getUsablePasswordResetEmail`, `src/lib/reset-token.ts`) and shows
  "Link expired" with a link to `/forgot-password` rather than the form;
  `resetPasswordAction` still validates on submit. The live form carries the
  account email as a hidden `autocomplete="username"` input (UX-67) so
  password managers update the right login. The privacy page lists
  cookies as a definition list per entry (a table clipped "Purpose" to a few
  characters on phones). The English-only legal body is `lang="en"` and set
  in `foreground`; "Terms of service" and "Privacy policy" are sentence
  case; signup's button reads "Create your household" like its title; the
  landing hero tightens its padding in `max-height: 500px` (landscape
  phones) so "Get started free" stays on screen. Covered by
  `e2e/public-pages.spec.ts`.
- **Landing page (UX-58)**: `src/app/page.tsx` leads with the product. The
  hero pairs the pitch with `PhonePreview`
  (`src/components/landing/phone-preview.tsx`): a shopping list in a phone
  frame, headed by the BrandBadge, with grouped rows, "Low stock" badges,
  the default list's "Fills itself" badge and a struck-through "Purchased"
  row. It is drawn from tokens and the `landing.preview` strings rather
  than a screenshot, so it follows the locale and theme and can't go
  stale; it's one `role="img"` with a descriptive label and nothing inside
  it is interactive. From `lg` it sits beside the pitch; on a phone it
  follows the buttons, with the hero's top padding and gaps tightened so
  its top half (mascot, list name, first rows) is in the first screen.
  Six feature cards cover pantry, shopping lists (with share links),
  meals (recipes, import, cook mode), tasks (repeating and rotating, plus
  the calendar feed), scanning (barcode, receipt, shelf) and budgets
  (household, splitting, personal), so the grid fills evenly at two and
  three columns; their icon tiles use the `chart-*` tokens. The copy
  claims only what's true: no "example data" (a new household starts
  empty, see UX-136 in BACKLOG.md) and no "less than a minute" (signup
  waits on email verification). Covered by `e2e/landing.spec.ts` (the
  preview at least 40% on screen without scrolling, every feature named,
  no empty grid cell at 1280 px, Swedish preview).
- **404 and invalid-link titles (UX-65)**: `src/app/not-found.tsx` is a
  Server Component that checks the session. A logged-out visitor gets the
  `StatusCard` (brand mark, compass icon, "Page not found") with a "Go to
  Squirrel" link to `/`; a signed-in user keeps the in-app card with "Back
  to dashboard". Copy is in the `notFound` dictionary section. The failed
  states of `/verify-email/<token>` and `/unsubscribe/<token>` are titled
  by outcome ("Link expired" and "Link not valid") instead of the page's
  label. On `/verify-email/<token>` the title follows the cause (UX-142):
  `verifyEmailAction` returns a `code` (`invalid`, `rateLimited`,
  `generic`) next to `error`, and the client takes the title and message
  from the `auth.verifyEmail` dictionary by code, so a rate-limited
  visitor sees "Too many attempts" with a "try again later" message, not
  "Link expired". Covered by `e2e/public-pages.spec.ts` and
  `e2e/item-catalog.spec.ts` (signed-in 404).
- **Signup to first login (UX-61)**: after `/signup` submits, the card is
  titled "Check your inbox" and names the address (or "Account created"
  when the verification email failed to send, with the red warning kept),
  not "Create your household". `SignupForm` renders the whole card so its
  title can follow the step. A good `/verify-email/<token>` link ends on
  "Email verified" with a primary "Log in" button (a signed-in visitor gets
  "Go to dashboard" instead). `verifyEmailAction` returns the account's
  `email`, and `resetPasswordAction` redirects to
  `/login?reset=success&email=…`; `/login` reads `?email=` and pre-fills
  the field (`loginPath()` in `src/lib/login-path.ts` builds the URL). The
  signup card's "Log in" link carries the address too. Covered by
  `e2e/ux-61.spec.ts`. Signing in straight from the link is UX-135.
- `src/app/dashboard/layout.tsx` is the one place that calls
  `getDictionary()`/`getLocale()` for the whole dashboard shell and passes
  `dict`/`locale` down into `Sidebar`, `BottomNav`, and `HouseholdSwitcher`;
  individual dashboard pages fetch their own `dict` for their own content
  (see "Internationalization" on why each Server Component fetches
  independently rather than prop-drilling from one root call).

- **Phone keyboards (DESIGN.md M4)**: every `type="number"` input also sets
  `inputMode`: `decimal` for money and fractional quantities (`step="any"`
  or a cent step), `numeric` for whole counts (portions, servings, calories,
  day-of-month). The last text, number or password field of a form carries
  `enterKeyHint` (`go` for auth and password forms, `done` for dialogs and
  settings forms), so the phone's Enter key submits instead of showing a
  bare return key. Textareas and date inputs are left alone (Enter is a
  newline, dates use the native picker). Auth and profile fields already
  carry `autoComplete` (`email`, `current-password`, `new-password`,
  `name`, `tel`). Covered by `e2e/input-keyboards.spec.ts`.
- **Large titles and a thumb-zone primary action (UX-40, DESIGN.md M2,
  M7)**: every dashboard page sets its H1 through `PageTitle`
  (`src/components/dashboard/page-title.tsx`). On a phone it starts large
  (30 px) and scrolls away with the page; once it has gone above `main`
  (an `IntersectionObserver`, phone shell only), a compact copy is
  portalled over the top bar's household switcher (the empty
  `COMPACT_TITLE_SLOT_ID` slot in `layout.tsx`), so the title stays on
  screen without a second bar. Tapping it ("Back to top") moves focus to
  the H1 and scrolls `main` to the top, which brings the switcher back.
  It fades in via `@starting-style`, with no transition and an instant
  scroll under `prefers-reduced-motion`, and is only in the DOM while
  collapsed. The page's primary action is wrapped in `PrimaryAction`
  (`src/components/dashboard/primary-action.tsx`): on a phone it floats
  bottom right, 0.75rem above the bottom bar and the safe area, as a
  48 px pill (a long label wraps within the screen at 200% text); from
  `sm` it stays in the header where it was. The first-visit cookie notice
  (a slim strip on phones, UX-57: the dashboard reserves its height via
  `--cookie-notice-h`, so the button rides above it, and public pages pad
  the body by `--cookie-notice-space`, which is not published over
  `/dashboard` (the shell scrolls inside itself, so the document must not
  grow); both are set by `CookieNotice` and removed on dismissal, covered by `cookie-notice-room.mobile.spec.ts`)
  still shares the bottom edge, so e2e specs that tap a primary action on
  a phone call `dismissCookieNotice` first, and `expectTargetsApart`
  doesn't pair the floating button with the content scrolling under it.
  Used for
  "Add item" (inventory), "Add task", "New list" (shopping lists), "Add
  transaction" (household budget) and "Invite member"; secondary actions
  (the inventory ⋯ menu, "Register receipt") stay in the header. `main`
  adds 4.5rem to its bottom padding while it `has-[[data-primary-action]]`,
  so the last row scrolls out from under the button. Pages without a
  page-level primary action (meal planning, personal budget, profile, …)
  only get the large title, and so does the shopping list detail page,
  whose bottom slot belongs to shopping mode's Next up dock (UX-37), so it
  has no floating button. Covered by `e2e/large-title.spec.ts`.
- **Wide lists on phones (UX-139, DESIGN.md "Spacing, radius and
  layout")**: below `sm`, every list, card and card-like panel on a
  dashboard page reaches to 6px from each screen edge instead of sitting
  in `main`'s 16px gutter, which gives each row ~20px more for names.
  Headings, labels and running text stay on the gutter. The `list-bleed`
  utility (`src/app/globals.css`) sets negative side margins of
  `max(6px, inset) - max(16px, inset)`, so a landscape notch's safe area
  still wins. A rule in the same file gives it to every top-level `Card`
  inside the dashboard's `main` (`data-app-main`), except nested cards,
  `w-full` cards and grid cells. Lists, hand-built panels, card grids and
  the list-shaped loading skeletons carry the class themselves.
  `e2e/ux-139.spec.ts` checks the edges on the shopping list, inventory
  and budget, and that two stat tiles in one row don't overlap.
- **One primary action per view (UX-24, DESIGN.md Hierarchy)**: only the
  page's main call to action is a solid `default` Button. Profile's four
  save buttons (display name, Swish number, email, password) are `secondary`
  until their form differs from what is saved (`useFormDirty`,
  `src/components/shared/use-form-dirty.ts`). On Household, "Invite member"
  is the primary; "Add note" and "Turn on calendar feed" are `secondary`,
  and the role badge is `secondary` for the owner and `outline` for members.
  Each possible-duplicates group's "Merge" is `secondary`.
- **Back closes dialogs (UX-11, DESIGN.md M7)**: every `Dialog`
  (`src/components/ui/dialog.tsx`, so `ConfirmDialog` and every sheet
  too) pushes a same-URL history entry while it's open, so Android's back
  button, a back swipe or the browser's back closes the sheet instead of
  leaving the page and losing the form. Closing it from the UI (X,
  Cancel, Escape, a submit) calls `history.back()` when its entry is still
  the current one, so no extra back step is left behind. The mechanics
  are in `src/components/ui/dialog-history.ts`: one `popstate`
  listener, added before the router's own (the root layout renders
  `DialogHistoryListener` so the module loads with every page), keeps the stack of open dialogs (a back closes only
  the top one), stops Next.js's router from seeing a pop that stays on the
  same URL, keeps its marker through the router's same-URL state
  replaces, and steps forward again if the app navigated (e.g. the merge
  dialog's `router.replace`) before its own `back()` landed. A dialog
  whose owner refuses to close (one that stays open while saving) gets a
  fresh entry. A dialog that opens while another's own `back()` is still on
  its way (a sheet handing over to its confirm) waits for that back to land
  before pushing its entry; pushing sooner made the back land below both
  entries and the repairing `forward()` pop the new dialog (MAINT-23).
  `DialogHeader` has `pr-10` so a long title stays clear of
  the close button. Covered by `e2e/back-closes-dialogs.spec.ts` and
  `dialog-history.test.ts`.
- **Bottom sheets stay reachable (UX-12, DESIGN.md M2)**: on phones
  `DialogFooter` is `sticky bottom-0`, so Save stays in the thumb zone in
  a long form (the recipe form, add/edit item, receipts) instead of
  scrolling out of view, and it swaps the translucent desktop strip for
  opaque `bg-popover` so scrolled content doesn't show through. The
  sheet itself rides above the keyboard two ways: Android gets
  `viewport.interactiveWidget: "resizes-content"` in
  `src/app/layout.tsx` (the layout viewport shrinks above the keyboard),
  and iOS — which ignores that key — gets `useKeyboardInset`
  (`src/components/ui/keyboard-inset.ts`), which writes the
  `visualViewport` gap to `--kb-inset` while a dialog is open and
  `DialogContent` lifts its `bottom` by it. Gaps under 150px read as
  closed (animation transients, rounding, browser toolbars — never a
  keyboard), and window `resize`/`orientationchange`/`focusout` recompute
  the value so a missed keyboard-close event self-heals instead of leaving
  the sheet lifted. The footer's stick offset negates its full-bleed
  negative margin (`position: sticky` constrains the margin box), so the
  footer sits exactly at the sheet bottom instead of that margin above it.
  Covered by `e2e/sheet-keyboard.mobile.spec.ts`,
  `e2e/sheet-footer.mobile.spec.ts` and `keyboard-inset.test.ts`.
- **Native-grade bottom sheets (UX-34, DESIGN.md M2/M7)**: every `Dialog`
  is a Base UI **Drawer** (`src/components/ui/dialog.tsx`; Drawer is
  Dialog plus gestures, sharing its Title/Description/Close, focus trap and
  dismissal), so Base UI's own pointer handling does the work instead of a
  hand-written one:
  - **Drag to dismiss** on phones: the sheet follows a touch drag from the
    grabber pill, the header or anywhere in its body once the body is
    scrolled to the top. A flick (velocity) or a pull past half the sheet
    dismisses; anything less springs back. Pulling up past the top
    rubber-bands. The backdrop fades with the drag. A dismissing drag
    closes through `onOpenChange` like the X does, so the UX-11 history
    entry goes with it. From `sm` the centred modal doesn't drag
    (`data-base-ui-swipe-ignore`). The X, Escape and back still close.
  - **Snap points for long forms**: `<Dialog longForm>` (the recipe form,
    add/edit inventory item) gets half and full snap points on phones. It
    opens full; a drag down rests at half (to peek at the page behind) and
    a further drag dismisses. At half, the sticky footer is lifted by the
    snap offset (`--drawer-snap-point-offset`, copied to an inheriting `--sheet-snap-offset` since Base UI registers its own with `inherits: false`), so Save stays on screen.
    The grabber of a long form is a button ("Collapse sheet" / "Expand
    sheet") that does the same, so the gesture isn't the only way (M7).
  - **Background scale-down**: `SheetIndent`
    (`src/components/ui/sheet-indent.tsx`, wrapping the page in the root
    layout) shrinks the page to 94%, drops it below the status bar and
    rounds its top corners over a black ground while any sheet is open,
    growing back as the sheet is dragged down. Phones only. The wrapper has
    no transform at rest, so it never becomes the fixed bottom bar's
    containing block.
  - **Focus without the keyboard**: a touch open focuses the sheet itself
    (screen readers read its title; the first swipe or Tab reaches the
    first field), so the on-screen keyboard doesn't pop over the sheet
    before it's read. A mouse or keyboard open focuses the first field, or
    the field the dialog's `initialFocus` names. An open with no pointer of
    its own (a menu item, a handle) counts as touch on a coarse-pointer
    device (`sheet-focus.ts`).
  - The sheet is a grabber row above a scrolling body
    (`data-slot="dialog-body"`), the only scroller in the dialog.
  - Under `prefers-reduced-motion` the sheet jumps to rest instead of
    animating and the page behind doesn't scale.

  Covered by `e2e/native-sheets.spec.ts` and `sheet-focus.test.ts`.

## Releases & What's new

Every change reaches `master` through a pull request, and every release
bumps the app's version and adds a user-facing note. Nobody edits the
version or the notes by hand.

- **Release train.** Feature PRs target `next`, the default branch, and
  are squash-merged there without releasing. To ship, a `release/<date>`
  branch is cut from `next` (the autopilot reviewer's daily run, or the
  **Cut release** workflow) and merged into `master` through one release
  PR, with a merge commit. That PR is the only place the e2e suite runs on
  GitHub, so a day's PRs share one browser run instead of one each (plus
  a re-run every time a branch was brought up to date with `master`, the
  previous flow that used up the Actions minutes in October 2026).
  `release.yml` reads the shipped PRs from the merge commit's second
  parent (`scripts/release.ts train-prs`, which picks the "(#N)" out of
  each squash commit's subject, and asks GitHub by SHA for any commit
  without one, failing the run if it can't), takes the biggest bump among their titles
  and joins their release notes, oldest first, into one entry. A PR with
  no Swedish note would contribute its English one to the Swedish text,
  which is why the preview check now requires both (below). Then it
  merges `master` back into `next`. A hotfix PR straight into `master`
  still releases on its own, as below.
- **CI tiers** (`.github/workflows/ci.yml`): PRs into `next` run lint,
  typecheck, unit tests and build; PRs into `master` swap the build for
  the e2e job, which builds once itself. Draft PRs skip e2e. Docs-only
  PRs (`*.md`, `docs/`, `.claude/`, `.agents/`) skip both, and a skipped
  job counts as passing for the required checks. A new push cancels the
  PR's running workflow, and nothing runs on push, since every commit
  reaching `next` or `master` was already checked on its PR. The
  Playwright browsers and `.next/cache` are cached between runs.

- **PR title = release type.** Titles follow Conventional Commits
  (`type(scope)!: description`). `feat` → minor, `fix`/`perf`/`revert` →
  patch, any type with `!` → major. `refactor`, `docs`, `test`, `ci`,
  `chore`, `build` and `style` merge without a release. PRs are
  squash-merged into `next`, so the title is also the commit message
  there, which is how the release train finds each PR again.
- **PR body = release note.** `.github/pull_request_template.md` has a
  "Release note" section with `### English` and `### Svenska` headings. An
  empty English note falls back to the title's description. An empty
  Swedish note is stored as `null` and the app shows the English one.
  Neither should happen any more: a releasing (`feat`/`fix`/`perf`) PR
  fails the Release preview check until both sections are written
  (`missingReleaseNotes`), because v0.77.0 shipped an English paragraph
  in its Swedish note from a PR that wrote neither. That paragraph was
  translated in `releases.json` afterwards, the one hand edit to the
  notes.
  Each note runs to the next heading or `---` rule, so the attribution
  footer after a PR body's closing `---` never ships as part of the
  Swedish note (BUG-4).
- **Before merge**: `.github/workflows/release-preview.yml` fails the check
  on an invalid title and keeps one PR comment up to date with the exact
  note users will see: on a PR into `next`, the bump it adds to the next
  release; on the release PR, every PR it ships with the version and the
  combined note (its own title isn't checked); on a hotfix, its version.
- **After merge** into `master`: `.github/workflows/release.yml` runs
  `scripts/release.ts apply` on the latest `master`. That bumps
  `package.json`/`package-lock.json`, prepends an entry to
  `src/lib/release-notes/releases.json`, commits
  `chore(release): vX.Y.Z [skip ci]`, tags `vX.Y.Z` and creates a GitHub
  Release. The bump happens after merge, not inside the PR, because
  bumping in each PR would make every pair of open PRs conflict on the
  version line. Concurrent merges retry from the newest `master` instead
  of using a concurrency group, which would cancel queued runs.
- **While GitHub Actions was paused** (`ci_gate: local`, 2026-09-26 to
  2026-10-04, see AUTOPILOT.md) `release.yml` couldn't run, so each
  releasing PR ran the same `scripts/release.ts apply` itself as its last
  commit before merge. Those versions have no git tag or GitHub Release
  yet; BACKLOG.md's INFRA-6 lists them for a backfill. v0.39.9 to
  v0.42.0 (#81, #92, #91, #94) were merged before that stopgap existed
  and were cut together in #93 alongside its own v0.42.1. Actions came
  back while the stopgap was still in force, so #135, #134 and #140 were
  each released twice: an in-PR version (v0.47.5, v0.47.7, v0.48.3)
  and a workflow one (v0.47.6, v0.47.8, v0.48.4). Only the workflow
  versions are tagged, and the in-PR ones aren't backfilled, since that
  would publish a second Release for the same PR. Releases are back to
  after-merge only. The stopgap was used once more, 2026-10-12 to
  2026-10-13, when the Actions minutes ran out (v0.58.0 to v0.61.0, also
  in INFRA-6). Making the repository public ended it: public
  repositories get GitHub's standard runners free.
- The pure logic (title parsing, bump, note extraction) lives in
  `src/lib/release-notes/release-calc.ts` with tests. It has no imports
  because `scripts/release.ts` runs it under Node's built-in type stripping
  without `npm ci`, which is also why `tsconfig.json` sets
  `allowImportingTsExtensions`.

**In the app**: `releases.json` is bundled into the build, so the notes
always match the deployed code with no DB table or GitHub API call.
`src/lib/release-notes/index.ts` exposes `RELEASES`, `CURRENT_VERSION` and
the locale fallback.

- `/dashboard/whats-new` lists every release, newest first, with version,
  date and the note in the user's locale. A note wraps at any width
  (`break-words`), so a URL or long Swedish compound in it can't push the
  page sideways on a phone (BUG-4).
- The desktop sidebar footer has a "What's new · vX.Y.Z" link, and the
  mobile "More" menu has the same item. Both show a dot while the newest
  release is unseen. Opening the page writes the `last_seen_release`
  cookie (preference, 1 year) and refreshes the layout to clear the dot.
  Signing up writes the same cookie with the current version (UX-74), so a
  brand-new account starts caught up and its first dashboard shows no dot.
- Profile has an "About Squirrel" disclosure with the version and a link to
  the page (see "Profile sections" below).
- **Public**: `/whats-new` shows the same list (`ReleaseList`,
  `src/components/whats-new/release-list.tsx`, shared with the dashboard
  page) to anyone, logged in or not, like `/privacy`, under "The latest
  version is X.Y.Z." It never writes `last_seen_release`: that cookie only
  clears a member's unread dot. Every page with the public footer
  (`LegalFooter`: landing, login, signup, join and the token pages) links
  to it as "What's new · vX.Y.Z", so a visitor sees which version they're
  looking at and that the app is being worked on. Covered by
  `e2e/whats-new-public.spec.ts`.

**Profile sections (UX-76)**: `/dashboard/profile` is four sections, each an
`h2` region, instead of eleven loose cards: **Account** (display name,
email and password as one card with a divider between the three forms, each
keeping its own Save), **Preferences** (the Language and
Appearance controls of UX-51, then the Swish number), **Notifications** (push, weekly
digest, install app) and **Data & privacy** (Export my data; the "About
Squirrel" version and "Danger zone" account deletion behind native
`<details>` disclosures, `ProfileDisclosure`). "Log out" (the same
`LogoutButton` as `no-household`, so the push subscription is dropped
first, SEC-5) is the last element. One column on phones; from `lg` up
the sections sit in two columns, row by row, so the DOM order is the phone
order. The display-name card no longer repeats "Display name" as its own
heading. `e2e/ux-76.spec.ts` covers it.

## Notification center

A bell icon in the nav (desktop sidebar, mobile bottom nav's "More" menu —
see "Navigation & responsive layout" above) opens a panel of **persisted**
alerts for the active household, backed by a `Notification` table
(`prisma/schema.prisma`). This replaced an earlier fully live-computed
design (no table at all, alerts re-derived from scratch on every render) —
that design couldn't distinguish "this item happens to be at zero right
now" from "this item just ran out," and had no way to dismiss anything.
The current model fires an alert once, at the moment a specific trigger
happens, and it stays until a user dismisses it.

Exactly six triggers exist — nothing else creates a notification:

- **Out of stock**: an existing `InventoryItem`'s quantity crossing from
  `> 0` to `<= 0`. `recordOutOfStockTransition` (`src/lib/notifications.ts`)
  is called, with the item's before/after quantity, from every Server Action
  that can *decrease* an already-existing item's quantity —
  `adjustQuantityAction`, `markItemEmptyAction`, `updateInventoryItemAction`,
  `bulkUpdateFieldAction` (when editing the `quantity` field),
  `markMealEntryCookedAction` (per ingredient, inside its `$transaction`),
  and `togglePurchasedAction`/`toggleItemViaShareTokenAction` (un-marking a
  shopping-list item that was already put away puts its quantity back
  down). It only fires on the crossing itself — a
  further decrease while already at zero, or a decrease that doesn't reach
  zero, is a no-op — and it's deduped against any already-active
  (undismissed) alert for the same item. Nor does it fire while the item
  is ticked off a shopping list but not put away yet (incoming stock, see
  "Put away" under the data model): the last carton running out at home
  while two more are in the car isn't news. Every one of these call sites
  also runs AUTO-8's `addToDefaultListOnLowStock`, which fires one step
  earlier (into *low*) and adds to the default list rather than alerting —
  see "Always-on default list (AUTO-8)".
  - **Deliberately never fires on item creation.** `createInventoryItemAction`,
    `quickAddInventoryItemAction`, `addStarterKitItemsAction`, every
    find-or-create-linking path (meal-planning ingredients and shopping-list
    items), and `createInventoryItemFromShoppingListItemAction` all can
    create a brand-new `InventoryItem` at quantity 0 (e.g. an ingredient
    auto-linked the moment a recipe is saved, or a manually added item left
    at its default) — none of them call `recordOutOfStockTransition`. A new
    item starting empty is not a depletion event, and flagging it would just
    be noise every time someone adds a recipe or a pantry item.
- **Meal not logged**: a past `MealPlanEntry` whose `consumedAt` is still
  null — a nudge that "mark as cooked" was probably forgotten. Synced by
  `syncMealNotLoggedNotifications` (`src/lib/notifications.ts`), which finds
  entries with `date` before today, `consumedAt: null`, and no `Notification`
  row yet, and creates one for each. The `Notification.mealPlanEntryId`
  unique constraint makes this fire **at most once per entry, ever** — once
  created, dismissed or not, it's never recreated, so ignoring it doesn't
  turn it into a repeating nag.
- **Expiring soon**: an in-stock `InventoryItem` (`quantity > 0`) with
  `expiresAt` set, within `EXPIRY_WARNING_DAYS` (3) of that date or already
  past it. Synced by `syncExpiringSoonNotifications`, which finds qualifying
  items and creates an `EXPIRING_SOON` `Notification` for each. Deduped like
  out-of-stock (an application-level check for an existing undismissed alert
  for the same item), not a DB unique constraint like meal-not-logged — a
  unique constraint on `inventoryItemId` would permanently block a future
  alert for an item that gets re-stocked with a new expiry date after the
  old alert was dismissed. Includes items whose `expiresAt` is AUTO-7's
  estimate, not just a real date — the bell and push copy soften to
  "probably" for those (`ExpiringSoonNotification.estimated`) rather than
  skipping them.
  - **Runs on a schedule, not on read**: both syncs above used to run
    inline inside `getActiveNotifications` on every notification-bell fetch
    — meaning opening the bell could trigger an unbounded number of
    `Notification` writes and push sends on what should've been a pure
    read. They now run only from `GET /api/cron/sync-notifications`
    (`src/app/api/cron/sync-notifications/route.ts`), which iterates every
    household (`prisma.household.findMany`) and calls both sync functions
    for each; something external must hit this route on a schedule (see
    DEPLOYMENT.md's "Scheduled jobs" section for the Vercel/Railway/Render
    setup). It's protected by a `CRON_SECRET`-checked bearer token, since
    unlike `/api/health` it both writes data and sends push notifications;
    an unset `CRON_SECRET` fails closed (every run is a logged `401`), so it
    must be configured in production before the route is deployed. The
    check compares in constant time
    (`src/lib/timing-safe-equal.ts`'s `timingSafeStringEqual`, shared with
    `/api/cron/weekly-digest` and `digest-unsubscribe-token.ts`) rather than
    `!==`, so a wrong guess can't be narrowed down from response timing.
    `getActiveNotifications` itself is now a pure read (`prisma.notification.findMany`
    only) with no side effects. **User-facing effect:** a new
    meal-not-logged or expiring-soon notification now appears with a delay
    of up to the cron interval (up to 24 hours on Vercel Hobby's daily
    schedule, 15 minutes on the suggested Railway/Render schedule), rather
    than instantly the next time someone opens the bell. Out-of-stock and
    list-cleared alerts are unaffected: they're still created synchronously
    by the action that causes them.
  - **Failure isolation and bounded concurrency**: households are synced
    ten at a time (`BATCH_SIZE`), not all at once, so in-flight queries
    don't grow with the household count and exhaust the Prisma pool. Each
    household's two syncs, and the households within a batch, are settled
    independently (`Promise.allSettled`), so one failing household (or one
    failing sync within it) never stops the others, and the route never
    responds while any sync is still in flight. Each failure is logged with
    its household id. The response is always `200` once the household list
    was read, with `{ status: "ok" | "partial_failure", householdsSynced,
    householdsFailed, failedHouseholdIds }`; only a failure to list
    households returns `500 { status: "error" }`. Error details never go in
    the response body.
- **Put away your shopping**: ticked shopping-list rows that were never put
  away (`ON_PUT_AWAY` mode), a few hours after the trip. Synced by
  `syncPutAwayReminders` from the same `/api/cron/sync-notifications` run
  as the two syncs above (a third `allSettled` entry per household), so the
  same delay applies: `PUT_AWAY_REMINDER_DELAY_HOURS` (3) is the earliest
  it can go out, and on Vercel Hobby's daily 06:00 UTC run it lands the
  next morning. Which lists qualify is the pure, unit-tested
  `selectPutAwayReminders` (`src/lib/shopping/put-away-calc.ts`): a
  waiting row ticked at least 3 hours ago, within `INCOMING_MAX_AGE_DAYS`,
  and *after* the list's `ShoppingList.putAwayRemindedAt`, where a row is
  dated like incoming stock (its tick, else when a receipt priced it). That last rule
  is what makes it at most once per list per trip — the default list lives
  across many trips, so a flag that stayed set would silence every later
  one, while no flag would nag on every run. A receipt-priced row nobody
  ticked goes to whoever applied the receipt. The trip is claimed with an
  `updateMany` that only matches while `putAwayRemindedAt` still holds the
  value the run read, so overlapping runs can't both send. A
  `PUT_AWAY_REMINDER` bell row (linked to the list, deduped against an
  undismissed one) is filed, and the push ("Put away your shopping? N
  items from Next shop") goes to whoever ticked the triggering rows
  (`ShoppingListItem.checkedOffByUserId`, via
  `sendPushToHouseholdMembers` in `src/lib/push.ts`, still scoped to
  current members and quiet hours) — or the whole household when any was
  ticked from a share link. Both link to the list with `?putAway=1`, which
  opens the put-away dialog. `putAwayItemsAction` dismisses the bell row
  once nothing on the list is waiting.
- **List cleared** (good news): a `ShoppingList`'s unpurchased item count
  crossing from >0 to 0 — `recordListClearedTransition`, called from
  `togglePurchasedAction`/`deleteShoppingListItemAction` and their
  share-link equivalents. Links to that list.
- **Price jump** (GAP-9): a price just recorded in `PriceHistory` that's
  materially above what the household usually pays for that item. Every
  price-competitor app surfaces this; Squirrel already had the data but
  never looked back at it. It's a bell alert rather than an in-list chip
  because it's a "something's actually wrong" case (a price-tag error, a
  store quietly raising a price) worth interrupting for.
  - **Where it fires**: `recordPriceSpikes` (`src/lib/notifications.ts`) is
    called by every action that writes `PriceHistory` —
    `togglePurchasedAction` (checking an item off with a price in
    `ON_CHECK` mode, including one the user just corrected by hand),
    `toggleItemViaShareTokenAction`, `putAwayItemsAction`,
    `applyReceiptScanAction` and `registerReceiptAction` — with every row
    that action wrote, **after** its transaction commits. After, so a
    rolled-back purchase never leaves an alert behind and the comparison
    reads committed history; as one batch, because receipt scans write
    their rows in parallel and a per-row check-then-create could let two
    lines for the same item both pass the dedupe. It never throws — the
    prices are already saved, so a failure is logged and swallowed. The
    whole check (its three queries plus the push) is scheduled with
    `after()` (`next/server`, PERF-9), so the check-off response doesn't wait
    on it and the invocation still stays alive until it finishes. That makes
    `recordPriceSpikes` a synchronous scheduler returning `void`: callers
    don't `await` it.
  - **What "materially above" means** — the pure, unit-tested
    `detectPriceSpike` (`src/lib/price-spike.ts`), every constant exported
    from there:
    - **Per unit, like for like.** `PriceHistory.price` is a line total, so
      buying two packs doubles it without the price moving. Every price is
      divided by its line's `quantity`, and prior rows only count when their
      `unit` matches the new line's (case/whitespace-insensitive) or
      converts into it via `src/lib/units.ts` (500 g vs 1 kg). This is why
      GAP-9 added `PriceHistory.quantity`/`unit` (migration
      `price_spike_notifications`, all four writers fill them in). Rows from
      before that have neither and are ignored, so an item only becomes
      eligible after 3 comparable purchases recorded since the migration —
      a deliberate trade for never guessing a pack size.
    - **Baseline**: the median of the item's most recent 10 comparable
      prior prices (`PRICE_SPIKE_TRAILING_WINDOW`) from the last 365 days
      (`PRICE_SPIKE_MAX_AGE_DAYS`), needing at least 3
      (`PRICE_SPIKE_MIN_PRIOR_PRICES`). The median so one past sale or
      spike doesn't drag it; the window and age cap so a price that has
      risen and stayed up becomes the new normal, and year-old prices don't
      turn ordinary inflation into an alert.
    - **Relative AND absolute**: the new unit price must be ≥ 1.25× the
      median (`PRICE_SPIKE_MIN_RATIO`) *and* the extra cost on this
      purchase — (unit price − median) × quantity — must be ≥ 10 in the
      base currency (`PRICE_SPIKE_MIN_EXTRA_COST`, SEK). The ratio alone
      would fire on a 10 kr item going to 13 kr; the floor alone on normal
      variance of an expensive item. Measuring the floor in money on this
      purchase rather than per unit keeps it meaningful for per-gram units.
    - **One decision per item per action**: several lines for the same item
      in one receipt (a duplicate line, a discount line) are pooled into one
      purchase (total price ÷ total quantity), so they yield at most one
      alert, and a discount pulls the effective price down the way it did
      at the till.
  - **Dedupe**: no new alert for an item with an undismissed `PRICE_SPIKE`,
    or with *any* `PRICE_SPIKE` created in the last 14 days
    (`PRICE_SPIKE_COOLDOWN_DAYS`), dismissed or not. Un-checking and
    re-checking the same purchase writes a second `PriceHistory` row at the
    same price; without the cooldown, dismissing the first alert would
    just invite an identical second one.
  - **Display**: the rounded percentage is stored on the row
    (`Notification.priceIncreasePercent`, set only for this kind) so the
    bell reads "Milk cost 40% more than usual" without re-deriving the
    median on every read. It links to the cost analyzer
    (`/dashboard/budget?tab=insights`), where the item's price trend and
    per-store comparison give the context to judge it, and uses a
    `TrendingUp` icon. The push (English, like every other push) says the
    same and excludes the acting user, per the rule above; quiet hours
    apply as for every push (`sendPushToHousehold`). A share-link visitor
    has no account, so a jump they record pushes every member. There are
    no per-kind notification settings to respect — none exist for any
    kind.
- All of these triggers are intentionally narrow. The old design's "low stock" alert
  (anything at or below its threshold, not just at zero) and "meal-plan gap"
  alert (an upcoming day with nothing planned) are gone — neither is a
  concrete, one-time event, so under the current model neither fits.

**Dismissal is the only way an alert clears.** Unlike the old design, a
notification does *not* disappear on its own when the underlying condition
resolves (e.g. restocking an out-of-stock item) — clicking it is what
clears it. Clicking a notification in the bell (`notification-bell.tsx`,
a Client Component) calls `dismissNotificationAction`
(`src/lib/actions/notifications.ts`) to set `dismissedAt`, then lets the
entry's own `Link` navigate as before. `dismissNotificationAction` scopes
its `updateMany` to the caller's household and an undismissed row, so a
stale id or a double-click is a harmless no-op, and calls
`revalidatePath("/dashboard")` so the bell's count reflects the dismissal
immediately even when the click doesn't leave the current page (e.g.
dismissing a second out-of-stock alert while already on
`/dashboard/inventory?status=out`).

- **Where it's computed**: `src/app/dashboard/layout.tsx` — the one place
  that already calls `getDictionary()`/`getLocale()` for the whole dashboard
  shell — also calls `getActiveNotifications(household.id)` once per request
  (a pure read, no syncing — see above) and passes the resulting list down
  into both `Sidebar` and `BottomNav` as a `notifications` prop, the same
  pattern used for `dict`/`locale`.
- **UI**: `src/components/notifications/notification-bell.tsx` exports two
  presentational shapes sharing one alert-list renderer: `NotificationBell`
  (a standalone `DropdownMenu` for the sidebar, styled like the theme/language
  toggle buttons it sits alongside) and `NotificationMenuItem` (a
  `DropdownMenuSub` nested inside the bottom nav's existing "More" dropdown,
  at the same tier as the theme/language toggle items there). Both show a
  small red count badge (`NotificationCountBadge`) on the bell icon when
  there's at least one alert; the mobile "More" trigger also shows the same
  badge on its `MoreHorizontal` icon so the count is visible without opening
  the menu. An empty list shows a "You're all caught up!" message instead of
  an empty panel.
- **Clicking an alert navigates**: an out-of-stock alert links to
  `/dashboard/inventory?status=out`; a meal-not-logged alert links to
  `/dashboard/meal-planning?week={weekStartKey}` (the week containing that
  entry's date), reusing that page's existing `?week=` param; a price-jump
  alert links to `/dashboard/budget?tab=insights` (the cost analyzer). The inventory
  page/`InventoryClient` reads an `initialStatus` prop from the `status`
  search param (`src/app/dashboard/inventory/page.tsx`) so the status filter
  can be preset on navigation.

**History page**: `/dashboard/notifications` (linked from a "View all
notifications" footer row at the bottom of both the sidebar dropdown and the
mobile "More" submenu, below a separator) shows every notification the
household has ever received, dismissed or not — the same rows the
`Notification` table already keeps (`dismissedAt` marks a row read rather
than deleting it), just never queried without that filter until now.
`getNotificationHistory` (`src/lib/notifications.ts`) fetches up to 200 rows
regardless of `dismissedAt` and maps them through the same row→item logic
`getActiveNotifications` uses (extracted into `toNotificationItem`), plus
each row's `createdAt`/`dismissedAt`. It doesn't sync the meal-not-logged/
expiring-soon triggers itself — neither does anything else on the read
path anymore; that's `/api/cron/sync-notifications`' job (see above).
`NotificationsHistory` (`src/components/notifications/notifications-history.tsx`,
a Client Component) renders the list — an unread (undismissed) row gets a
tinted background and a small dot, reusing the bell's own
href/label/icon mapping so a given notification reads identically in both
places — and a "Mark all as read" button that calls
`dismissAllNotificationsAction` (`src/lib/actions/notifications.ts`), a
household-scoped `updateMany` sibling to `dismissNotificationAction` that
clears every currently-active alert in one go. Clicking an individual
still-unread row dismisses just that one (same as the bell) before letting
the link navigate; an already-read row is just a link. With no rows at all
(UX-3) the page says "No notifications yet." plus one sentence naming what
produces one (an item running out of stock, or about to expire), so a new
household doesn't read the empty page as broken. Only triggers from the
list above are named, so it never promises task or invite notifications.

## PWA install & push notifications

Two independent, opt-in cards on `/dashboard/profile`, both following
`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`'s
patterns (per AGENTS.md's instruction to read this build's own docs rather
than trust training data). `src/app/manifest.ts` is the app's manifest
(name "Squirrel", `display: "standalone"`, theme/background colors, and
192/512/512-maskable icons).

- **Install** (`InstallAppCard`, `src/components/profile/install-app-card.tsx`,
  following the guide's "InstallPrompt" example): a three-state card —
  already installed (`display-mode: standalone` matched) shows a static
  "installed" message; iOS (Safari has no `beforeinstallprompt` event) shows
  manual add-to-home-screen instructions instead of a button; everywhere
  else shows a real install button once the browser fires
  `beforeinstallprompt` (captured and replayed via `prompt()`), or generic
  fallback copy before/if it never does. iOS detection covers desktop-mode
  iPadOS too (UX-29): since iPadOS 13 an iPad reports a Mac UA by default,
  so `isAppleMobile` (`src/lib/platform.ts`, unit-tested) also accepts
  `platform === "MacIntel" && maxTouchPoints > 1`. The standalone-mode and iOS checks
  are both read via `useSyncExternalStore` rather than `useState`+`useEffect`,
  since they're browser-only values that would otherwise mismatch between
  the server-rendered HTML and the client's first hydration pass.
- **Push notifications** (`PushNotificationsCard`,
  `src/components/profile/push-notifications-card.tsx`): a subscribe/
  unsubscribe toggle for real device/OS push, on top of the in-app bell
  above — not a replacement for it. Subscribing registers
  `src/lib/service-worker.js` (`navigator.serviceWorker.register(new URL(...,
  import.meta.url), { scope: "/", updateViaCache: "none" })`, which Next
  bundles as a hashed, same-origin static asset with automatic cache-busting
  on every build) and calls `pushManager.subscribe()` with the
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` application server key, then persists the
  resulting endpoint/keys via `subscribeToPushAction`
  (`src/lib/actions/push.ts`) into the `PushSubscription` table — **scoped
  to the user, not the household**, since a subscription belongs to one
  browser and a user can belong to multiple households.
  `subscribeToPushAction` upserts by `endpoint` (re-subscribing the same
  browser, e.g. after clearing its permission, just refreshes the keys
  rather than hitting the unique constraint); `unsubscribeFromPushAction`
  deletes scoped to `{ endpoint, userId }`, so a stale or foreign endpoint
  is a harmless no-op. Without `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY` set (see `.env.example`), the card just reports the
  feature unavailable and every server-side send is a silent no-op — same
  fails-gracefully pattern as `RESEND_API_KEY` in `src/lib/email.ts`.
  - **Input validation (SEC-3)**: `subscribeToPushAction` is the only place
    an `endpoint`/keys pair enters the database, and `sendPushToHousehold`
    later POSTs to that endpoint verbatim, so a Zod schema in
    `src/lib/actions/push.ts` rejects anything that isn't a real browser's
    Push API response before it's stored — a client-supplied endpoint that
    isn't validated is a blind SSRF vector into this server's own network.
    The endpoint must be an `https:` URL, ≤1024 characters, whose host
    matches (by suffix, never by substring) one of the actual push
    services' delivery hosts: a subdomain of `googleapis.com`
    (`fcm.googleapis.com`, Chrome/Edge) or of `google.com` — Chrome has been
    observed handing out endpoints on `jmtNN.google.com` too, and since
    Google doesn't publish that host as fixed the way the others below do,
    the whole of `google.com` is allowlisted rather than a regex on one
    seen-in-the-wild shape; it's Google's own public multi-tenant edge, so
    this is broader than the other entries without reopening the
    internal-network SSRF this list exists to block — a subdomain of
    `push.services.mozilla.com` (Firefox), a subdomain of
    `notify.windows.com` (legacy Edge/WNS), or a subdomain of
    `push.apple.com` (Safari, including `web.push.apple.com`). `keys.p256dh`
    and `keys.auth` must each decode (as base64url, padding tolerated) to
    exactly 65 and 16 bytes — the fixed sizes the Web Push protocol defines
    for the ECDH public key and auth secret. A subscription that fails
    validation throws, which the card's existing subscribe try/catch
    already surfaces as a generic error.
  - **Per-user cap (SEC-3)**: `subscribeToPushAction` caps a user at 10
    stored subscriptions. The cap is only checked when the endpoint is
    brand new (an update to an already-stored endpoint never grows the
    count); at the cap, the **oldest** row is evicted rather than the
    subscribe being rejected — someone hitting the cap is almost always a
    PWA reinstalled often (each install is a new endpoint), and the oldest
    row is the one most likely already dead, so evicting it is friendlier
    than leaving the device in front of them unable to get push. Both the
    existence check and the eviction run inside the same `$transaction` as
    the upsert, so concurrent subscribes from the same user can't both
    slip past the count.
  - **Stale browser subscriptions (SEC-14)**: `pushManager.getSubscription()`
    only proves the *browser* still holds a subscription. A password
    reset/change (SEC-5) deletes the user's `PushSubscription` rows, but
    every other signed-in device keeps its browser-side subscription, which
    then receives nothing. The card therefore reconciles the browser's
    endpoint against the `subscriptions` rows the profile page loads
    (`resolveSubscriptionState`, `src/lib/push-subscription-state.ts`): no
    matching row shows "Unsubscribed" with the Enable button, and one tap
    re-subscribes (the browser hands back its existing subscription and
    `subscribeToPushAction` upserts the row). It doesn't silently recreate
    the row, since the reset deliberately revoked push. A subscription this
    card saved itself counts as confirmed until the refreshed rows arrive.
  - **Delivery**: `sendPushToHousehold` (`src/lib/push.ts`) fans a payload
    out to every push subscription belonging to every member of a
    household. It's called from the same triggers as the in-app
    notification bell above (`recordOutOfStockTransition`,
    `recordListClearedTransition`, `recordPriceSpikes`,
    `syncMealNotLoggedNotifications` and
    `syncExpiringSoonNotifications` in `src/lib/notifications.ts`), and
    nothing else sends a push. The three action-driven triggers
    (`recordOutOfStockTransition`, `recordListClearedTransition` and
    `recordPriceSpikes`) run the send inside `after()` (`next/server`,
    PERF-9): it starts once the response has gone out and the platform keeps
    the invocation alive until it settles, which a bare
    `void sendPushToHousehold(...)` did not guarantee. It is not awaited
    because some call sites run inside a Prisma `$transaction`, and holding
    that open for a network call isn't worth it — Push API delivery has no delivery
    guarantee either way, so losing a send if the surrounding write later
    rolls back is an acceptable trade. The two cron-driven syncs **await**
    it instead: they have no surrounding transaction, and the cron route
    responds as soon as they resolve, at which point a serverless platform
    may freeze the invocation and drop any send still in flight. A 404/410 response (the browser revoked/expired that
    subscription) deletes the `PushSubscription` row so delivery stops
    retrying it; any other error is just logged. Each send passes
    `{ timeout: 10_000 }` (SEC-3) so one slow or unreachable push service
    can't hang its socket indefinitely and, since every subscription's send
    runs under the same `Promise.all`, hold up the rest of the fan-out.
  - **Quiet hours** (GAP-14): each `PushSubscription` row carries optional
    `quietHoursStart`/`quietHoursEnd` (0-23, local hour) and `timeZone`
    (the browser's IANA zone from
    `Intl.DateTimeFormat().resolvedOptions().timeZone`). They live on the
    subscription rather than on `User` because they're per device: a phone
    can be silenced overnight while a laptop keeps notifying.
    `sendPushToHousehold` drops any subscription for which
    `isWithinQuietHours` (`src/lib/quiet-hours.ts`, pure and unit-tested)
    is true at send time. The window is half-open `[start, end)` evaluated
    in the stored zone, and may wrap midnight (22 → 7 silences 22:00-06:59).
    It fails *open*, so the push is sent: either hour null, start equal to
    end, an out-of-range hour, or a missing or unrecognised zone all mean
    "not quiet". A subscription created before quiet hours existed has no
    zone and keeps working exactly as before. Only the OS push is
    suppressed. The `Notification` row is already written and the bell
    shows it as usual, and a suppressed push isn't queued for later, since
    a stale "out of stock" push at 07:00 is noise.
    - **Capturing the zone**: `subscribeToPushAction` stores the zone sent
      by the card (an unrecognised one is stored as null rather than
      failing the subscribe), and every quiet-hours save re-captures it, so
      an older subscription gains one and a device that changed zones
      follows along.
    - **UI**: once this browser is subscribed, `PushNotificationsCard`
      shows `PushQuietHoursForm`
      (`src/components/profile/push-quiet-hours-form.tsx`): two hour
      selects ("From"/"Until", 24-hour `HH:00` labels, defaulting to
      22:00-07:00), a save button, and a "Turn off quiet hours" button when
      a window is set. Only the browser knows its own endpoint, so the
      profile page passes the user's own subscriptions (endpoint plus the
      two hours, never the keys) and the card matches on the endpoint from
      `pushManager.getSubscription()`. Equal hours are blocked in the form
      with a hint.
    - **Actions** (`src/lib/actions/push.ts`): `setPushQuietHoursAction`
      (form action) and `clearPushQuietHoursAction` (click action) both
      scope by `requireUserId()` and write with `updateMany({ where: {
      endpoint, userId } })`. The endpoint is the only client-supplied
      identifier, so an endpoint belonging to another user matches zero
      rows and nothing is written; the save reports that as an error. The
      save validates both hours as integers 0-23 (a missing field is
      rejected, not coerced to midnight), rejects equal hours, and rejects
      an unrecognised zone, since saving a window that would silently never
      apply is worse than an error.
  - **Showing it**: `src/lib/service-worker.js` only implements two
    listeners — `push` (shows the notification via
    `registration.showNotification`, with `{ title, body, url }` as sent
    and a monochrome `badge.png` — Android tints badge pixels, so the
    full-colour app icon would render as a blob) and `notificationclick`
    (closes it, then focuses the already-open tab — steering it to `url`
    when same-origin — and only opens a new window when none exists,
    mirroring `notificationHref()` in `notification-bell.tsx`). It has no `fetch`
    handler and does no caching — it exists purely to deliver push, not for
    offline support (see `INFRA-5` in BACKLOG.md).

### Platform polish (UX-29)

- **iOS push prompt.** On iOS/iPadOS 16.4+ outside standalone mode the card
  says "Add Squirrel to your Home Screen to get notifications" instead of
  "not supported in this browser" — Web Push arrived on iOS with 16.4 and
  only works for Home Screen web apps. The decision lives in pure
  `pushAvailability` (`src/lib/platform.ts`, unit-tested), which the card
  feeds from `navigator`/`matchMedia("(display-mode: standalone)")` (plus
  legacy `navigator.standalone`) via `useSyncExternalStore`.
- **Theme colour.** The root layout sets per-scheme `viewport.themeColor`
  (light/dark page ground from `globals.css` `--gradient-end`) for first
  paint; once hydrated, `ThemeColorSync` sets both to the page's colour
  (UX-51);
  `manifest.ts`'s single `theme_color` carries the dark value, the app's
  default theme, instead of the old fixed brand purple.
- **Tap highlight and reduced motion.** `globals.css` sets
  `-webkit-tap-highlight-color: transparent` (every control already answers
  a touch with its own `active:` state, DESIGN.md M5) and a global
  `prefers-reduced-motion` rule collapsing animations/transitions to
  instant (0.01ms, so `transitionend` listeners still fire).
- **Client ids.** Client-side ids use `newUid` (`src/lib/uid.ts`):
  `crypto.randomUUID()` where available, a v4-shaped fallback otherwise —
  the former throws in insecure contexts such as plain-HTTP LAN testing.
- **Speech errors.** `mapSpeechRecognitionError`
  (`src/lib/shopping/voice-transcript.ts`, unit-tested) maps the
  recognizer's `service-not-allowed` (service unreachable, nothing the user
  could allow) to the "unavailable here" toast rather than the
  "microphone blocked" one. iOS date values were already pinned to
  `text-align: start` in `globals.css`, so that half of the item needed no
  change.

### Screen-reader and small-screen semantics (UX-31)

- **Unread notifications** on the history page render a decorative
  `aria-hidden` dot plus an `sr-only` "Unread" inside the link, so the word is
  part of the link's accessible name (an `aria-label` on a role-less `<span>`
  is ignored by screen readers).
- **Long names** (shopping lists, recipes, members, items, notifications and
  similar) use `line-clamp-2 break-words sm:line-clamp-1` instead of
  `truncate`: two wrapped lines on phones, where the `title` tooltip never
  shows on touch, one ellipsised line from `sm` up. The budget components and
  the inventory table rows are not yet covered; they belong to other in-flight
  work.
- **Delete household** confirm field sets `autoCapitalize="off"`,
  `autoCorrect="off"`, `spellCheck={false}` and `enterKeyHint="go"`, compares
  trimmed text against the trimmed name, and has a Cancel button.
- **Invite by email** is a real `<form>`, so Enter on the email field sends.
- **Household-data text fields** carry `autoComplete="off"` (M4), so the
  "New list" name no longer autofills the user's own name. `enterKeyHint` is
  set on the last field of the recipe-import, add-category and stock-scan
  "new item" inputs.
- **`src/app/dashboard/error.tsx`** is a segment boundary below the dashboard
  layout: a feature crash replaces only the page content, so the sidebar or
  bottom bar stay usable. When `navigator.onLine` is false it says the page
  needs a connection instead of "something went wrong".
- **Password change** form includes a hidden `autoComplete="username"` input
  holding the account email so password managers file the new password
  correctly.

Covered by `e2e/ux-31.spec.ts` (the error boundary itself has no e2e: a
render crash cannot be provoked from the UI).

### Swipe row actions (UX-35)

Shopping list rows (on an active list), task rows, the inventory phone
cards and budget transaction rows on a phone answer a horizontal swipe,
Todoist-style. Built as one shared wrapper,
`SwipeRow` (`src/components/shared/swipe-row.tsx`), with its maths in
`src/lib/swipe-row-calc.ts`. No gesture library.

- **Swipe right** past 40% of the row runs the row's primary action:
  tick (or untick) a shopping item, complete (or reopen) a task. A
  coloured underlay with the action's name fills in
  behind the row as it moves. On Android `navigator.vibrate(10)` buzzes
  once as the swipe crosses the 40% line; iOS has no vibrate API and gets
  the visual only.
- **Swipe left** past half the tray's width leaves a tray open with
  **Edit** and **Delete**. Any touch outside the row, or a tap on it,
  closes the tray.
  - Edit opens the row's usual edit dialog.
  - Delete hides the row at once and shows a "Deleted "…"" toast with
    **Undo** for 5 seconds. The delete only reaches the server when the
    toast closes (times out or is swiped away), the page is hidden, or the
    row unmounts. Undo just shows the row again, so no restore action
    exists (`src/components/shared/deferred-delete.ts`,
    `use-undoable-delete.ts`). If the browser is killed inside the
    window, nothing was sent and the row is still there. On the shopping
    list, deleting an aisle's last pending row hides that aisle's header
    too until Undo restores the row (UX-84): the rows report their hidden
    state up through `onHiddenChange`.
- **Every swipe duplicates a tap path** (DESIGN.md M7), and the swipe
  works by clicking the row's own button: the elements marked
  `data-swipe-primary` and `data-swipe-edit`. So a swipe gets the same
  optimistic update, rollback toast and disabled state as a tap. The
  trash button keeps its confirm dialog: swipe-delete is the quick path,
  the button the deliberate one.
- **No action shows twice on a phone.** Below `sm`, a swipeable row
  doesn't also show Edit and Delete icons: they sit behind the row's ⋯
  menu instead. Shopping rows get `RowActionsMenu`
  (`src/components/shared/row-actions-menu.tsx`), which clicks the row's
  own `data-swipe-edit` and `data-row-delete` buttons, kept mounted but
  `max-sm:hidden`; the inventory card's existing ⋯ menu gained Edit. From
  `sm` up the icons show as before. Task rows have no ⋯ at all (UX-106):
  the edit sheet has a Delete button instead.
- **Touch only.** Mouse and pen are ignored, so desktop is unchanged.
  `touch-action: pan-y` leaves vertical scrolling to the browser, the
  swipe only takes over once the finger has moved 8 px more sideways than
  down, and from then on the page doesn't scroll under it (a non-passive
  `touchmove` listener cancels the scroll, which iOS Safari otherwise
  started whenever the finger drifted mid-swipe), and a swipe that starts within 20 px of either screen edge is left
  to the OS back gesture. Under reduced motion the snap back is instant
  (the global rule from UX-29).

- **Inventory cards** swipe left only. A right swipe used to add one, but
  the card's own + button beside it is the easier tap.
- **Budget transaction rows** swipe left only (no primary action to run
  on a right swipe). The whole row is the edit button (`data-swipe-edit`),
  so Edit opens the edit sheet; Delete has Undo as above. The row's named
  Delete is "Delete transaction" inside that sheet, which keeps its
  confirm dialog.

Covered by `e2e/swipe-rows.mobile.spec.ts` (touch is driven through
Chromium's DevTools protocol, since Playwright has no touch-drag API) and
the unit tests beside `swipe-row-calc.ts` and `deferred-delete.ts`.

### Browser floor (UX-29)

The minimum browser is whatever renders the design tokens: `oklch()` and
`color-mix()`, i.e. Safari/iOS 16.4+ or a current Chrome, Edge or Firefox.
`BrowserFloorNotice` (`src/components/pwa/browser-floor-notice.tsx`,
rendered in the root layout) probes exactly those two features via
`CSS.supports` and shows an update banner below the floor — nothing at or
above it. Covered by `e2e/ux-29.spec.ts` (with `CSS.supports` stubbed off),
alongside the theme-color metas, tap highlight, reduced motion and both
Apple-mobile cards.

## Weekly digest email (GAP-27)

An opt-in email, sent once a week, summarizing each household the recipient
belongs to. It reuses the in-app recaps' own calculators rather than
approximating them, so the email never disagrees with the app.

- **Opt-in, per user, off by default** (`User.weeklyDigestEnabled`): email
  is a higher-commitment channel than the bell or push. Toggled from the
  "Weekly digest email" card on `/dashboard/profile`
  (`WeeklyDigestSetting`, `setWeeklyDigestEnabledAction` in
  `src/lib/actions/digest.ts`, session user only). Only **verified**
  addresses (`emailVerifiedAt` set) are ever mailed; the card says so when
  the toggle is on for an unverified address. A member of several
  households gets one digest per household.
- **Schedule**: `GET /api/cron/weekly-digest`, triggered by `vercel.json`'s
  second cron (`0 16 * * 0`, Sunday 16:00 UTC, so the Monday-start week is
  nearly over) and protected by the same `CRON_SECRET` bearer check as
  `/api/cron/sync-notifications` (see DEPLOYMENT.md, "Scheduled jobs").
  With `RESEND_API_KEY` unset the route is a successful no-op and reads
  nothing. Households are processed `DIGEST_BATCH_SIZE` (10) at a time with
  `Promise.allSettled`, so one failing household doesn't stop the rest, and
  only households with at least one opted-in, verified member are loaded.
- **Content** (`src/lib/weekly-digest-content.ts`, pure): each section appears
  only when it has something to say, and **no email is sent at all** when
  every section is empty.
  - *Meals*: distinct recipes on the menu over the last 7 days, via
    `computeMealVarietyRecap` with a 7-day window (the in-app card uses 30;
    a weekly email shouldn't re-announce the same dinners four times).
  - *Done this week*: `computeWeeklyTaskRecap`'s completer groups, with the
    Tasks page's guardrail intact (names and titles, never counts or a
    ranking). Unattributed completions show as "Someone".
  - *Use it up*: in-stock items classified by `getExpiryStatus` (the
    inventory badge's own thresholds) as past their date or expiring within
    `EXPIRY_WARNING_DAYS`, estimated dates marked "(estimated)".
  - *Household budget*: this month's household "Remaining after expenses
    and savings" headline and its healthy/tight/over line, computed exactly
    as the Budget page does (`computeTemplateStatuses` +
    `computeSafeToSpend` over the same 12-month lookback, and the same
    due and overdue planned bills, see "Planned bills"). Left out when the
    household has no categories, or nothing logged or due this month.
  - Lists are capped at 10 entries with "…and N more". All user-entered
    text is HTML-escaped.
- **Language**: each recipient's stored account locale (`User.locale`, the
  same preference the app UI follows), falling back to English for an
  unrecognised value.
- **Idempotency** (`WeeklyDigestSend`, unique on user + household +
  `weekKey`, the week's Monday in UTC): the cron claims a row *before*
  sending, so a retried or duplicated invocation in the same week hits the
  unique constraint and skips that recipient. A failed send releases its
  claim so the next run retries. If the process dies between claim and
  send, that person misses one week rather than getting a duplicate. A
  week with nothing to say records nothing. Rows older than 35 days are
  pruned on each run.
- **Unsubscribe without logging in**: every email carries a signed token
  (`src/lib/digest-unsubscribe-token.ts`, HMAC-SHA256 over the user id,
  keyed on `AUTH_SECRET` with a purpose prefix, stateless and non-expiring;
  no new env var). It's used two ways:
  - The `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
    headers (RFC 8058) point at `/api/digest/unsubscribe/[token]`. Its POST
    unsubscribes immediately, which is what the mail client's own
    Unsubscribe button sends. Its GET only redirects to the page below,
    because mail scanners prefetch links and a mutating GET would switch
    people off unasked.
  - The footer link opens `/unsubscribe/[token]` (public), which
    auto-submits a Server Action on load (`unsubscribeFromDigestAction`,
    same pattern as `/verify-email/[token]`). One click in the email is
    enough, and nothing changes during render.
  The route won't send anything if `AUTH_SECRET` is missing, since every
  email must carry a working unsubscribe link.

## Conventions

- Server Actions live next to the routes that use them
  (`src/app/dashboard/<feature>/actions.ts`) or in `src/lib/actions/` when
  shared across routes (auth, household). Every action re-derives the
  household from the session via `requireHousehold()` — never accepts a
  household id from the client. Every export of a `"use server"` file is a
  client-callable endpoint, so each must be named `…Action` or be one of the
  token-gated readers allowlisted in `src/lib/use-server-exports.test.ts`
  (`getShoppingListByShareToken`, `getInvitationForDisplay`); helpers that
  take a household id (`resolveShoppingExpenseCategory`,
  `isHouseholdStepSkipped`) live in plain server modules under `src/lib/`.
  That test fails `npm test` otherwise.
- Actions bound to a `<form>` follow the `(prevState, formData) =>
  Promise<ActionState>` shape (`ActionState = { error?: string }`) for use
  with `useActionState`. Actions triggered by a plain click (toggle, delete,
  quantity +/-) are called directly from a `useTransition` callback instead.
- **Ticking is instant (UX-14).** The taps people make in a row, often on
  weak in-store signal, show at once and never wait on (or grey out
  behind) an earlier save, so ticking three items shows all three straight
  away. A re-tap before the server answers undoes the first. Each tap has
  one owner:
  - *Shopping-list ticks* (`ShoppingRow`, and the Next up dock): the
    list's tick overlay in `ShoppingListClient`
    (`src/lib/shopping/tick-overlay.ts`, see UX-37 under "Shopping mode").
  - *Task ticks* (`TaskItemRow`) and the shopping list's, the task list's
    and inventory's confirmed deletes: the list's local marks
    (`useLocalRowChanges`, see UX-33 under "Motion and view transitions").
  - *The share page's checkbox* (`SharedRow`) and *the inventory −/+
    stepper* (`QuantityStepper`): a per-row `useOptimistic` in the row's
    own `useTransition`, the stepper going through the server's own
    `nextQuantityAfterDelta`. Neither moves a row.

  The list-level owners are plain state rather than `useOptimistic`:
  React 19 entangles concurrent async transitions, so an optimistic tick
  only rolled back once every save in flight had settled. In both, each
  save settles on its own: a failure puts its row back at once, and a
  success holds until the next server list, which then wins. A ticked row
  moves at tap time. On an `ACTIVE` shopping list it animates out of its
  aisle into "In the cart"; a task glides to "Completed". So the move
  follows the tap and isn't counted as layout shift, however slow the save.
  Every tick's save goes through `settleOptimisticAction` (`src/components/shared/`):
  when the action returns `{ error }`, or the request never arrives
  (offline, a dropped connection, which used to reach the error boundary),
  it toasts and the row goes back. Next's redirect signal is re-thrown, so
  an expired session still lands on login. The steppers are named
  "Decrease {name}" / "Increase {name}". Covered by
  `e2e/optimistic-ticking.spec.ts`, which holds every Server Action
  request, ticks three rows, checks all three before any answer, then
  releases and reloads, and by `e2e/shopping-mode.spec.ts` and
  `e2e/motion.spec.ts`.
- **A failed submit keeps what the user typed (UX-13).** React 19 resets an
  uncontrolled `<form action>` once the action settles, even when it came
  back with `{ error }`. Forms whose fields are uncontrolled use
  `useKeptFormValues([...names])` (`src/components/shared/use-kept-form-values.ts`):
  its `onSubmit` records the listed fields' values as the form is
  submitted, and each field reads `defaultValue={kept.values.x ?? fallback}`,
  so the reset lands on what was typed. It's client-side, so the actions'
  return types and no-JS fallback are unchanged. The names are an
  allowlist and never include a password: password fields still clear
  after an error (so the reset-password form, which has nothing else, is
  unchanged). A dialog calls `kept.reset()` when it reopens. Used by
  signup, login, the invite sign-up form, the display-name form, add/edit
  item (quantity, low-stock threshold, expiry, use-within) and the
  transaction description. After a *successful* "save & add another", the
  add-item dialog calls `kept.keep(["quantity", "lowStockThreshold"])`:
  those carry into the next item, while expiry and use-within go back to
  blank (so AUTO-7 can still estimate the next item's expiry). Covered by
  `e2e/form-errors.spec.ts`.
- Auth.js `signIn`/`signOut` calls that redirect must not be wrapped in a
  `try/catch` that swallows the redirect — only catch `AuthError` specifically
  and re-throw everything else (see `src/lib/actions/auth.ts`).
- All new user-facing text goes through the `dict` prop (English + Swedish)
  — see "Internationalization". Don't hardcode strings in JSX.
- **Every action input is bounded (SEC-7).** `next.config.ts`'s 6 MB
  `bodySizeLimit` applies to *every* Server Action, not only the photo
  scans it was raised for, so it's a backstop rather than a limit: each
  action caps its own input. Arrays of rows are capped at 300 — list
  import/paste, templates (`MAX_TEMPLATE_ITEMS`), bulk item create,
  `registerReceiptAction`'s lines and the meal-plan bridge's ingredient
  rows — and sub-recipe rows at 50, since each unique one costs its own
  `wouldCreateCycle` graph walk. `bulkUpdateFieldAction`'s ids are capped
  looser, at 1 000: the inventory table's header checkbox selects every
  item the household has, so that cap has to clear a whole pantry. Every
  free-text field and number has a `.max()` too (120 for names, 20 for
  units, 1 000 000 for prices). A payload over a row-count cap is rejected
  outright; a single row over a per-field cap is dropped where the
  surrounding code already filters invalid rows.
- **Single-use tokens are single-use, and hashed (SEC-8).** Redeeming an
  invite (`acceptInviteAction`, `joinViaInviteSignupAction`), a password
  reset or an email verification claims the row with
  `updateMany({ where: { id, usedAt/acceptedAt: null } })` as the first
  statement of its transaction and aborts on `count === 0`, so two
  concurrent requests can't both redeem it. Reset and verification tokens
  are stored as `sha256(token)` (`hashToken` in `src/lib/token-hash.ts`) in
  the existing `token` column; only the emailed link carries the raw UUID,
  so a read-only DB leak can't be turned into a reset URL. Invitation tokens
  stay in the clear because the owner's invite dialog must show the link
  again. Tokens issued before this change stopped working (they lived an
  hour, 36 hours for verification; users just request a new link).
- Base UI's `<Select.Value>` (`SelectValue` in `src/components/ui/select.tsx`)
  renders the raw selected `value` as text by default — it does **not** look
  up the matching `SelectItem`'s label. Any `Select` whose `value`s aren't
  already human-readable (e.g. a sentinel like `"__all__"` for "All
  categories") needs an explicit `children` render function on `SelectValue`
  mapping value → label (see `InventoryClient`'s filter selects), or it'll
  silently render the sentinel/id instead of the intended text.
- `SelectValue` is a `block truncate` element (UX-2): a selected label wider
  than its trigger ends in an ellipsis instead of being clipped mid-word.
  `text-overflow` only works on a block box, so don't put `flex` back on
  it; if a value ever needs an icon next to the text, wrap the text in its
  own `truncate` span. Covered by `e2e/select-ellipsis.desktop.spec.ts`.
- **200% text size (UX-9)**: with the root font-size doubled (Android "Font
  size", iOS Larger Text in the installed app) no page scrolls sideways on a
  phone. Rows of fixed-width siblings wrap (`flex-wrap`: shopping item
  controls, inventory card actions and stepper, meal planner header, landing
  header), grids use `minmax(min(16rem,100%),1fr)` so a column never exceeds
  the screen, user-text buttons (`Merge into <name>`, landing CTAs) opt out of
  `Button`'s `whitespace-nowrap` with `h-auto whitespace-normal`, and
  bottom-nav labels use `hyphens-auto` so a long word breaks at a syllable,
  not mid-letter. Covered by `e2e/text-size.mobile.spec.ts`, which sets
  `html { font-size: 200% }` and runs `expectNoHorizontalOverflow` on every
  route in `e2e/routes.ts`, in English and Swedish.
- Form fields never go below 16 px on touch screens (UX-10, UX-8): iOS zooms
  the page when a smaller field is focused, at any width (an iPad, a phone in
  landscape). `Input`, `Combobox`/`Autocomplete` input groups
  and `Textarea` use `text-base md:pointer-fine:text-sm`, `border-2`, and
  `max-sm:h-11 pointer-coarse:h-11` (44 px) for the single-line ones, so don't override a field with
  `text-sm` or a raw `<input>`. Covered
  by `e2e/form-control-sizes.mobile.spec.ts`, which also runs on the
  `landscape` and `tablet` projects.
- Suggestion rows and combobox buttons are 44 px on touch screens (UX-143):
  `AutocompleteItem` has `max-sm:min-h-11 pointer-coarse:min-h-11` like
  `ComboboxItem`, and `ComboboxTrigger`/`ComboboxClear` set `h-11` there
  (`h-full` in the `h-11` group measured 42 px after the border; no picker
  renders `ComboboxClear` yet, so it only keeps the pair matched). Covered by
  `e2e/suggestion-targets.mobile.spec.ts`: the unit picker's rows and the
  Match item toggle.
- Comboboxes keep their value readable on phones. An autocomplete field
  shows one 44 px button at a time below `sm`: the chevron while it's
  empty, the clear (×) once it has a value (clearing brings the chevron
  back). Form rows stack below `sm` so a combobox never shares a row with
  more than a short number field: category and location (inventory add
  and edit, the bulk-add review steps, the receipt's new-item draft) take
  a row each, and quantity + unit become a `6rem` quantity beside a unit
  that fills the row, with any third field wrapping under quantity
  (inventory add/edit, shopping edit item, receipt rows). A recipe
  ingredient's name gets its own row above quantity, unit and remove.
  Desktop layouts are unchanged. `e2e/form-field-room.mobile.spec.ts`
  fails if any combobox in those dialogs has under 120 px for its text.

## Loading skeletons

UX-42 (part). Every top-level dashboard feature route (inventory, shopping
list, tasks, budget, personal budget, household, meal planning,
notifications, profile, what's new) has a `loading.tsx` that renders
`PageSkeleton` (`src/components/dashboard/page-skeleton.tsx`): a
header block the height of the real title and subtitle, then a fixed-height
body (`cards`, `rows`, `table` or `narrow`) close to the page's shape. It
shows the moment a tab is tapped, and because the bottom bar's links are
prefetched when they enter the viewport, the skeleton is already on hand.
`src/app/loading-coverage.test.ts` fails when a dashboard feature route has
no `loading.tsx`. The nested detail pages (`shopping-list/[id]`,
`inventory/items`, `inventory/items/[id]`) have one too, with `PageSkeleton`'s
`back` prop adding the "back" link row they carry above the title; the
coverage test walks nested folders.

**Layout shift (UX-42).** `e2e/cls.spec.ts` reads the browser's
`layout-shift` entries (what Lighthouse's CLS is made of, ignoring shifts
within 500 ms of input) on desktop and the Pixel 7 profile, and fails above
0.05, for every dashboard route, two ways. A hard load covers the first
paint. A client navigation from another page with every RSC request
(`_rsc=`) held back 800 ms via `page.route` covers slow-network swaps: a
prefetched route (the bottom bar's links) shows its `loading.tsx` skeleton,
any other keeps the previous page, and either is replaced by the real page.
Every route measures under budget in both. What the spec cannot delay is the
server's own Suspense streaming inside one response, and Lighthouse itself
isn't in the toolchain, so a run against a deployed build stays the final
check. The household page (MAINT-31) has no Suspense boundaries at all:
its note, member list and notes board used to stream in behind fallbacks of
a different height (or none), which under load moved the settings cards
below them past the budget (0.0647), so it now arrives in one piece behind
`loading.tsx`. The three remaining `fallback={null}` slots above content
(inventory `InventoryWellStockedNote`, shopping list
`RepurchaseSuggestionsSection`, the layout's email-verification banner) stay
empty on purpose: each renders nothing in the common case (a solo household,
a stock with something low, no suggestion, an already verified email), so a
fixed-height placeholder would add a gap and a shift to every visit that has
nothing to show. The delayed-navigation measurement showed no shift from
them, so none was added; reserve height for one only if a measurement shows
it shifting.

**Pending buttons keep their width.** `PendingLabel`
(`src/components/ui/pending-label.tsx`) stacks the idle and pending labels
in one grid cell and hides the inactive one with `invisible`, so a submit
button reading "Saving…" is as wide as "Save changes" and nothing beside it
moves; only the visible label is in the accessibility tree. Used by the
text-swap submit buttons across the forms and dialogs;
`e2e/pending-button-width.spec.ts` holds the server action and checks the
width. Buttons that swap a spinner icon rather than text are unchanged.

### Mascot empty states (UX-38)

The squirrel mark (`src/app/icon.png`, the same raster as BrandBadge,
through `next/image`) heads the empty states that mean "nothing here
yet": no shopping lists, an empty shopping list, no inventory items (the
first-run panel, not "no matches"), no recipes, nothing prepped, no tasks,
and the empty notification history. `MascotEmptyState` in
`src/components/brand/mascot-empty-state.tsx` is the dashed box with the
64 px mark on top; each page keeps its own copy as children. The mark has
alt text ("Squirrel mascot" / "Squirrel-maskot", `mascotAlt` in each
feature's dict) because nothing beside it names it. Filter "no matches",
the bell dropdown, the catalog, scan queues and every budget surface stay
text-only: small inline empties would be noise, and money surfaces get no
mascot or celebration (PRODUCT.md Guardrails).

**The one celebration.** Ticking the last pending item on an `ACTIVE`
shopping list swaps the "All done" ring's tick for the mark, which rises
in once (motion-safe, so a still image under `prefers-reduced-motion`)
and holds. It's decided in the tap (`toggleItem`), not from the cleared
state, so opening a list that's already all ticked or deleting its last
row shows the plain tick. A failed save, or the list leaving the cleared
state, re-arms it. The mark sits over the progress ring as a sibling
because a `progressbar`'s children are hidden from screen readers. No
confetti, sound, haptics or counts. Covered by `e2e/ux-38.spec.ts`
(desktop and mobile).

## Motion and view transitions

UX-33. One set of motion tokens, used two ways: list rows move at tap time
and glide with FLIP animations, and navigations run as React
`<ViewTransition>`s on the browser's View Transitions API. Next 16.3's App
Router has those on by default, with no `experimental.viewTransition` flag
any more. A browser without the API swaps pages instantly.

**Tokens.** `globals.css` defines `--motion-duration-fast` (120 ms, exits),
`-base` (200 ms, entrances), `-slow` (320 ms, morphs) and `-spring`
(400 ms, moves), with `--motion-ease-out`, `-in`, `-in-out` and `-spring` (a
sampled damped spring as `linear()`, about 5% overshoot). They're plain
custom properties, not `@theme` entries, so Tailwind's own `ease-*`
utilities are unchanged. DESIGN.md's "Depth, motion and states" says what
each is for.

**List rows: moved at tap time.** A tick, an untick or a delete changes the
list the moment it's tapped, and the save follows in the background
(`useLocalRowChanges`, `src/components/shared/local-row-changes.ts`). This
replaces UX-14's "the box flips at once but the row stays put until the
server answers". When the server took over 500 ms, that later move counted
as layout shift. Now:
- The list keeps this device's unsaved ticks and deletes as marks and lays
  itself out from the server's rows with them applied
  (`applyLocalRowChanges`). A mark is applied with `flushSync`, so it shows
  on the next frame even from inside a confirm dialog's transition or while
  an earlier save is still pending.
- Each save settles its own mark, outside any transition: React 19
  entangles concurrent async transitions, so a mark dropped in one waited
  for every save in flight. A failure (an `{ error }`, or a request that
  throws) drops the mark at once and the row moves back;
  `settleOptimisticAction` or the confirm dialog toasts why (M5). A
  confirmed delete goes through `settleDelete`, which turns a request that
  never arrives into the save-failed toast instead of the error boundary. A
  success keeps the mark until the next server list arrives, which already
  has the change, so nothing moves. Marks carry a sequence number, so after
  a quick tick then untick only the latest save's answer counts.
- A local tick mirrors the server's write, so nothing changes when it
  answers. `withLocalTick` (`put-away-calc.ts`) sets a shopping row's
  `putAwayAt`/`priceRecordedAt` the way `togglePurchasedAction` does in
  either inventory sync mode, applied to the rows the tick overlay flips,
  so the "Put away" button and badges appear at the tap. `withLocalCompletion` (`task-rotation.ts`) sets the task's
  completer (the page passes the viewer's member id), `completedAt` and a
  rotating task's next assignee. The tasks page's weekly recap is worked out
  in `TasksClient` once, from the list as the page opened (UX-104), so a
  tick never mounts or grows it above the rows under the thumb; it shows
  in the recap on the next visit.
- Used by the task list (tick, delete), the shopping list (delete) and
  inventory (delete). Shopping ticks have their own overlay with the same
  rules (`tick-overlay.ts`, UX-37), so each tap has one owner.

Adding is the exception: the server decides a new item's category, or that
it merges into a row already there, so a new row appears when the server
answers. Rows are kept in creation order, so it lands at the end of its
section, and only what's below it moves.

**List rows: the glide.** `useFlipList` (`src/components/shared/use-flip-list.ts`)
runs after every commit of a list:
- It measures each element with `data-flip-key` against its parent (or the
  viewport if it changed parent) and plays the difference from where it was
  back on the real element with the Web Animations API (FLIP). Keys pair
  across sections, so a ticked row glides into "Purchased" or "Completed",
  and a completed list's card into its section on the overview.
- A new row rises in.
- A removed row's node is put back in its list, absolutely positioned and
  inert, to fade where it was (not table rows, which don't lay out alone).
- Section labels, inventory group rows and the task list itself (below the
  recap) are keyed too.
- A new view of the list doesn't animate: inventory passes its search,
  filters and grouping as the hook's `view`, and when that changes the rows
  are re-measured without playing anything (hidden rows haven't gone
  anywhere). More than 20 rows arriving or leaving at once is also treated
  as a different list.

**The tick moment (UX-54).** Completing a shopping row, a Next up dock
row or a task (the tasks page; the swipe has its own buzz) goes through
`src/lib/tick-feedback.ts`: a 10 ms `navigator.vibrate` where the device
has one, the checkbox (or the dock's filled circle) fills with a ~200 ms
spring (`tick-pop` in `globals.css`, played while `data-ticking` is set
on `Checkbox`), and only then (`TICK_MS`, 200 ms) does the optimistic tick
move the row. Unticking is never delayed or buzzed. Under
`prefers-reduced-motion` there is no wait and no spring, but the buzz
still fires. The swipe row's commit buzz uses the same `vibrateTick`.
The dock's UX-78 settle window is `TICK_MS` + 450 ms so the double-tap
guard keeps its length. Covered by `e2e/tick-moment.spec.ts`.

A shopping row leaving its aisle (UX-37's 250 ms drop towards "In the
cart") carries no flip key meanwhile, so it has one animation, not two.
It then arrives in "In the cart" as a new row and rises in there, and the
aisle closes up with a glide. Since it animates the real element and not
a snapshot, a row stays tappable at the place it's drawn while it moves. A view transition, which
this first used, makes an animating element untappable, and that's the row
the thumb goes to next. Used on the shopping list, the shopping lists
overview, tasks, and inventory (table rows and phone cards).

**Navigations: view transitions.**
- *Tab changes.* `src/app/dashboard/template.tsx` mounts afresh whenever
  the dashboard's child segment changes, so its `<ViewTransition>` fades
  the old page out (fast) and the new one in with an 8 px rise. The phone
  header and bottom bar carry `view-transition-name`s (`app-header`,
  `app-bottom-nav`) and are pinned above the animation: a page's snapshot is
  its whole box, not just what `main` scrolls into view, and would
  otherwise paint over both bars.
- *Shared-element morphs.* `MorphTitle` (`src/components/shared/view-transitions.tsx`)
  gives a list row's title and its detail page's `h1` (`PageTitle`'s
  `morph` prop, which wraps only the large title, never its compact copy
  in the bar) the same name: a
  shopping list card into the list page, and an item catalogue row
  (`/dashboard/inventory/items`) into the item page. Both detail routes have
  a `loading.tsx`, so a navigation usually commits the skeleton first.
  `PageSkeleton`'s `morph` prop gives its title bar the same name
  (`MorphTitleSkeleton` reads the id with `useParams`), so the title flies
  to the header at once and hands over to the real heading when the page
  arrives. Recipes have no detail page (a recipe opens in a dialog), so
  there is no recipe morph yet.
- The document root is never captured (`:root { view-transition-name:
  none }`). React crossfades the root whenever something outside a
  `<ViewTransition>` changes (a dialog closing in its portal), and while
  that runs the whole page ignores taps. Unnamed content updates at once
  instead.
- React leaves a navigation unanimated when an unrelated update shares its
  render, or when it's tapped while the page is still hydrating. A morph
  also needs both ends on screen. In all these cases the page still
  changes, just without the animation.

**Layout shift.** A tick or a delete moves rows inside the 500 ms the CLS
metric leaves for a response to input, so it measures 0 however slow the
save is. On desktop `html` reserves the scrollbar gutter
(`scrollbar-gutter: stable`), so a list growing past one screen no longer
nudges right-aligned buttons sideways.

**Reduced motion.** `useFlipList` plays nothing under
`prefers-reduced-motion`. The UX-29 rule in `globals.css` doesn't reach the
view-transition pseudo-elements, so a second rule sets their duration and
delay to 0. Every change happens at once.

**Tests.** `e2e/motion.spec.ts` records each FLIP animation (wrapping
`Element.prototype.animate`) and each view transition's animations (wrapping
`document.startViewTransition`), on desktop and mobile:
- `optimistic-ticking.spec.ts`: a failed task tick rolls back at once
  while another is still saving, and an offline task delete brings the row
  back with a toast.
- With every save held at the server well past 500 ms
  (`holdServerActions`, now shared in `e2e/ui.ts`), a shopping tick moves
  the row to "Purchased" before the save answers, the rows below glide, the
  row that slid up takes a tap mid-glide, and a delete removes and fades
  the row. CLS is strictly 0, an added row rises in, and a reload shows it
  all saved.
- A task completed with its save held moves to "Completed" at once.
- Both morphs and the tab fade animate (each navigation retried up to three
  times from where it started, for the reason above).
- Under `reducedMotion: "reduce"` no FLIP plays and view transitions take
  no time.

Unit tests cover `applyLocalRowChanges`, `withLocalTick` and
`withLocalCompletion`. `e2e/optimistic-ticking.spec.ts` still covers
UX-14's rapid ticks and the rollback toast.

## Testing

- **Stack**: **Vitest** — confirmed as the appropriate pick by checking
  `node_modules/next/dist/docs/01-app/02-guides/testing/` (resolved per
  AGENTS.md), which ships a Vitest guide and no Jest/Playwright guide for
  this Next.js version. Installed as `vitest` + `vite-tsconfig-paths` (for
  the `@/*` import alias) only — `jsdom`, `@testing-library/react`, and
  `@vitejs/plugin-react` (which the Next.js guide also lists) are
  deliberately **not** installed yet, since nothing under test today renders
  a component; add them when a future task writes component tests.
  `vitest.config.ts` at the repo root sets `test.environment: "node"` and
  `test.include: ["src/**/*.test.ts"]`.
- **Running tests**: `npm test` runs `vitest run` (single non-watch run, for
  CI/agent use); `npm run test:watch` runs plain `vitest` (watch mode, for
  local development) — the Next.js guide's own example maps `test` to watch
  mode, but a non-interactive definition-of-done check needs a run that
  actually exits.
- **File convention**: tests are colocated `*.test.ts` files next to the
  source file they test (e.g. `src/lib/i18n/format.test.ts`,
  `src/lib/actions/auth.test.ts`) — not a separate `src/**/__tests__/` tree.
  Picked for discoverability (the test sits right next to what it covers)
  and because it matches how the rest of this codebase colocates related
  files (e.g. `actions.ts` next to the `page.tsx` that uses it).
- **What's covered so far** (deliberately scoped to already-stable code that
  doesn't depend on Wave 1's other in-flight features — see
  `AGENT_TASKS.md`):
  - `src/lib/i18n/format.ts` — `format()`/`plural()`, pure functions, no
    mocking needed.
  - `src/lib/session.ts` — `requireHousehold()`'s cookie-fallback logic
    (resolve the active household from the `active_household` cookie,
    falling back to the caller's first membership when the cookie is
    missing or stale, plus the zero-session/zero-membership redirects),
    `requireUserWithoutHousehold()`, the `/no-household` page's guard, and
    both guards' password-change revocation (SCALE-H), with
    `src/app/session-expired/route.test.ts` covering the sign-out handler.
  - `src/lib/actions/auth.ts` and `src/lib/actions/household.ts` — the Zod
    schemas in these files (`signupSchema`, `joinSignupSchema`,
    `createHouseholdSchema`) are module-private, so they're exercised
    indirectly through the exported Server Actions that use them
    (`signupAction`, `loginAction`, `createHouseholdAction`,
    `joinViaInviteSignupAction`): each schema's validation-error paths, plus
    one success path per action.
  - MAINT-14 filled in the remaining untested domain modules:
    `src/lib/shopping/put-away.ts` (the quantity math, conditional
    price/expiry/location fields, and PriceHistory recording behind stock
    arriving and being reversed, with its collaborators mocked out),
    `src/lib/settle-departing-member.ts` (money — every other member's
    split marked paid, unconditionally, including a zero-amount split),
    `src/lib/session-revocation.ts` (every branch of `isSessionRevoked`),
    `src/lib/budget-date-utils.ts` and
    `src/app/dashboard/meal-planning/date-utils.ts` (month/week navigation
    across year boundaries, leap days, and the DST transition date, plus
    `isMonthKey`/`isDateKey`'s rejection cases), `src/lib/digest-unsubscribe.ts`
    (token verification failure vs. success, and idempotency), and the
    inventory and shopping-list CSV `export/route.ts` handlers (household
    tenancy scoping, filename generation, column rendering, and formula-
    injection guarding end to end).
  - Not covered yet: meal planning, budgeting, profile — out of scope for
    this task per `AGENT_TASKS.md` (they're other in-flight Wave 1 work and
    don't exist in a stable form on this branch). Add their tests alongside
    their own feature work.
- **Database isolation**: no test in this suite touches the real database.
  Everything under `src/lib/actions/*.test.ts` and `src/lib/session.test.ts`
  mocks `@/lib/prisma`, `@/lib/auth`, `@/lib/session`, `next/headers`,
  `next/navigation`, and `next/cache` with `vi.mock` (and stubs `next-auth`'s
  `AuthError` locally, since the real `next-auth` package's entrypoint
  imports `next/server`, which Vitest's Node environment can't resolve
  outside an actual Next.js build). `npm test` never opens a Postgres
  connection, so it's safe to run against a worktree with no `DATABASE_URL`
  set and never touches the shared dev Postgres from `docker-compose.yml`.
  If a future task adds tests that need real Prisma queries, isolate them
  behind a separate `DATABASE_URL` (e.g. a second `docker-compose` service)
  or wrap each test in a rolled-back transaction — don't run them against
  the shared dev database by default.
- **Cookie/localStorage drift guard** (`src/lib/cookie-inventory.test.ts`):
  scans `src/` for any `*_COOKIE`, `*_COOKIE_PREFIX` (a cookie keyed per id,
  e.g. `household_step_skipped_<householdId>` in
  `src/lib/actions/household.ts`) or `*_STORAGE_KEY` constant and fails if
  its value isn't listed in `STORAGE_INVENTORY`
  (`src/lib/cookie-inventory.ts`), which also feeds the privacy page's
  cookie list (`src/app/privacy/page.tsx`). A new cookie or localStorage
  key must follow one of those three naming patterns and get a
  `STORAGE_INVENTORY` entry in the same PR, or the test fails.
- **Dismissed-UI hook** (MAINT-9): `useDismissedLocalStorage(key)`
  (`src/components/shared/use-dismissed-local-storage.ts`) is the one place
  that reads/writes a "dismissed" value in localStorage, for the use-it-up
  chips and the nutrition, variety and weekly-task recaps. It returns
  `[value, setValue]`: `value` is null on the server and first render (no
  hydration mismatch) and when storage is blocked, `setValue` hides the
  card at once and persists best-effort. `key` is typed as
  `DismissedStorageKey`, the `*_DISMISSED_STORAGE_KEY` constants exported
  from `src/lib/cookie-inventory.ts`, so a new dismissal needs an inventory
  entry first. `e2e/dismissed-recaps.spec.ts` covers the dismissal
  surviving a reload.
- **End-to-end tests** (`e2e/`, `playwright.config.ts`): Playwright drives
  a production build (`npm run build`, then `npm run test:e2e` starts
  `next start` itself) against a real Postgres, because the unit suite
  mocks every I/O boundary and so can't tell whether a page actually
  renders or a form actually saves. `e2e/global-setup.ts` seeds, once per
  Playwright worker, a fixed, already-verified household with two owners, one whose account language
  is English and one Swedish, plus a shopping list with two rows
  (`e2e/seed.ts`, fixed ids in `e2e/seed-data.ts`; login is gated on email
  verification, which a test can't click through) and refuses to run
  against a non-local `DATABASE_URL` unless `E2E_ALLOW_REMOTE_DB=true`.
  `e2e/auth.setup.ts` logs every worker's two users in once through the
  real form and saves their sessions for the specs. Signed-in pages take the locale
  from the account rather than the cookie, which is why Swedish needs its
  own user. Spec files run in parallel (`workers: 3`, `E2E_WORKERS` or
  `--workers` to change it) without racing on rows, because each worker
  has its own copy of the seeded household, users and rows: Playwright
  sets `TEST_PARALLEL_INDEX` in the worker before it loads the config and
  specs, and `e2e/seed-data.ts` suffixes every seeded id with it (ids are
  primary keys across the database), so specs keep importing plain
  constants (`E2E_HOUSEHOLD`, `E2E_SHOPPING_LIST`, `STORAGE_STATE`, …)
  and get their worker's. Outside a worker those resolve to worker 0, so
  a test title never contains one (`smoke.spec.ts` titles pages by route
  pattern, and screenshots are named by pattern too). Tests inside a
  file still run in order. A spec names the rows it creates uniquely,
  with `E2E_WORKER` in inserted ids, since the desktop and mobile runs of
  one file can now run at the same time; and it sets up what it needs
  rather than counting on another spec having run first, and cleans up
  only inside its own `E2E_HOUSEHOLD`. That took the suite from 10.1
  minutes (`workers: 1`) to 5.6 on 4 cores. More workers don't help:
  the single `next start` process is the bottleneck (4 workers: 5.4
  minutes, with requests queued long enough to time out a 5 s wait). `next start` gets
  `AUTH_TRUST_HOST=true`, without which Auth.js rejects the localhost
  login callback. `.github/workflows/ci.yml` has it as a separate `e2e` job
  with a Postgres service container, running on PRs into `master` (the
  release PR, see "Releases & What's new"; `ci_gate: github` in
  AUTOPILOT.md). `npm run ci:local`
  (check + build + e2e) runs the same gate in a working session. In
  Claude Code on the web, `.claude/hooks/session-start.sh` starts the
  image's Postgres 16 and migrates it, so agents can run the suite too.
- **UI test coverage, desktop and mobile**: `playwright.config.ts` runs
  every spec in two projects, `desktop` (Desktop Chrome, 1280×720) and
  `mobile` (Pixel 7, 412 px wide with touch; the always-on phone, since
  only Chromium is installed by default).
  `*.desktop.spec.ts` / `*.mobile.spec.ts` run in only one of them.
  Two more touch projects cover the in-between sizes (UX-7): `landscape`
  (Pixel 7 at 863×393) and `tablet` (810×1080). They run only
  `smoke.spec.ts`, `navigation.desktop.spec.ts` and
  `form-control-sizes.mobile.spec.ts` (every page without horizontal
  overflow and with 44 px touch targets (UX-8), every sidebar control
  reachable by scrolling the aside, back-links on one line, 16 px fields).
  A fifth, `iphone` (WebKit, iPhone 15; UX-32), runs `smoke.spec.ts`,
  `flows.spec.ts` and `form-control-sizes.mobile.spec.ts` (the 16 px
  field-zoom check iOS needs) to catch iOS Safari differences. It exists
  only when `E2E_WEBKIT=1`: GitHub CI sets it after `npx playwright
  install --with-deps webkit`, and the `ci:local` gate skips the project
  unless `E2E_WEBKIT=1` is set and WebKit is installed. Without it the
  config prints a warning once and leaves the project out, so runs without
  WebKit don't fail. Locally: `npx playwright install webkit`, then
  `E2E_WEBKIT=1 npm run test:e2e -- --project=iphone`.
  `e2e/routes.ts` lists every page with a concrete URL (dynamic segments
  point at a seeded row, or at a bogus token so the "invalid link" state
  renders), and `src/app/page-coverage.test.ts` fails `npm test` if a
  `page.tsx` is missing from it or it lists a page that no longer exists;
  `/no-household` is the one exemption (unreachable for the seeded user,
  guard unit-tested). `smoke.spec.ts` (signed in) and `public.spec.ts`
  (logged out) visit every listed page in `en` and `sv` on both
  viewports and fail on an HTTP error, the error boundary, a browser
  console error, the wrong `<html lang>`, or horizontal overflow of the
  document or of `main` (which is what scrolls on a phone). The shared
  checks are in `e2e/ui.ts`. `navigation.desktop.spec.ts` walks every
  sidebar entry; `navigation.mobile.spec.ts` walks the bottom bar and its
  "More" menu and checks the last content on a long page isn't hidden
  under the bar. Both read `nav-items.ts` and the dictionary, so moving
  a section keeps them in step. `flows.spec.ts` covers core write paths
  (add and complete a task, create a shopping list and add items).
  `npm run test:e2e:desktop` / `:mobile` run one project, and
  `npm run test:e2e:quick` runs `desktop` and `mobile` only, skipping the
  `landscape` and `tablet` reruns (78 of the ~400 tests) while
  iterating. `ci:local` and CI always run every project.
- **Local check speed**: `npm run check` runs lint, typecheck and unit
  tests at the same time through `scripts/run-parallel.mjs`, which
  buffers each one's output and prints it whole as it finishes (so the
  three don't interleave), lets all of them finish so one run reports
  every failure, and exits non-zero if any failed. `npm run lint` keeps an
  ESLint cache in `node_modules/.cache/eslint/` (content-based, so a
  branch switch that only touches mtimes doesn't invalidate it), which
  takes a re-run from ~38 s to ~2 s. Together `check` went from ~92 s to
  ~37 s cold and ~21 s warm.
- **Touch targets (UX-6, UX-8, DESIGN.md rule M3)**: below `sm`, or on any
  touch screen (`pointer: coarse`, so also an iPad or a phone in landscape),
  every button,
  link outside running text, input, checkbox, radio, tab and menu item
  has a 44 x 44 px hit area. `Button` (all sizes), `Input`, the select and
  combobox triggers and menu items grow with paired `max-sm:` and `pointer-coarse:` classes; `Checkbox`
  and `Radio` are drawn by hand so a `::after` can extend their hit area
  past the 20 px control; links and chips use the `touch-target` utility
  (`globals.css`) or a `max-sm:min-h-11 pointer-coarse:min-h-11` row. A mouse
  on a wide screen (`pointer-fine`) keeps the denser sizing; the sidebar's
  links grow to 44 px under a coarse pointer too. `expectTouchTargets(page)` in `e2e/ui.ts` measures every such
  element (passing if its own box, an enclosing label, link or button, or
  an absolutely positioned `::before`/`::after` reaches 44 px) and runs
  in `smoke.spec.ts` on every project but `desktop` (`mobile`, `landscape`,
  `tablet`) for every page, and in `public.spec.ts` for the logged-out
  pages. It also measures `role="option"` rows (the smart-add suggestions).
  `expectTouchTargetsInTabs` clicks through every tab of every tablist and
  measures each panel, since the plain check skips `hidden` panels (most of
  the budget UI); smoke uses it. A link in running text that the check can't
  tell from a lone link (a one-entry comma list) is marked
  `data-running-text`. It checks each page's closed state, so menus and
  dialogs opened later rely on the component classes above.
  **Spacing (UX-19)**: neighbouring targets are 8 px apart on touch
  (`max-sm:gap-2 pointer-coarse:gap-2` on action rows). Category chips
  grow to hold two real 44 px buttons instead of overlapping padded
  icons. `expectTargetsApart(scope)` fails on overlaps or gaps under 8 px
  and is asserted on the meal row, the category chip and the 320 px
  inventory page in `e2e/ux-19.mobile.spec.ts`.
- **Checkbox and date fields**: a checked `Checkbox` is filled with the
  primary colour and shows a white tick (the `checkbox-tick` utility in
  `globals.css`; an inline SVG class got split by `cn()` and left an empty
  outline). Every date/time input drops its native appearance
  (`globals.css` base layer) so iOS Safari honours the field's width
  instead of sizing it to its content and scrolling dialogs sideways; the
  native picker still opens on tap. `e2e/form-controls.spec.ts` pins both.
- **Screenshots for review and the UX scout**: with
  `E2E_SCREENSHOT_DIR` set (`npm run test:e2e:screenshots` defaults it to
  `test-results/screenshots/`), the smoke and public specs also save a
  full-page `<project>-<locale>-<route>.png` of every page. On mobile the
  viewport is grown to `main`'s scroll height for the shot so it doesn't
  stop at the fold. The `ux` scout lens runs this instead of its own
  crawler, so its screenshots and the gate check the same pages. Both
  specs pre-set the cookie notice's `cookie_notice_ack` cookie
  (`dismissCookieNotice` in `e2e/ui.ts`) so the fixed notice doesn't
  cover every screenshot or skew the layout checks;
  `cookie-notice.spec.ts` covers the notice itself (shows on a first
  visit, "Got it" hides it, stays hidden after a reload).
- **Waiting on what the user sees, not on the URL**: the e2e flakes fixed
  in Oct 2026 were all a test acting one step ahead of the page. A tab
  switch that is a `history.replaceState` (BudgetTabs, MealPlanningView)
  moves the URL at once but renders in a React transition, so a spec
  waits for the tab's `aria-selected` (and, before following a month
  link, for the link's `href`) rather than `toHaveURL` alone. A dialog
  closed from the UI takes its history entry back with an async
  `history.back()` (`dialog-history.ts`), so a reload that follows one
  calls `waitForDialogHistory(page)` from `e2e/ui.ts` first. It waits on
  the `data-dialog-back-pending` attribute that `dialog-history.ts` keeps
  on `<html>` while that back is on its way. Without it the reload races
  the back and comes back `net::ERR_ABORTED`. A CSS
  locator (`#id`) also matches the hidden copy Next.js parks outside
  `main` while a reload streams in, so fields are found by role and name
  inside `main` (the item page's "Try it" unit field got its missing
  `aria-label` for that). A row's Edit and Delete go through
  `clickRowAction`, which takes the icon from `sm` up and the ⋯ menu below
  (the landscape and tablet projects are touch but `sm` and up). A test
  that plans rows in a shared week removes them in an `afterEach`, pass or
  fail, since the desktop and mobile runs and a retry share the household.
  A page measured or asserted straight after `goto` uses `gotoRevealed`,
  which waits for React 19.2's batched Suspense reveals (a cold WebKit
  could still show the tasks page's Add task skeleton after 5 s).
  `expectTouchTargets` and `expectTargetsApart` first wait for
  `SheetIndent`'s transition to end: for 400 ms after a sheet closes the
  page is still scaling back from 0.94, and every 44 px target measured
  42-43 px. A test that holds a Server Action with `page.route` counts it
  as answered on its `response`, not when `route.continue()` resolves
  (that's when the request is sent, so a reload could beat the save).
  `optimistic-ticking.spec.ts` and `shopping-mode.spec.ts`, which hold
  and abort saves with `page.route`, set
  `test.use({ serviceWorkers: "block" })`: once the app's service worker
  claims the page, its fetches skip the route, so a save meant to fail
  went through.
  The meal-prep journey test is `test.slow()`: twenty steps took two
  thirds of the 30 s budget on an idle machine.
- **Rule**: anything that changes the UI adds or extends an `e2e/` spec
  that asserts it and passes on both projects, and a new page goes in
  `e2e/routes.ts` (AGENTS.md, "UI tests"). The self-review checklist, the
  PR template and the autopilot builder all check for it.

## Autonomous improvement loop

Scheduled Claude Code sessions ("routines") improve the app continuously,
under human control. Five roles, each a skill in `.claude/skills/`:

- **Scouts** (`autopilot-scout <lens>`) find work through one lens:
  `competitors` (`GAP-`), `code` (`SEC-`/`PERF-`/`MAINT-`, rotating
  weekly), `ux` (`UX-`, a daily design audit: screenshots of every
  route on desktop, phone, landscape, tablet, a 320 px phone, light theme
  and 200% text, plus every dialog opened and closed
  (`npm run test:e2e:audit`, `playwright.audit.config.ts`). On top of
  that, a deep dive into one area's actions, rotating by weekday, and one
  state-of-the-art idea per run benchmarked against the best competing
  apps. All of it is reviewed against DESIGN.md's UX and design
  principles and its hard Mobile UX rules), `production` (`BUG-`, from Sentry, only when
  a Sentry connector is available) and `deps` (`DEPS-`). They add at most a
  few scoped items with acceptance criteria to BACKLOG.md, via a
  `docs(backlog)` PR, and never touch app code.
- **Builder** (`autopilot-build`) is a coordinator with sub-agents. The
  top-level session picks every eligible item that can be built in
  parallel, one `Flaky:` test fix and then `UX-` items before any other (as many as fit under `max_open_autopilot_prs` and
  `max_parallel_subagents`; at most one migration and one large item, no
  two in the same feature area) and starts one sub-agent per item in its
  own git worktree, with its own `node_modules` and database. Each
  sub-agent implements its item per AGENTS.md's workflow with unit and
  e2e tests, runs `npm run ci:local` under a shared lock (one build and
  e2e run at a time on the machine) before pushing, and opens a PR (ID in the title,
  label `autopilot`, release note in both languages). The coordinator
  writes no code: it tracks the sub-agents and validates each PR against
  GitHub and the sub-agent's `ci:local` log (head SHA, gate passed on it,
  title, label, release note, human-only flag, diff scope), sending
  failures back to the sub-agent and drafting the PR after a second
  failed round. Before building anything new it gives each of its own red
  or reviewed PRs a fix sub-agent, and it builds nothing when
  `max_open_autopilot_prs` are open.
- **Reviewer** (`autopilot-review`, every three hours, 1.5 h after each builder slot, and after each builder run)
  reviews every open PR, whoever opened it, as inline comments marked
  `🤖 autopilot-review`. The top-level session delegates each PR's review
  round to its own sub-agent (in parallel, up to
  `max_parallel_subagents`), then each merge to a merge sub-agent, one at
  a time since each merge moves `next`; it checks every result against
  GitHub (review marker and SHA, verdict consistent with open threads, PR
  actually merged) before accepting it. It stays subscribed to every PR
  it sent back for changes: when the author pushes a fix or replies to a
  thread, it re-reviews in the same run (one round at a time per PR, at
  most `max_review_rounds_per_run`, for up to `review_listen_hours`),
  checking each finding against the new head and resolving the thread
  once it's fixed. The builder (or the PR's author) does the fixing. A PR whose latest verdict is approved, with
  no open threads, gets `next` merged in, conflicting migrations
  regenerated on top of next's, and `npm run ci:local` run, then it is
  pushed and squash-merged once GitHub CI is green on that head
  (`release.yml` cuts the release after the merge). At most `max_merges_per_review_run` per
  run. Drafts and PRs labelled `hold` are left alone.
- **Product owner** (`autopilot-product`, weekly) makes the product
  decisions `[!]` items wait on, within the authority AUTOPILOT.md's
  "Product decisions" section delegates (`may_decide` / `never_decide`:
  never money, credentials, new personal data, deletion or the loop's
  own limits). Each decided item becomes a normal buildable item with
  acceptance criteria and a "Decided … by autopilot-product" line; the
  rest get a recommendation in PRODUCT.md's "Owner inbox" and a
  `decision` issue with numbered options, which the owner answers by
  replying with a number or "yes"; the next run applies the answer and
  closes the issue. It also keeps
  PRODUCT.md's "Direction" and "Focus" current; the builder takes Focus
  IDs right after `UX-` items, and scouts don't re-add what its Decision
  log turned down. Output is one `docs(backlog): product decisions` PR
  (BACKLOG.md and PRODUCT.md only) that the reviewer merges unless the
  owner labels it `hold`.
- **Retro** (`autopilot-retro`, weekly) records metrics in
  `docs/autopilot-metrics.md`, turns any mistake seen twice in autopilot
  PRs into a lint rule, test or checklist line, trims instructions nobody
  needed, and only *proposes* loosening limits. The reviewer merges its
  PR unless it touches `never_merge_paths`, which include the autopilot
  skills, so the loop never rewrites its own rules unseen.

Three things keep the owner's part small (AUTOPILOT.md, "Owner inbox"
and "Chaining"):

- **Owner inbox.** The reviewer rewrites one pinned issue, "Owner inbox"
  (label `owner-inbox`), at the end of every run: PRs labelled
  `needs-human`, open `decision` issues, PRs from untrusted accounts and
  anything a routine couldn't do. Every routine report ends with an
  `Owner action needed:` line, and the reviewer, product and retro
  routines send a push notification, so the owner opens GitHub only when
  something needs them. Loop comments carry a `🤖 autopilot-<role>`
  marker; since the routines run as the owner's account, a comment
  without it is the owner's.
- **Chaining.** The reviewer makes sure a builder is working on every
  autopilot PR it asked changes on (or that has red CI or a conflict):
  if no builder holds the run lock, it starts one with a "Fix run" prompt
  naming the PRs and what each needs, whatever the time or gap, so a
  fix never waits for the schedule. It also starts the builder once it
  has merged something, the builder starts the reviewer once it has opened or fixed
  a PR, and the reviewer starts the product owner when a decision issue
  has an answer, via `fire_trigger`, each only when the target wasn't
  started within `chain_min_gap_hours`. A chained run never chains again,
  so each cron run buys at most one follow-up. The cron schedules stay as
  the fallback. `fire_trigger` must be allowed without a prompt in the
  environment, since no one is there to approve it.
- **Flaky tests first.** The release train and the builder file every
  e2e test that both fails and passes on the same commit as a `MAINT-`
  item titled `Flaky: …` (one that fails every time on clean `next` is a
  `BUG-` item instead), and the builder takes one of those before any
  `UX-` item, since `ci:local` has no retry and each flake costs every
  builder a gate re-run. The fix is in the app or the test's waiting,
  never a skip, retry or looser assertion. A release that fails only on
  a known flake re-runs the job instead of reverting a PR.
- **Run lock.** The builder and reviewer each hold a lock for their whole
  run (one open issue labelled `autopilot-lock-<role>`; the lowest open
  number from a trusted account wins, stale ones expire after
  `run_lock_hours`), so a cron run never overlaps a chained or slow one.

Every role works from two outside skill packs with one owner each, so
they never compete (AGENTS.md, "Agent skills"):

- **Superpowers** ([obra/superpowers](https://github.com/obra/superpowers),
  pinned `v7.0.0`) owns the development process: brainstorming, writing
  plans, test-driven implementation, systematic debugging, verification
  and code review. It is installed, not vendored: OpenCode loads it from
  the pin in `opencode.json`, and Claude Code users install the plugin
  once from the official marketplace.
- **pstack** ([backnotprop/pstack](https://github.com/backnotprop/pstack),
  pinned commit `3a60467`) supplies specialist tools, vendored verbatim
  under `.claude/skills/` (Claude Code) and `.agents/skills/` (OpenCode):
  `how`, `why`, `interrogate`, `unslop`, `technical-writing`, `reflect`
  and ten `principle-*` files. They never trigger on their own
  (`disable-model-invocation`) and are called only by ID; the builder
  names `how`, `why` and `interrogate` as aids within AGENTS.md's
  workflow, and the reviewer may `interrogate` a contested design.
  pstack's own process layer (`poteto-mode` playbooks, `tdd`,
  `no-comments`) is left out: it overlaps Superpowers and conflicts with
  this repo's rules (mandatory hand-off to other vendors' models,
  rebasing, stripping explanatory comments). So is `architect`, which
  needs pstack's unvendored `arena`. The skills read their model roles
  from `~/.agents/pstack-models.md`; the web session-start hook installs
  the repo's `.agents/pstack-models.md` there, with every role on
  `inherit-parent`, so the loop runs on the session model.

The builder coordinator is the human proxy for its sub-agents: they
never block on a human. Their normal work (commits, pushes, opening and
fixing their own PR) proceeds and is reported; anything irreversible
beyond that (force-pushing, deleting branches or data, closing a PR)
waits for the coordinator's explicit call.

`AUTOPILOT.md` is the control file every session reads first: on/off
switches per role, limits, which backlog prefixes the builder may pick,
human-only areas (schema, auth, money logic, data deletion, workflows)
and the merge policy. With `auto_merge: reviewer` the reviewer merges;
PRs touching human-only areas get a deeper review rather than a human
merge, except those changing AUTOPILOT.md or `.github/workflows/`
or the autopilot skills (`never_merge_paths`), which a human merges so the loop can't loosen its
own limits. Items marked `[!]` or under "Needs a decision
before building" are never built until decided: by the product owner
routine where AUTOPILOT.md allows it, otherwise by the owner.

### Routine prompts

Each routine starts a fresh session on `next` (the default branch, where
AUTOPILOT.md and the skills are edited) in the household-hub
environment (create with "new session on each run"). The prompts are
deliberately short: the procedure lives in the skills, so it's versioned
with the code and every run starts with a small context. Suggested
schedules are in Stockholm time; minutes are offset from the hour so the
runs don't queue behind everyone else's.

| Routine (exact name; chaining finds it by this) | Schedule (cron) | Prompt |
|---|---|---|
| Autopilot scout: competitors | `CRON_TZ=Europe/Stockholm 52 6 * * *` | Run the autopilot-scout skill with lens `competitors`. Follow AUTOPILOT.md; stop if it disables you. |
| Autopilot scout: code | `CRON_TZ=Europe/Stockholm 48 7 * * 1` | Run the autopilot-scout skill with lens `code`. Follow AUTOPILOT.md; stop if it disables you. |
| Autopilot scout: UX | `CRON_TZ=Europe/Stockholm 48 7 * * 3` | Run the autopilot-scout skill with lens `ux`. Follow AUTOPILOT.md; stop if it disables you. |
| Autopilot scout: dependencies | `CRON_TZ=Europe/Stockholm 48 7 * * 5` | Run the autopilot-scout skill with lens `deps`. Follow AUTOPILOT.md; stop if it disables you. |
| Autopilot scout: production | `CRON_TZ=Europe/Stockholm 44 8 * * *` | Run the autopilot-scout skill with lens `production`. Follow AUTOPILOT.md; stop if it disables you. (Only once a Sentry connector is attached.) |
| Autopilot builder | `CRON_TZ=Europe/Stockholm 47 0,3,6,9,12,15,18,21 * * *` (every three hours, plus chained runs) | Run the autopilot-build skill: delegate a fix for any open autopilot PR that needs one, and delegate every eligible, parallel-safe backlog item the limits allow to its own sub-agent, then validate each PR. Follow AUTOPILOT.md; stop if it disables you. |
| Autopilot reviewer | `CRON_TZ=Europe/Stockholm 17 2,5,8,11,14,17,20,23 * * *` (every three hours, 1.5 h after the builder, plus chained runs) | Run the autopilot-review skill: delegate each open PR's review to its own sub-agent, validate the reviews, merge the PRs that pass, one merge sub-agent at a time, ship the release train and update the Owner inbox. Follow AUTOPILOT.md; stop if it disables you. |
| Autopilot: product owner | `CRON_TZ=Europe/Stockholm 43 8 * * 1` | Run the autopilot-product skill: decide the backlog items AUTOPILOT.md lets you decide, recommend the rest, and update PRODUCT.md's direction and focus. Follow AUTOPILOT.md; stop if it disables you. |
| Autopilot retro | `CRON_TZ=Europe/Stockholm 53 17 * * 0` | Run the autopilot-retro skill for the past 7 days. Follow AUTOPILOT.md; stop if it disables you. |

The existing daily competitive-scan routine is replaced by "Autopilot scout:
competitors", which writes the same dated `GAP-` entries.

## Not yet built / roadmap

Every feature from the original scope, the competitive-analysis roadmap
(Waves 1-2), the Joy Gap backlog, and the maintenance, production-readiness,
UX-consistency, UX-friction and UX-audit passes has been built — each is
documented in its own section above.

**All open work lives in [`BACKLOG.md`](./BACKLOG.md)**, grouped by phase
(Phase 1: no schema change, parallel-safe · Phase 2: one migration each,
sequential · Phase 3: large, own PR · items needing a product decision), with
stable area-prefixed IDs (`AUTO-`, `SCALE-`, `BUDGET-`, `INFRA-`, …). That
includes what used to be listed here as "Deferred": item photos, bank sync,
a native app, social login and true offline support (`INFRA-1`…`INFRA-5`).

When an item ships, document it in the relevant section of this file and
delete it from `BACKLOG.md`. The planning docs that produced the shipped work
are kept in [`docs/archive/`](./docs/archive/) because code comments cite
them by item for design rationale; they're historical and not updated.
