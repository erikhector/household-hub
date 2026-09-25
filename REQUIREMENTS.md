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
    (a user can't give up their last household on their own — though an
    owner removing them can still leave them with none; see "Users with no
    household" below). On success it falls back the caller's
    `active_household` cookie to another of their households.
  - Everything else on the Household page is open to both roles, including
    the "Shopping" auto-add setting (`setAutoAddLowStockToListAction`,
    AUTO-8) — day-to-day shopping behaviour, not administration.
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
      when stock *arrives* — a shopping-list item checked off
      (`togglePurchasedAction`), a receipt scan applied or a receipt
      registered (`applyReceiptScanAction`/`registerReceiptAction`), or a
      batch landing via the scan queue/paste-list
      (`bulkCreateInventoryItemsAction`) — an item with a known shelf life
      gets an *estimated* `expiresAt`, flagged by `expiresAtEstimated`
      (`Boolean @default(false)`). `InventoryItem.shelfLifeDays` (`Int?`)
      is `null` to use the category default, a positive number as a
      per-item override, or `-1` (Grocy's convention) to permanently opt
      the item out — the item form's "doesn't expire" checkbox sets that.
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
  - **Remembered barcode (AUTO-6)**: an optional `barcode`, unique per
    household, set by linking a scanned code to the item — see "Remembered
    barcodes and Scan mode" under "Barcode scanning" below.
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
    path: inventory, shopping list, and recipe-ingredient find-or-create
    (below). The `revalidatePath` inside `after()` runs after the response
    is sent, so the adding user sees the patched category on their next
    navigation or refresh, not instantly.
    **Recipe-ingredient find-or-create** (`parseIngredientRows` in
    `recipe-actions.ts`, and the missing-ingredients → shopping-list bridge
    in `cooking-actions.ts`) also runs every newly-created ingredient
    through `createCategoryResolver`, falling back to `"Uncategorized"`
    (plus the AI fallback above, when configured) only when neither step
    recognizes the name — the resolver's own lazy,
    memoized load means this costs one extra query for the whole batch, not
    one per ingredient, matching SCALE-B/SCALE-D's existing batching there.
    **Correcting a guess in place (AUTO-2b)**: every editable, linked
    shopping-list row shows its `InventoryItem`'s category as a small chip
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
  guarantee at the point the user considers the list "done". Marking an item
  purchased **increments** the linked inventory item's quantity by the
  purchased amount (and records a `PriceHistory` row if an estimated price
  was given); un-marking it reverses the increment. The dashboard overview
  card sums pending items across every `ACTIVE` list, not just one.
- **Shopping mode (AUTO-3)** — the detail page groups pending items by their
  linked `InventoryItem`'s category instead of insertion order, so a shop
  doesn't mean zig-zagging the store. `groupPendingItemsByCategory`
  (`src/lib/shopping/shopping-mode-grouping.ts`, unit-tested) sorts groups
  produce → bakery → dairy → meat → pantry → frozen → drinks → cleaning →
  bathroom — `AUTO_CATEGORY_KEYS`' own order (auto-category.ts) — matching a
  category stored in either locale to the same group (a household that
  auto-filed some items in English and some in Swedish still gets one
  "Dairy & eggs" group, not two). A household's own custom category text
  sorts after the known ones, alphabetically; items with no linked item, a
  blank category, or still sitting in the "Uncategorized" placeholder
  collect under "Other" at the end. Only categories actually present get a
  header. This wave's order is fixed; AUTO-9 will let it learn a
  household's own store layout. Purchased items are unaffected — they still
  collapse into the flat "Purchased" section below.
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
    `bulkSetInventoryQuantitiesAction` (AI shelf scan restock),
    `markMealEntryCookedAction`, `togglePurchasedAction` and the share-link
    `toggleItemViaShareTokenAction`) — once per path, in the actions layer,
    never per UI; the in-transaction callers pass their `tx`. It fires only
    when `getStockStatus` goes from `in` to `low`/`out` (judged against the
    item's threshold after the write, so raising a threshold alone never
    adds anything); an item that was already low dropping further is a
    no-op, so the list isn't refilled over a row someone removed on
    purpose. The row is deduped against a pending row for the same item
    exactly like `generateFromLowStockAction`, sized
    `max(1, threshold − quantity)`, carries the item's `lastKnownPrice`
    (AUTO-4) and is flagged `addedAutomatically` (the existing "Low stock"
    badge on the row).
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
  - **Household setting.** `Household.autoAddLowStockToList` (default on)
    is a checkbox under "Shopping" on the Household page
    (`AutoAddSetting`, `setAutoAddLowStockToListAction` in
    `src/lib/actions/household.ts`). Not owner-gated — see "Roles". Off
    means no crossing ever adds anything; "Add low-stock items" and "Mark
    as empty & add" still work by hand.
- **Smart add line (AUTO-1)** — the primary way to add to an `ACTIVE`
  list: one always-visible input (`SmartAddBar`,
  `src/components/shopping/smart-add-bar.tsx`) between the header and the
  items, sticky to the top of the scroll area on phones (same treatment as
  the inventory search bar). Typing `2 l mjölk, bröd, 6 ägg` and pressing
  Enter adds three rows; the text goes through the shared
  `parsePastedList` (via `parseSmartAddInput`), and a row with no typed
  unit takes its inventory item's usual unit rather than "pcs". The input
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
    `matchSmartAddInventoryItem`: an exact normalized name, else the one
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
  - **Voice (AUTO-12, not built)** should put its transcript through the
    same `parseSmartAddInput` → `smartAddShoppingListItemsAction` path.
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
  `isRecurring` flag above. Mirrored for the separate, user-scoped personal
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
  on them is interactive.
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
  same pattern meal-planning's week navigation uses. `src/app/dashboard/
  budget/page.tsx` fetches `Transaction` rows bounded to the selected
  month's `[monthStart, monthEnd)` window (rather than the household's
  entire history — see SCALE-F, BACKLOG.md, for why an unbounded query
  here doesn't scale) for the transaction list and this section's totals;
  Safe to spend and the recurring-template status checks each read from
  their own wider trailing window instead (see those subsections) since
  they need to see further back than just the month on screen. The
  settle-up balances read every split transaction the household has (split
  rows only), since debts carry over until they're cleared — see
  "Household expense splitting".
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
- **Cheapest store**: a third section below the two charts above, showing
  which store had the cheapest last recorded price for any item bought at
  ≥2 distinct stores — see "Store name and cheapest-store comparison
  (GAP-6)" below for the full write-up (it's grouped there with the receipt
  scan/register changes that feed it `PriceHistory.store`
  in the first place).

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
  no `Transaction` is created at all. As of AUTO-4 (below), a new item
  usually arrives with `estimatedPrice` already filled in, so in practice
  this total is rarely 0 once a household has bought something at least
  once.

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
touches a saved row's price again. The list header shows a running "About
{amount} left to spend", summing `estimatedPrice` the same per-unit way but
only over *pending* (not yet purchased) items — a purchased item's price is
already folded into `lastKnownPrice` and the eventual Groceries expense, so
counting it again here would double it into "what's left". Both the row
amount and the header total use the same `Intl.NumberFormat` convention as
the budget page (locale-aware decimals, no currency symbol). The summation
itself is a pure, unit-tested helper
(`sumEstimatedPendingTotal`, `src/lib/shopping/estimated-total.ts`).
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
  behavior, not optional. It also returns `transactionId`, the id of the
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

#### Finishing the trip in one gesture (AUTO-5)

The detail page's header keeps only what's used on every trip visible:
"Scan receipt" and a `⋯` overflow menu (Base UI `DropdownMenu`), with the
smart add line below. The menu holds add item, import, add low-stock
items, resolve mappings (when there are enough unlinked items), share,
export, then — after a separator — "Complete list", archive/unarchive, and
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
still confirm-gated, since it can complete a list with items still pending.
Its toast carries the same Undo. Like "Undo mark cooked", this is a
fat-finger undo on the toast, not a permanent "reopen list" control.

### Safe to spend

A hero stat card at the top of the Budget page's Overview tab, directly
above `PeriodSummary` (`SafeToSpend`, `src/components/budget/safe-to-spend.tsx`)
— the PocketGuard-style "what's actually left" number, per the competitive
analysis. Like `PeriodSummary`/`CostAnalyzer`, it's a plain presentational
component; all aggregation happens in `src/app/dashboard/budget/page.tsx`,
which delegates the actual math to a pure, dependency-free
`computeSafeToSpend` function in `src/lib/safe-to-spend-calc.ts`
(unit-tested in the colocated `safe-to-spend-calc.test.ts` — no Prisma
import, so no mocking needed) rather than inlining it, since a Server
Component page function can't itself be unit-tested.

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
  `EXPENSE` item as a *due payment*, a `SAVINGS` item as a *due saving*
  (income items are ignored). A `"posted"` item counts only through the
  transaction logged from it, even when that was for less than the item
  says: a 5000 saving logged as 3000 means 3000 was saved and the other
  2000 is spendable, not still owed. `"acknowledged"` counts as handled.
  Before this, only expense categories were estimated, so a recurring
  saving was never subtracted until it was logged.
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
    recurring items that are still due (the "Rent pops up" rows).
  - Under the number, "Your household balance" shows where the user stands
    per household at the end of the month (`householdDebts`): what they owe
    other members or are owed, and their unpaid share of bills, with a
    "Settle up" link to that household's budget, Insights tab
    (`?tab=insights`, which `BudgetTabs` reads as `initialTab`).
- **The breakdown**: beneath the headline number, one line per term
  (income, expenses, savings, and — only when non-zero — owed from earlier
  months, due payments, due savings) adding up to "Remaining after
  expenses and savings", then a "Still due this month" list of every item
  counted as due (name + amount; savings tinted `text-chart-2` with a
  "Saving" badge, payments `text-destructive`, shared items badged
  "Shared") — so the number is never a black box. The list is hidden when
  nothing is due.
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
default to an even split of the transaction's amount
(`evenSplitAmounts` in `src/components/budget/split-amounts.ts` — a pure,
unit-tested cents-based helper so the shares always sum exactly to the
total instead of drifting from naive floating-point division) via a "Split
evenly" reset button, individually adjustable afterward. The dialog shows
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
Covers every split bill and repayment the household has, not just the
month on screen: a debt carries over until it's cleared. (It used to be
scoped to the selected month, so an unpaid August debt silently vanished
in September.) All netting and debt-simplification logic is pure and
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
  entered by mistake. There's no payment integration; a Swish link is
  GAP-7 in BACKLOG.md.
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
- **Out of scope**: codes on `ShoppingListItem`, matching receipts by EAN
  (BACKLOG.md AUTO-11), and a place to view or clear an item's code in the
  edit form — re-linking it from the scan mode is the correction path.

## Receipt scanning

A "Scan receipt" button on an active shopping list's detail page
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
  transaction instead of one checkbox at a time, with the per-line writes
  themselves run concurrently via `Promise.all` inside that transaction
  rather than sequentially — the same change applied to
  `resolveShoppingListMappingsAction`'s batch resolution
  (`src/app/dashboard/shopping-list/actions.ts`, the `ResolveMappingsDialog`
  commit path) — since each line/resolution only ever touches its own rows
  (SCALE-C). De-dupes by `shoppingListItemId` server-side (in case two
  OCR'd lines were ever matched to the same item) so nothing is
  double-counted.
- **`RegisterReceiptDialog`'s own inventory match/create-new review**: since
  this flow has no existing shopping list to match against, each reviewed
  line instead gets matched against the household's *inventory* catalog —
  same `findInventoryMatches` call, same fuzzy-match-or-not default as
  `ReceiptScanDialog` above, but a two-mode "Use existing"/"Create new"
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
  compatibility rather than as the primary path.
- **Privacy**: when a vision provider is configured, the photo is uploaded
  to it for analysis — same tradeoff as AI shelf scan below, disclosed in
  this feature's comments the same way. In the OCR fallback path only
  (no provider configured), the photo is exactly the same stance as barcode
  scanning: read entirely client-side by the OCR worker and never uploaded
  anywhere. Either way, the server only ever receives the extracted item
  names, prices, and currency the user has already reviewed — never the
  photo itself.
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
between "Planner" and "Recipes" — no new route needed for the split) covers
the `Recipe` / `RecipeIngredient` / `MealPlan` / `MealPlanEntry` models:

- **Recipes**: full CRUD (`createRecipeAction` / `updateRecipeAction` /
  `deleteRecipeAction` in `src/app/dashboard/meal-planning/actions.ts`) — a
  name, optional freeform instructions, and any number of ingredient rows
  (name + quantity + unit) added/removed client-side in
  `RecipeFormDialog` before submit. Editing replaces every ingredient row in
  a `$transaction` (delete-all then recreate) rather than diffing, which is
  simpler and fine at this scale (a handful of ingredients per recipe).
- **Ingredient → inventory linking**: mirrors the shopping list's
  find-or-create identity rule (case-insensitive name match, scoped to the
  household) but batched across every ingredient row on the recipe in one
  pass — `parseIngredientRows` (`src/app/dashboard/meal-planning/recipe-actions.ts`)
  runs a single `findMany` for every distinct name, a single
  `createManyAndReturn` for the ones that don't already exist, then maps
  each row back to its `InventoryItem` id from the combined result (SCALE-B),
  rather than a `findFirst`/`create` pair per ingredient. `parseComponentRows`
  in the same file batches its sub-recipe existence check the same way — one
  `recipe.findMany` across every candidate id instead of a `findFirst` per
  row — while `wouldCreateCycle`'s per-candidate graph walk stays as-is
  (it's not a flat lookup). This happens automatically on every save —
  there's no "link to inventory?" toggle in the UI, same as shopping list
  items.
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
  unlinked; that case falls back to the same case-insensitive name match the
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
  `createShoppingListAction` does), then find-or-create-links every checked
  ingredient to an `InventoryItem` in one batched pass — a single
  case-insensitive `findMany` across all the row names, a single
  `createManyAndReturn` for whichever names don't already exist, then a
  single `shoppingListItem.createMany` for every row not already pending —
  rather than a `findFirst`/`create`/`create` round trip per ingredient
  (SCALE-A). Items already pending (unpurchased) on the target list are
  skipped rather than duplicated, mirroring `generateFromLowStockAction`'s
  existing dedupe in `src/app/dashboard/shopping-list/actions.ts`. On
  success the dialog closes and a `sonner` toast confirms which list the
  items were added to.

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
  When the cook pushed ingredients into low stock (AUTO-8), the toast says
  how many were added to "Next shop", and the same Undo also removes those
  rows via `undoAutoAddedItemsAction` — undoing the cook undoes everything
  it caused.
  Deleting the meal-plan entry afterward doesn't reverse the decrement
  either, for the same reason.

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
  ingredient auto-created via `parseIngredientRows`/
  `addMissingIngredientsToShoppingListAction` starts at `quantity: 0,
  lowStockThreshold: 0` (see "Ingredient → inventory linking" above), which
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
  less urgent of the two on equal footing), then recipe name, capped at 5
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

## Household tasks

`/dashboard/tasks` (`TasksClient`) — "Household Tasks v1", built from
[`docs/archive/JOY_GAP_BACKLOG.md`](./docs/archive/JOY_GAP_BACKLOG.md) item 6, the one Joy Gap ticket
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
  `Transaction.recurringTemplateId` makes for its template: a member leaving the household
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

## Releases & What's new

Every change reaches `master` through a pull request, and every releasing PR
bumps the app's version and adds a user-facing note. Nobody edits the
version or the notes by hand.

- **PR title = release type.** Titles follow Conventional Commits
  (`type(scope)!: description`). `feat` → minor, `fix`/`perf`/`revert` →
  patch, any type with `!` → major. `refactor`, `docs`, `test`, `ci`,
  `chore`, `build` and `style` merge without a release. PRs are
  squash-merged, so the title is also the commit message on `master`.
- **PR body = release note.** `.github/pull_request_template.md` has a
  "Release note" section with `### English` and `### Svenska` headings. An
  empty English note falls back to the title's description. An empty
  Swedish note is stored as `null` and the app shows the English one.
- **Before merge**: `.github/workflows/release-preview.yml` fails the check
  on an invalid title and keeps one PR comment up to date with the version
  the PR will release and the exact note users will see.
- **After merge**: `.github/workflows/release.yml` runs
  `scripts/release.ts apply` on the latest `master`. That bumps
  `package.json`/`package-lock.json`, prepends an entry to
  `src/lib/release-notes/releases.json`, commits
  `chore(release): vX.Y.Z [skip ci]`, tags `vX.Y.Z` and creates a GitHub
  Release. The bump happens after merge, not inside the PR, because
  bumping in each PR would make every pair of open PRs conflict on the
  version line. Concurrent merges retry from the newest `master` instead
  of using a concurrency group, which would cancel queued runs.
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
  date and the note in the user's locale.
- The desktop sidebar footer has a "What's new · vX.Y.Z" link, and the
  mobile "More" menu has the same item. Both show a dot while the newest
  release is unseen. Opening the page writes the `last_seen_release`
  cookie (preference, 1 year) and refreshes the layout to clear the dot.
- Profile has an "About Squirrel" card with the version and a link to the
  page.

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
  (undismissed) alert for the same item. Every one of these call sites
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
    must be configured in production before the route is deployed.
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
  entry's date), reusing that page's existing `?week=` param. The inventory
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
the link navigate; an already-read row is just a link.

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
    household. It's called from the same triggers as the in-app
    notification bell above (`recordOutOfStockTransition`,
    `recordListClearedTransition`, `syncMealNotLoggedNotifications` and
    `syncExpiringSoonNotifications` in `src/lib/notifications.ts`), and
    nothing else sends a push. The two action-driven triggers fire it
    without awaiting (`void sendPushToHousehold(...)`) since some of their
    call sites run inside a Prisma `$transaction`, and holding that open for
    a network call isn't worth it — Push API delivery has no delivery
    guarantee either way, so losing a send if the surrounding write later
    rolls back is an acceptable trade. The two cron-driven syncs **await**
    it instead: they have no surrounding transaction, and the cron route
    responds as soon as they resolve, at which point a serverless platform
    may freeze the invocation and drop any send still in flight. A 404/410 response (the browser revoked/expired that
    subscription) deletes the `PushSubscription` row so delivery stops
    retrying it; any other error is just logged.
  - **Showing it**: `src/lib/service-worker.js` only implements two
    listeners — `push` (shows the notification via
    `registration.showNotification`, with `{ title, body, url }` as sent)
    and `notificationclick` (closes it and opens `url`, mirroring
    `notificationHref()` in `notification-bell.tsx`). It has no `fetch`
    handler and does no caching — it exists purely to deliver push, not for
    offline support (see `INFRA-5` in BACKLOG.md).

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
