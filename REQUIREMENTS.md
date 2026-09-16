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
- **react-hook-form + Zod** are installed for future complex forms; the
  current auth/inventory/shopping forms use React's `useActionState` +
  native `<form action={...}>` directly, which is enough for their shape.
- Prisma's client generator is the new `prisma-client` (Prisma 7), which
  **requires an explicit driver adapter** — see `src/lib/prisma.ts`
  (`@prisma/adapter-pg`). A bare `new PrismaClient()` throws at runtime.
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
  `cookies()` read within one request instead.
- **Passing translations to Client Components**: the convention is to pass
  the **whole `Dictionary`** (or a named sub-object, e.g.
  `dict.household.invite`) as a `dict` prop — not to hand-pick individual
  translated strings as separate props. This keeps every component's prop
  signature simple and consistent; the payload is trivial (it's just
  strings). `src/lib/i18n/format.ts` exports `format(template, vars)`
  (`"{key}"` interpolation) and `plural(count, { one, other })`, both plain
  functions usable from Server or Client Components, for the handful of
  strings that need a count or a name substituted in.
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
  account and joins in one step. Anyone joining via invite becomes a
  `CONTRIBUTOR` — invites can't grant ownership. The link is always shown
  on-screen for the inviter to copy and send manually; see "Invite email
  delivery" below for the additional option to have it emailed directly.
- **Roles**: `OWNER` is whoever created the household (`signupAction` /
  `createHouseholdAction`); everyone who joins later is a `CONTRIBUTOR`. Both
  roles can fully operate within the household — inventory, shopping lists,
  inviting new contributors, etc. Two actions are owner-only, enforced
  server-side in `src/lib/actions/household.ts` (checked against the
  session's `role`, not trusted from the client):
  - `removeMemberAction` — removes a `CONTRIBUTOR` from the household. Fails
    (returns `{ error }`) if the caller isn't the owner, the target is the
    owner, or the caller targets themselves.
  - `deleteHouseholdAction` — deletes the household and everything in it
    (cascades through every domain table via `onDelete: Cascade`). Fails if
    the caller isn't the owner, or if it's the only household they belong to
    (a user must always have at least one household — see `requireHousehold`'s
    zero-membership redirect). On success it falls back the caller's
    `active_household` cookie to another of their households.
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
the same invitation token the link already points at.
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

## Data model

See `prisma/schema.prisma` for the authoritative version. Summary:

**Inventory & shopping** (built)
- `InventoryItem` — name, category, quantity, unit, `lowStockThreshold`,
  location, `lastKnownPrice`. Low stock = `quantity <= lowStockThreshold`.
  The inventory page (`InventoryClient`) filters client-side (in-memory —
  fine at household scale) by name substring, category, location, and
  status (in/low/out of stock); filter dropdown options come from the
  distinct categories/locations already present in that household's items.
  Adding an item offers previously-used categories/locations via a native
  `<datalist>` (see Conventions) rather than a fixed enum, so it stays
  freeform but self-suggesting.
  - **Expiry/best-before tracking**: an optional `expiresAt` (`DateTime?`),
    set from a native date input on the single-item add/edit form
    (`ItemFormDialog`) only — never by any bulk-add flow (scan queue,
    paste-list, starter kit), since those are rapid multi-item entry paths
    with no natural single date to apply. `getExpiryStatus`
    (`src/lib/inventory/expiry.ts`, pure and unit-tested, mirroring
    `getStockStatus`'s split for the same Server/Client Component reason)
    classifies an item as `"soon"` (within `EXPIRY_WARNING_DAYS`, currently
    3) or `"expired"` (past the date); `ExpiryBadge` renders that next to
    the existing stock-status badge in the inventory table/cards, hidden
    entirely when no expiry is set or it's further out than the window. Also
    feeds a third notification trigger — see "Notification center" below.
- `ShoppingList` / `ShoppingListItem` — a household can have any number of
  shopping lists at once (e.g. a weekly list and a separate big-trip list);
  there's no longer a "one active list" constraint. Each list has a status:
  `ACTIVE` → `COMPLETED` (via `completeShoppingListAction`, one-way) or
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
  guarantee at the point the user considers the list "done". Marking an item
  purchased **increments** the linked inventory item's quantity by the
  purchased amount (and records a `PriceHistory` row if an estimated price
  was given); un-marking it reverses the increment. The dashboard overview
  card sums pending items across every `ACTIVE` list, not just one.
- `PriceHistory` — feeds the (not-yet-built) cost analyzer.
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
    header-spoofing trust boundary `sendInviteEmailAction`'s `absoluteAppUrl`
    already guards against, applied here too.
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
- **Groceries category hook for Task 8**: `findOrCreateGroceriesCategory
  (householdId: string)`, exported from
  `src/app/dashboard/budget/actions.ts`, is the intended lookup for the
  shopping-list → budget expense link (completing a shopping list should
  create/reuse a "Groceries" expense category and log a `Transaction`
  against it). Lookup key: name `"Groceries"` (case-insensitive match),
  `type: "EXPENSE"`, scoped to the household — mirrors
  `findOrCreateInventoryItem` in
  `src/app/dashboard/shopping-list/actions.ts` exactly (find first, create
  if missing). The category name itself (`GROCERIES_CATEGORY_NAME`) is a
  module-private constant, not exported, because a `"use server"` file may
  only export async functions — callers that need the name read it off the
  returned category (`category.name`) rather than importing the constant.
  Like `findOrCreateInventoryItem`, this helper trusts its `householdId`
  argument and does no auth check of its own; every caller must resolve
  that id from its own `requireHousehold()` call first, never from
  client input.
- **Transactions**: `TransactionList` shows date, category (badge tinted
  `text-chart-5`/`text-destructive` for income/expense — the same two
  tokens the summary and amounts use, so the income/expense meaning stays
  visually consistent everywhere on the page), description, and a signed,
  colored amount, with edit/delete per row. Add/edit share one
  `TransactionDialog` component (category select, amount, date,
  description, and a recurring toggle) — editing reuses the same dialog
  with the row's data as `defaultValue`s rather than a second form.
- **Recurring transactions**: `isRecurring` + `recurrenceFrequency`
  (`WEEKLY`/`MONTHLY`/`YEARLY`) on `Transaction` itself are metadata and
  display only — checking "this repeats" on a transaction marks it and
  shows a "Recurring" badge with its frequency in the list. Nothing about
  a single `Transaction` row auto-generates a future one; the flag just
  documents that a logged transaction is one of an expected repeat (e.g.
  rent, a subscription) for the household's own reference.
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
  acknowledging idempotent), or `"due"` (neither yet). `DueRecurringWidget`
  surfaces everything `"due"` in an always-visible strip above the Budget
  page's tabs; the full `RecurringTemplatesPanel` groups templates by all
  three statuses and also handles add/edit/pause (`active: false`, which
  keeps history but stops a template counting as due)/delete. This is
  still not an auto-generating scheduler — nothing ever creates a
  `Transaction` on its own — but it is a genuine per-period due/posted/
  acknowledged tracker, meaningfully more than the display-only
  `isRecurring` flag above. Mirrored for the separate, user-scoped personal
  budget (`prisma/schema.prisma`'s `PersonalBudgetCategory`/
  `PersonalTransaction`) as `PersonalRecurringTemplate`/
  `PersonalRecurringTemplateAck` — not documented further here, as it isn't
  part of this file's original household-budgeting scope.
- **Period summary**: `PeriodSummary` shows the current calendar month
  (`[monthStart, monthEnd)` computed from `new Date()` server-side) —
  income/expense/net totals, plus a per-category breakdown for each with a
  proportional bar cycling through the existing `--chart-1..5` tokens (the
  "small rainbow ... for future charts" REQUIREMENTS already called out).
  All aggregation happens in the page's Server Component (grouping the
  month's transactions by `categoryId`); the summary components themselves
  are plain presentational functions, not Client Components, since nothing
  on them is interactive.
- **No currency symbol**: amounts are formatted with `Intl.NumberFormat`
  (locale-aware decimal separator, always 2 decimals) but no currency
  symbol or code, same as `InventoryItem.lastKnownPrice`/
  `ShoppingListItem.estimatedPrice` elsewhere in the app — there's no
  household-level currency setting, so a symbol would be a guess.

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
- **Price trend per item**: grouped by `inventoryItemId`, an item needs at
  least 3 recorded `PriceHistory` points before it's considered to have
  "enough history to be meaningful" and gets a card — fewer than that and
  a trend line would be noise, not signal. Each qualifying item's card shows
  a small hand-rolled inline SVG polyline (a sparkline, not a library
  chart), its latest recorded price and date, and the percent change from
  its first to its latest recorded price (colored `text-chart-5` when the
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

### Shopping-list → budget expense link

Completing a shopping list (`completeShoppingListAction` in
`src/app/dashboard/shopping-list/actions.ts`) automatically logs a single
"Groceries" expense `Transaction` for that list, on top of its existing
job of link-fixing unlinked items and flipping the list to `COMPLETED`:

- **What gets summed**: every item on the list where `purchased` is true
  and `estimatedPrice` is set (not `null`) — `estimatedPrice` is added
  directly to the running total, unmultiplied by `quantity`, the same way
  `togglePurchasedAction` already treats it when writing a `PriceHistory`
  row. Items without an estimated price are silently skipped rather than
  having a price invented for them; if nothing on the list has a price set,
  no `Transaction` is created at all (there's currently no UI anywhere in
  the app to set `ShoppingListItem.estimatedPrice` on an item — it's only
  ever written by this feature's own reads and by `togglePurchasedAction`'s
  `PriceHistory` write — so in practice this total is 0 unless something
  sets it directly, e.g. a future "estimated price" field on the add-item
  form).
- **Category lookup**: reuses `findOrCreateGroceriesCategory` (see
  "Groceries category hook for Task 8" above) rather than duplicating that
  find-or-create logic — the two features share one household-scoped
  "Groceries" `EXPENSE` category.
- **The `Transaction` created**: `amount` = the summed total, `type` =
  `"EXPENSE"`, `date` = the moment the list was completed (not any
  per-item purchase date, since `ShoppingListItem` doesn't track one),
  `description` = `From "{list name}"` (translated, built with
  `format()`), `createdByUserId` = the household member who clicked
  "Complete list". Not run inside the same `$transaction` as the list's
  `status` update to `COMPLETED`, since `findOrCreateGroceriesCategory`
  takes a plain `prisma` client rather than a transaction client and
  duplicating its lookup just to fit inside one transaction would violate
  the point of reusing it — matches this file's existing style of doing
  find-or-create lookups (e.g. `findOrCreateInventoryItem` in
  `addAdHocItemAction`) as plain sequential calls, not wrapped.
- **Feedback**: `completeShoppingListAction` returns
  `{ expenseLoggedMessage?: string }` (a change from its previous `void`
  return) built server-side from the `shoppingList` dictionary
  (`expenseLogged`, interpolating a locale-formatted, currency-symbol-free
  amount via `Intl.NumberFormat` — same convention as the rest of
  Budgeting) so the client stays dumb. `ShoppingListClient`
  (`src/components/shopping/shopping-list-client.tsx`) awaits the action
  inside its existing `useTransition` click handler and shows a `sonner`
  toast when a message comes back; nothing is shown when the total was 0.
  No new settings/toggle to disable this — it's the intended default
  behavior, not optional.

### Safe to spend

A hero stat card at the top of the Budget page's Overview tab, directly
above `PeriodSummary` (`SafeToSpend`, `src/components/budget/safe-to-spend.tsx`)
— the PocketGuard-style "what's actually left" number, per the competitive
analysis. Like `PeriodSummary`/`CostAnalyzer`, it's a plain presentational
component; all aggregation happens in `src/app/dashboard/budget/page.tsx`,
which delegates the actual math to a pure, dependency-free
`computeSafeToSpend` function in the colocated
`src/app/dashboard/budget/safe-to-spend-calc.ts` (unit-tested in
`safe-to-spend-calc.test.ts` — no Prisma import, so no mocking needed) rather
than inlining it, since a Server Component page function can't itself be
unit-tested.

- **The headline number**: this month's income so far minus this month's
  expenses so far (the same `[monthStart, monthEnd)` totals `PeriodSummary`
  already computes from the page's one `transaction.findMany` query) minus
  an estimate of recurring expense categories that haven't posted a
  transaction yet this month (below).
- **The recurring-expense estimate**: for every `EXPENSE`-type
  `BudgetCategory` with at least one `isRecurring` transaction dated before
  the current month, check whether that category already has *any*
  transaction dated in the current month. If it does, it's assumed
  posted/accounted for and contributes nothing to the estimate. If it
  doesn't, the amount of that category's most recent recurring transaction
  (by `date`) is treated as "expected but not yet logged" and subtracted
  from the headline number. This is a best-effort heuristic, not a
  scheduler: `computeSafeToSpend` (`src/app/dashboard/budget/
  safe-to-spend-calc.ts`) only ever looks at `Transaction.isRecurring`, so
  it can't know a bill isn't due yet vs. simply not entered; a one-line
  caveat under the headline number says so explicitly. It deliberately
  doesn't use the separate `RecurringTemplate` due/posted/acknowledged
  system (see "Recurring budget templates" above) — that system already
  distinguishes "due" from "acknowledged"/"posted" per period, which would
  make a better signal than this heuristic, but wiring the headline number
  to it wasn't part of this feature's own pass.
- **The breakdown**: beneath the headline number, a small list of every
  category counted into the estimate (name + its expected amount, tinted
  `text-destructive` like every other expense amount on the page) so the
  number isn't a black box — e.g. "Rent  –1,200.00". Hidden entirely when no
  category qualifies (nothing recurring, or everything recurring has
  already posted this month).
- Same no-currency-symbol `Intl.NumberFormat` convention as the rest of
  Budgeting; the headline number is colored `text-chart-5` (safe/positive)
  or `text-destructive` (negative — spending is on track to exceed income)
  the same way `PeriodSummary`'s net figure is.

### Household expense splitting

Lets a `Transaction` optionally record who paid and how its cost is
divided among household members (Splitwise's pattern) — opt-in per
transaction, so a transaction with no split behaves exactly as it always
has. Two new Prisma models/fields, added via a hand-written migration
(`prisma/migrations/20260905120000_add_transaction_splits/`) since this is
a real schema change, unlike the schema-free Wave 1 tasks:

- **`Transaction.paidByMemberId`** (`String?`, `onDelete: SetNull` on its
  `HouseholdMember` relation) — which member fronted the money. `SetNull`
  rather than `Cascade`: the transaction itself must survive its payer
  later leaving the household, the same tradeoff
  `RecipeIngredient.inventoryItemId` already makes for a similar
  optional-info relation.
- **`TransactionSplit`** — one row per member included in a split
  transaction's cost share (`transactionId`, `householdMemberId`,
  `amountOwed`), unique per `(transactionId, householdMemberId)`. No
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

**Recording a split** (`TransactionDialog`,
`src/components/budget/transaction-dialog.tsx`): only offered when the
household has more than one member (`members.length > 1`, fetched by
`src/app/dashboard/budget/page.tsx` alongside categories/transactions). A
"Split this expense" checkbox reveals a "Paid by" select (defaulting to
the signed-in user's own membership) and one amount input per household
member, defaulting to an even split of the transaction's amount
(`evenSplitAmounts` in `src/components/budget/split-amounts.ts` — a pure,
unit-tested cents-based helper so the shares always sum exactly to the
total instead of drifting from naive floating-point division) via a "Split
evenly" reset button, individually adjustable afterward. The dialog shows
a live mismatch warning and disables submit whenever the per-member
amounts don't (yet) sum to the transaction total; `createTransactionAction`/
`updateTransactionAction` (`src/app/dashboard/budget/actions.ts`)
re-validate the same invariant server-side (`parseSplitFormData`, ±0.01
floating-point tolerance) plus that every referenced member id actually
belongs to the caller's household, the same "never trust a client-supplied
id beyond re-checking it" rule every other action in this file follows.
Editing an existing split transaction pre-fills every field from its
current `TransactionSplit` rows and replaces them wholesale on save
(delete-all then recreate in one `$transaction`), the same convention
recipe-ingredient editing already uses. `TransactionList`
(`src/components/budget/transaction-list.tsx`) shows a "Split" badge
(hover tooltip naming the payer) next to a split transaction's category
badge.

**"Who owes whom"** (`HouseholdBalances`,
`src/components/budget/household-balances.tsx`) — a third `BudgetTabs` tab,
"Balances", shown only when the household has more than one member
(chosen over the Household page: the view is derived entirely from
`Transaction`/`TransactionSplit` data the Budget page already scopes and
fetches, and this keeps the Household page, not a primary file for this
task, untouched). Like `PeriodSummary`/`CostAnalyzer`/`SafeToSpend`, it's a
plain presentational component; all netting and debt-simplification logic
is pure and unit-tested in the colocated
`src/app/dashboard/budget/settle-up-calc.ts`:

- `computeNetBalances` nets every split transaction to one balance per
  member — the payer's balance increases by the full amount, every member
  with a split on that transaction (payer included) has their balance
  reduced by their own share, so a payer's own share nets out to what
  they're actually owed by everyone else.
- `simplifyDebts` then applies Splitwise's debt-simplification pattern
  (greedily matching the largest debtor against the largest creditor) to
  reduce those balances to the **minimum number of settle-up transfers**,
  not a raw list of every individual split — e.g. if Alice paid for
  everyone and Bob separately paid Carol back for something unrelated, the
  view nets straight to "Bob owes Alice X", never surfacing Carol at all
  once her balance is zero.
- The view is read-only for this pass — no "mark as settled" persistence
  was added. The task's own scope note describes a manual settle-up action
  only as an example of what a *future* pass could add ("a note or a
  zeroing transaction... no payment integration of any kind"), and the
  feature's actual goal is to *surface* the net balance view; adding a new
  table/action for recording settlements would be scope creep beyond that.

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
    should invalidate the session that changed it.

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
make reachable to anyone with household access). That export isn't detailed
further here, as it isn't part of this section's original CSV-export scope.

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
  estimated price, purchased yes/no); the budget export is every
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
  rest of the app's currency-symbol-free `Intl.NumberFormat` convention,
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
  Still calls `requireHousehold()` first, matching every other action in
  this app's "never a reachable, unauthenticated Server Action" convention,
  even though the household id itself isn't used for anything here.
- **Privacy**: the camera stream and every captured frame stay entirely
  client-side — decoding happens locally via the WASM decoder, and no
  frame or image is ever sent anywhere. The only thing that reaches the
  network is the decoded barcode's digits, sent straight to Open Food
  Facts's product endpoint.
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
  - Nothing about a scan is ever persisted — there's no barcode column on
    `InventoryItem`/`ShoppingListItem` and no migration for this task; the
    scanned number only exists in the form's local state to pre-fill the
    name and show the reference line, exactly like the recipe-import
    feature's "pre-fill, then let the user review/submit normally" shape.
- **i18n**: all new strings live in a new shared `barcodeScanner` dictionary
  namespace (`en.ts`/`sv.ts`) rather than being duplicated into `inventory`
  and `shoppingList`, since the component and its copy are identical in
  both places.

## Receipt scanning

A "Scan receipt" button on an active shopping list's detail page
(`ReceiptScanDialog`, `src/components/shopping/receipt-scan-dialog.tsx`,
wired into `ShoppingListClient`) lets a household member photograph a paper
receipt after a shop and, in one step, mark every matched list item
purchased with its actual price — instead of pricing and checking off each
item by hand. This is what feeds `PriceHistory` (and therefore the budget's
Cost analyzer and Groceries expense on list completion) in the common case,
so it directly serves "keep track of household spending".

- **This was flagged as needing a paid vendor — it doesn't.** "Not yet
  built" previously bucketed receipt OCR with bank-sync and social login as
  needing a third-party account the product owner would have to provision.
  That assumption held for cloud OCR vendors (Google Vision, AWS Textract,
  ...), but **Tesseract.js** (npm, v7, MIT-derived/Apache-2.0, a WASM port
  of the Tesseract OCR engine) runs entirely client-side with no API key,
  no account, and no per-scan cost — so this shipped as a normal task
  instead of staying deferred.
- **OCR flow**: the "Scan receipt" button is a plain `<Button>` that clicks
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
- **Currency conversion**: there's no per-household currency setting
  anywhere in the schema — every amount in this app is a plain `Float` — so
  `HOUSEHOLD_BASE_CURRENCY` (`src/lib/currency.ts`, currently `"SEK"`) is a
  single fixed constant rather than a new setting. If a receipt's detected
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
- **Applying a scan** (`applyReceiptScanAction`): for every confirmed line,
  sets the shopping-list item's `estimatedPrice` (converted) and marks it
  `purchased`, then mirrors `togglePurchasedAction`'s existing side effects
  — bumping the linked inventory item's quantity and recording a
  `PriceHistory` row — just batched across every scanned line in one
  transaction instead of one checkbox at a time. De-dupes by
  `shoppingListItemId` server-side (in case two OCR'd lines were ever
  matched to the same item) so nothing is double-counted.
- **Privacy**: exactly the same stance as barcode scanning — the receipt
  photo is only ever read by the client-side OCR worker and never uploaded
  anywhere; the server only ever receives the extracted item names, prices,
  and currency the user has already reviewed.
- **i18n**: all new strings live under `shoppingList.receiptScan` in
  `en.ts`/`sv.ts`.

## AI shelf scan (beta)

A "Scan a shelf" button (with a "Beta" badge, `AiShelfScanDialog`,
`src/components/inventory/ai-shelf-scan-dialog.tsx`) on the Inventory page
toolbar (`src/app/dashboard/inventory/page.tsx`) lets a household member
photograph a shelf, fridge, or cupboard and have AI guess the items on it
and how many — reviewed and corrected before anything is added, same
"AI/OCR suggests, human confirms" shape as barcode scanning and receipt
scanning above. Marked beta because vision-based counting is inherently
approximate (packaging occludes items, similar products get merged or
split) in a way this app's other scan features aren't.

- **Genuinely unlike barcode/receipt scanning on privacy**: those two never
  send the camera image anywhere — decoding/OCR both run entirely
  client-side. There's no equivalent client-side model for "what groceries
  are in this photo", so this feature's photo **is** uploaded to a
  third-party API for analysis. The dialog says so before the camera opens,
  and the photo itself is never persisted anywhere (not written to disk,
  not stored in the database) — only the reviewed name/quantity guesses
  are, exactly like the other two features' review step.
- **Two providers, ordered at runtime, with mid-scan fallback**
  (`scanShelfPhotoAction`, `src/lib/actions/inventory-scan.ts`):
  `resolveProviders()` returns **Gemini** (Google AI Studio,
  `generativelanguage.googleapis.com`) when `GEMINI_API_KEY` is set,
  followed by **Anthropic** (Claude) when `ANTHROPIC_API_KEY` is set — an
  empty list means the feature reports itself unconfigured. Gemini goes
  first because its free tier (no card required) makes this feature
  genuinely free to run at a single-household scale, where Anthropic's is
  metered from the first request — see `.env.example` for both. When
  *both* are set, `callProviders` doesn't just pick Gemini and stop: if it
  reports itself busy (`provider_busy` — see the retry section just below)
  and there's still time left in the shared request deadline, it falls
  through to Anthropic next rather than failing the scan, since Gemini's
  free tier is meaningfully more prone to overload than a paid API. A real
  analysis failure (bad response shape, non-JSON output, ...) does **not**
  fall through to the next provider — that's worth surfacing, not papering
  over by trying a different vendor. Both providers are called directly
  via `fetch` (no SDK dependency added, matching this app's existing
  fetch-a-JSON-API convention in `lookupBarcodeAction`/`fetchExchangeRate`),
  each constrained to the same `{ items: [{ name, quantity }] }` output
  shape — Anthropic via a forced `report_shelf_items` tool call, Gemini via
  `responseSchema`-constrained JSON output (Gemini has no
  forced-tool-choice equivalent) — and validated through the same Zod
  schema either way, so the rest of the action and the whole review UI stay
  provider-agnostic. Without either key set, the dialog explains the
  feature isn't configured instead of erroring after a photo is taken, same
  fails-gracefully pattern as `RESEND_API_KEY`/`VAPID_PRIVATE_KEY`.
  Rate-limited per household (`checkRateLimit`, 20/hour) since a scan
  against Anthropic costs real money — on Gemini's free tier, Google's own
  per-minute cap binds first.
- **Transient-failure retry**: both providers occasionally reject a request
  with a fast "the model is overloaded, try again" (Gemini: `503
  UNAVAILABLE`, commonly hit on the free-tier Flash model under load;
  Anthropic: `529 overloaded_error`) or plain rate limiting (`429`) rather
  than a real failure. Each provider function retries once after a short
  delay on exactly those statuses (`RETRYABLE_STATUS`,
  `inventory-scan.ts`) — matching Google's own documented guidance for the
  503 case — before surfacing a distinct `provider_busy` error ("The AI
  service is busy right now") instead of the generic failure message.
  `REQUEST_TIMEOUT_MS` is 50s (a live test measured ~40s for one
  successful Gemini free-tier call, comfortably past a shorter timeout)
  and is shared as one deadline across every attempt in a call — before
  actually retrying, each provider function checks `deadlineAt - Date.now()`
  against `MIN_RETRY_BUDGET_MS` (15s) and skips straight to `provider_busy`
  if a second attempt couldn't realistically finish in what's left, rather
  than starting one doomed to be aborted mid-flight. That shared deadline
  firing itself (a first attempt slow enough to eat the whole budget) is
  caught in `scanShelfPhotoAction` as a plain `AbortError` and mapped to
  the same `provider_busy` message, not the generic failure — the raw
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
between "Planner" and "Recipes" — no new route needed for the split) covers
the `Recipe` / `RecipeIngredient` / `MealPlan` / `MealPlanEntry` models:

- **Recipes**: full CRUD (`createRecipeAction` / `updateRecipeAction` /
  `deleteRecipeAction` in `src/app/dashboard/meal-planning/actions.ts`) — a
  name, optional freeform instructions, and any number of ingredient rows
  (name + quantity + unit) added/removed client-side in
  `RecipeFormDialog` before submit. Editing replaces every ingredient row in
  a `$transaction` (delete-all then recreate) rather than diffing, which is
  simpler and fine at this scale (a handful of ingredients per recipe).
- **Ingredient → inventory linking**: mirrors the shopping list exactly —
  every ingredient with a name gets find-or-create-matched (case-insensitive,
  scoped to the household) to an `InventoryItem` via a local copy of the
  `findOrCreateInventoryItem` pattern from
  `src/app/dashboard/shopping-list/actions.ts` (duplicated rather than
  imported, since the two features are owned by independent worktrees/tasks
  and shouldn't be coupled through a shared internal helper). This happens
  automatically on every save — there's no "link to inventory?" toggle in
  the UI, same as shopping list items.
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
- **Assigning a meal**: `addMealEntryAction` assigns either an existing
  `Recipe` (picked from a `Select`) or a freeform meal name
  (`MealPlanEntry.freeformName`, when the special "Custom meal…" option is
  chosen) to a date + `MealType` slot. There's no uniqueness constraint on
  `(date, mealType)` — multiple entries can stack in one slot (e.g. two
  snacks), matching the schema.
- **No in-place edit for meal entries** — only add (`addMealEntryAction`)
  and delete (`deleteMealEntryAction`), consistent with the app's existing
  simplicity elsewhere (shopping list items are add/toggle/delete too, no
  edit). Fixing a wrong entry means deleting it and adding the right one.
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
  - If no Recipe JSON-LD is found, or the node found has no usable
    name/ingredients/instructions, `parseRecipeFromHtml` returns `null` and
    the action surfaces `dict.mealPlanning.importErrorNoRecipeFound` — this
    is expected to happen on plenty of real-world pages (Microdata-only
    sites, or sites with no structured recipe data at all), not treated as a
    bug.
- **SSRF guard**: this is a server-side fetch of a user-supplied URL, so
  `validateRecipeUrl` (pure) rejects anything that isn't `http:`/`https:`,
  `localhost`/`*.localhost`, and an IP-literal hostname in a
  private/loopback/link-local/reserved range (checked via small CIDR-range
  helpers for both IPv4 and IPv6, including IPv4-mapped IPv6 addresses).
  `fetchRecipeHtml` additionally resolves the hostname with `dns.lookup`
  before connecting and re-checks every resolved address the same way —
  guarding against DNS rebinding, which a literal-hostname check alone
  can't catch — and does this again on every redirect hop, since redirects
  are followed manually (`redirect: "manual"`) specifically so each one can
  be re-validated before being followed rather than trusting `fetch`'s
  automatic redirect handling. The response body is read via a capped
  streaming reader (3MB) rather than buffered in full, and the whole fetch
  has an 8s timeout via `AbortController`. None of this network-dependent
  code is exercised by `recipe-import.test.ts` (per the "no real network
  calls in tests" rule) — only the pure parsing and pure URL-scheme/
  IP-literal validation are unit-tested.
- **Feedback**: `importRecipeFromUrlAction` returns `ImportRecipeState`
  (`ActionState & { recipe?: {...} }`, following the same
  `(prevState, formData) => Promise<State>` shape as every other
  `useActionState`-bound action in this file) with a translated `error`
  string on failure or the parsed `recipe` on success; `RecipeFormDialog`
  shows a translated success line ("Imported — review the fields below,
  then save.") rather than closing the dialog, since the point is manual
  review before saving.

### Meal-plan → shopping-list bridge

An "Add missing ingredients to shopping list" button
(`MissingIngredientsDialog`, `src/components/meal-planning/missing-ingredients-dialog.tsx`)
sits next to the "This week" control in the weekly planner
(`WeekPlanner`), scoped to the whole visible week — the simplest option per
the task spec, and the pattern every competitor researched (Mealime,
Paprika, Plan to Eat, Whisk) uses:

- **Diffing**: opening the dialog calls `previewMissingIngredientsAction`
  (`src/app/dashboard/meal-planning/actions.ts`), a read-only preview — no
  rows are written until the user commits. It collects every
  `MealPlanEntry` with a `recipeId` in that week's `MealPlan` (freeform
  entries have no ingredients and are skipped via `recipeId: { not: null }`),
  gathers each recipe's `RecipeIngredient` rows, and resolves each to its
  linked `InventoryItem`. `RecipeIngredient.inventoryItemId` is normally
  always set (every ingredient is find-or-create-linked at recipe-save
  time — see "Ingredient → inventory linking" above), but the relation is
  `onDelete: SetNull`, so a since-deleted inventory item can leave one
  unlinked; that case falls back to the same case-insensitive name match
  `findOrCreateInventoryItem` uses everywhere else, against a fresh query of
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
  before.
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
  `createShoppingListAction` does), then find-or-create-links each checked
  ingredient to an `InventoryItem` (`findOrCreateInventoryItem`, the
  existing pattern already duplicated into this file — not invented here)
  and adds it as a `ShoppingListItem` with `addedAutomatically: true`. Items
  already pending (unpurchased) on the target list are skipped rather than
  duplicated, mirroring `generateFromLowStockAction`'s existing dedupe in
  `src/app/dashboard/shopping-list/actions.ts`. On success the dialog closes
  and a `sonner` toast confirms which list the items were added to.

### Mark meal as cooked → inventory decrement

A "Mark as cooked" button (`MarkCookedDialog`,
`src/components/meal-planning/mark-cooked-dialog.tsx`, a `ChefHat` icon
button next to `MealEntryRow`'s delete button in `WeekPlanner`) lets a
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
  same `expandRecipeIngredients` call and `portions / servings` multiplier
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
  and in the same dimension. A row that still doesn't reconcile (an
  unrecognized unit, or one from a different dimension) is flagged
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
  Deleting the meal-plan entry afterward doesn't reverse the decrement
  either, for the same reason.

## Household tasks

`/dashboard/tasks` (`TasksClient`) — "Household Tasks v1", built from
[`JOY_GAP_BACKLOG.md`](./JOY_GAP_BACKLOG.md) item 6, the one Joy Gap ticket
that closes an actual product gap (a shared task list) rather than a tone
change. One flat, shared `HouseholdTask` list per household — deliberately
**not** a chore-chart/points/rewards system like Tody or OurHome: no due
dates, no recurrence, no per-person scoring or leaderboard, in v1 or planned.
Squirrel's audience is adult household co-managers, not kids earning
rewards.

- **Model**: `HouseholdTask` (`householdId`, `title`, nullable
  `assignedToMemberId`, nullable `completedAt`, nullable
  `completedByMemberId`). `completedAt` is a nullable-timestamp-as-status
  (not a boolean/enum), mirroring `MealPlanEntry.consumedAt`.
  `assignedToMemberId`/`completedByMemberId` are two independent, both-
  nullable fields — a task can be completed by someone other than whoever
  it was assigned to, and an unassigned task can still be completed. Both
  use `onDelete: SetNull` (never `Cascade`), the same tradeoff
  `Transaction.paidByMemberId` makes: a member leaving the household
  unassigns/un-attributes their tasks rather than deleting task history.
- **Actions** (`src/app/dashboard/tasks/actions.ts`): `createTaskAction`,
  `toggleTaskCompletedAction` (flips `completedAt` between `null` and
  `new Date()`, always attributing completion to the *caller's own*
  household-member id — never a client-supplied one), `deleteTaskAction`.
  No dedicated edit/re-assign action in v1 — delete and re-add instead.
- **UI**: one add-task form (title + optional assignee picker) and a flat
  list split into open/completed sections, matching
  `ShoppingListClient`'s shape. An unassigned task shows a neutral
  "Unassigned" badge; a completed task credits its completer by name, never
  a count.
- **Weekly recap**: `src/app/dashboard/tasks/weekly-recap-calc.ts`
  (`computeWeeklyTaskRecap`) groups the current Monday-start week's
  completed tasks by completer, in first-appearance order — **never** sorted
  or labeled by per-person count, which would read as a leaderboard. A quiet
  week renders nothing (`TasksWeeklyRecap`, dismissible, mirrors
  `MealVarietyRecap`'s shape exactly), same non-goal as the meal-planning
  variety recap.
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

## Theming

The app supports light, dark, and system themes via **next-themes**
(`ThemeProvider attribute="class" defaultTheme="dark" enableSystem` in
`src/app/layout.tsx`), which toggles a `light`/`dark` class on `<html>` and
handles the flash-of-wrong-theme problem itself (an inline script sets the
class before first paint, reading its own `localStorage` key — this is the
same technique, and it's the reason `<html>` has `suppressHydrationWarning`
and no longer hardcodes a `dark` class). Existing users default to `dark`
(the app's original look); new visitors can pick any of the three. The
toggle is `useThemeCycle()` (`src/components/theme/use-theme-cycle.ts`),
cycling light → dark → system, used in the sidebar (desktop) and bottom
nav's "More" menu (mobile) — see "Navigation & responsive layout".

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
  a small lift-on-hover/press-down-on-active motion; `Input` has a slightly
  thicker (`border-2`) border that tints toward `--ring` on hover. These are
  defined once in `src/components/ui/button.tsx` / `input.tsx` — every usage
  inherits them automatically, so don't override with one-off `shadow-none`
  or `border` tweaks unless a specific screen genuinely needs a quieter
  control.

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
- Because middleware already redirects logged-in visitors away from `/`,
  `src/app/page.tsx` does **not** duplicate that check with its own
  `auth()` call — don't re-add one there; it'd be a second session lookup
  for a redirect that can never fire.

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
  isn't part of the bottom bar.
- `src/app/dashboard/layout.tsx` is the one place that calls
  `getDictionary()`/`getLocale()` for the whole dashboard shell and passes
  `dict`/`locale` down into `Sidebar`, `BottomNav`, and `HouseholdSwitcher`;
  individual dashboard pages fetch their own `dict` for their own content
  (see "Internationalization" on why each Server Component fetches
  independently rather than prop-drilling from one root call).

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

Exactly three triggers exist — nothing else creates a notification:

- **Out of stock**: an existing `InventoryItem`'s quantity crossing from
  `> 0` to `<= 0`. `recordOutOfStockTransition` (`src/lib/notifications.ts`)
  is called, with the item's before/after quantity, from every Server Action
  that can *decrease* an already-existing item's quantity —
  `adjustQuantityAction`, `markItemEmptyAction`, `updateInventoryItemAction`,
  `bulkUpdateFieldAction` (when editing the `quantity` field),
  `markMealEntryCookedAction` (per ingredient, inside its `$transaction`),
  and `togglePurchasedAction` (un-marking a shopping-list item as purchased
  puts its quantity back down). It only fires on the crossing itself — a
  further decrease while already at zero, or a decrease that doesn't reach
  zero, is a no-op — and it's deduped against any already-active
  (undismissed) alert for the same item.
  - **Deliberately never fires on item creation.** `createInventoryItemAction`,
    `quickAddInventoryItemAction`, `addStarterKitItemsAction`,
    `findOrCreateInventoryItem` (meal-planning ingredients and shopping-list
    items), and `createInventoryItemFromShoppingListItemAction` all can
    create a brand-new `InventoryItem` at quantity 0 (e.g. an ingredient
    auto-linked the moment a recipe is saved, or a manually added item left
    at its default) — none of them call `recordOutOfStockTransition`. A new
    item starting empty is not a depletion event, and flagging it would just
    be noise every time someone adds a recipe or a pantry item.
- **Meal not logged**: a past `MealPlanEntry` whose `consumedAt` is still
  null — a nudge that "mark as cooked" was probably forgotten. There's no
  background job for this: `getActiveNotifications` (`src/lib/notifications.ts`)
  lazily syncs it on every fetch, finding entries with `date` before today,
  `consumedAt: null`, and no `Notification` row yet, and creating one for
  each. The `Notification.mealPlanEntryId` unique constraint makes this
  fire **at most once per entry, ever** — once created, dismissed or not,
  it's never recreated, so ignoring it doesn't turn it into a repeating
  nag.
- **Expiring soon**: an in-stock `InventoryItem` (`quantity > 0`) with
  `expiresAt` set, within `EXPIRY_WARNING_DAYS` (3) of that date or already
  past it. Synced lazily the same way "meal not logged" is — every
  `getActiveNotifications` call runs `syncExpiringSoonNotifications`, which
  finds qualifying items and creates an `EXPIRING_SOON` `Notification` for
  each. Deduped like out-of-stock (an application-level check for an
  existing undismissed alert for the same item), not a DB unique constraint
  like meal-not-logged — a unique constraint on `inventoryItemId` would
  permanently block a future alert for an item that gets re-stocked with a
  new expiry date after the old alert was dismissed.
- All three triggers are intentionally narrow. The old design's "low stock" alert
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
  and passes the resulting list down into both `Sidebar` and `BottomNav` as a
  `notifications` prop, the same pattern used for `dict`/`locale`.
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
  entry's date), reusing that page's existing `?week=` param. The inventory
  page/`InventoryClient` reads an `initialStatus` prop from the `status`
  search param (`src/app/dashboard/inventory/page.tsx`) so the status filter
  can be preset on navigation.

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
  fallback copy before/if it never does. The standalone-mode and iOS checks
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
  - **Delivery**: `sendPushToHousehold` (`src/lib/push.ts`) fans a payload
    out to every push subscription belonging to every member of a
    household. It's called from the **exact same two triggers** as the
    in-app notification bell above — `recordOutOfStockTransition` and
    `syncMealNotLoggedNotifications` in `src/lib/notifications.ts` — nothing
    else sends a push. Both call sites fire it without awaiting (`void
    sendPushToHousehold(...)`) since some of them run inside a Prisma
    `$transaction`, and holding that open for a network call isn't worth
    it — Push API delivery has no delivery guarantee either way, so losing
    a send if the surrounding write later rolls back is an acceptable
    trade. A 404/410 response (the browser revoked/expired that
    subscription) deletes the `PushSubscription` row so delivery stops
    retrying it; any other error is just logged.
  - **Showing it**: `src/lib/service-worker.js` only implements two
    listeners — `push` (shows the notification via
    `registration.showNotification`, with `{ title, body, url }` as sent)
    and `notificationclick` (closes it and opens `url`, mirroring
    `notificationHref()` in `notification-bell.tsx`). It has no `fetch`
    handler and does no caching — it exists purely to deliver push, not for
    offline support (see "Deferred" below).

## Conventions

- Server Actions live next to the routes that use them
  (`src/app/dashboard/<feature>/actions.ts`) or in `src/lib/actions/` when
  shared across routes (auth, household). Every action re-derives the
  household from the session via `requireHousehold()` — never accepts a
  household id from the client.
- Actions bound to a `<form>` follow the `(prevState, formData) =>
  Promise<ActionState>` shape (`ActionState = { error?: string }`) for use
  with `useActionState`. Actions triggered by a plain click (toggle, delete,
  quantity +/-) are called directly from a `useTransition` callback instead.
- Auth.js `signIn`/`signOut` calls that redirect must not be wrapped in a
  `try/catch` that swallows the redirect — only catch `AuthError` specifically
  and re-throw everything else (see `src/lib/actions/auth.ts`).
- All new user-facing text goes through the `dict` prop (English + Swedish)
  — see "Internationalization". Don't hardcode strings in JSX.
- Base UI's `<Select.Value>` (`SelectValue` in `src/components/ui/select.tsx`)
  renders the raw selected `value` as text by default — it does **not** look
  up the matching `SelectItem`'s label. Any `Select` whose `value`s aren't
  already human-readable (e.g. a sentinel like `"__all__"` for "All
  categories") needs an explicit `children` render function on `SelectValue`
  mapping value → label (see `InventoryClient`'s filter selects), or it'll
  silently render the sentinel/id instead of the intended text.

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
    missing or stale, plus the zero-session/zero-membership redirects).
  - `src/lib/actions/auth.ts` and `src/lib/actions/household.ts` — the Zod
    schemas in these files (`signupSchema`, `joinSignupSchema`,
    `createHouseholdSchema`) are module-private, so they're exercised
    indirectly through the exported Server Actions that use them
    (`signupAction`, `loginAction`, `createHouseholdAction`,
    `joinViaInviteSignupAction`): each schema's validation-error paths, plus
    one success path per action.
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

## Not yet built

Every feature from the original scope is now built. The autonomous agent
build/improve loop itself is intentionally not set up yet — that's a
deliberate separate step now that a real test suite exists to gate it on.

## Roadmap

Prioritized from the competitive analysis in [`Analyis_Comp.MD`](./Analyis_Comp.MD)
(researched Sept 2026 against 23 competing shopping-list/pantry/meal-planning/
budgeting apps). Full task specs, ground rules, and worktree coordination
mechanics are in [`AGENT_TASKS_PHASE2.md`](./AGENT_TASKS_PHASE2.md) — this
section just tracks status. Each task appends its own subsection here (same
convention as the original build — see `AGENT_TASKS.md`) once landed, and is
removed from this list when done.

### Wave 1 — independent, no schema migration needed, built in parallel

All five Wave 1 tasks have landed — see their own sections above (Meal
planning's "Meal-plan → shopping-list bridge" and "Recipe import from URL"
subsections, "Notification center", "Data export (CSV)", and Budgeting's
"Safe to spend" subsection).

### Wave 2

Both Wave 2 tasks have landed — see "Barcode scanning" above and Budgeting's
"Household expense splitting" subsection below. Every roadmap item from the
competitive analysis has now been built.

### Deferred — needs an infrastructure or product decision first, not started

- **Item photos on inventory** — needs a blob-storage decision (S3/Vercel
  Blob/Cloudinary/etc.); this app deliberately has zero file-storage
  infrastructure today (see the Profile avatar section's rationale for why
  that was avoided) and shouldn't gain one ad hoc inside an unrelated task.
- **Bank/account sync, native mobile app, social login (Google/Apple)** —
  all clearly valuable per the competitive analysis, but each needs a paid
  third-party service or developer credentials only the product owner can
  provision (a Plaid account, app store enrollment, an OAuth consent
  screen). Flagged for a future decision, not started here. (Receipt OCR
  was in this bucket too, on the assumption it needed a paid vendor — see
  "Receipt scanning" below for why that turned out not to be true.)
- **True offline support** — PWA *installability* and *push notifications*
  are both built now (see "PWA install & push notifications" above), but
  neither gives the app any ability to work with no connection:
  `src/lib/service-worker.js` only listens for `push`/`notificationclick`,
  with no `fetch` handler or Cache API usage, so nothing is actually cached
  for offline use — a page navigation or Server Action with no network still
  just fails. Caching app-shell assets and/or data for real offline use is
  a bigger, separate decision (what's safe to serve stale — e.g. inventory
  counts — vs. what must always be fresh, like auth) that installability
  and push didn't need to make, so it's still deferred.

### Joy Gap backlog — Sep 2026

Every roadmap item above is feature parity; every one has landed. A
follow-up positioning memo ("The Joy Gap," Sep 2026) found the remaining
gap is no longer functional but emotional — see
[`JOY_GAP_BACKLOG.md`](./JOY_GAP_BACKLOG.md) for the resulting tickets
(designer + developer handover, waved and status-tracked the same way as
`MAINTENANCE_BACKLOG.md`). Waves 1-3 (items 1-6, ending with "Household
Tasks v1" — see "Household tasks" above) have all landed; item 6d
(a tasks-cleared bell notification) was evaluated and deliberately deferred
rather than built — see that section's note.
