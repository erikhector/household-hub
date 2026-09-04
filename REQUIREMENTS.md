# REQUIREMENTS.md

Single source of truth for what Household Hub is and how it's built — for AI
coding agents (including any future autonomous build loop) and humans alike.
Update this file whenever product decisions change, and keep it in sync with
what's actually implemented.

## Product summary

Household Hub tracks a household's grocery/pantry inventory, flags items
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

## Multi-tenancy model

- `Household` is the tenant. `User` accounts join one or more households via
  `HouseholdMember` (role: `OWNER` | `MEMBER`).
- Every domain table is scoped by `householdId`. Every query/mutation is
  scoped server-side via `requireHousehold()` (`src/lib/session.ts`), which
  resolves the caller's household from their session — never trust a
  client-supplied household id.
- Sharing: an `Invitation` (random token, 7-day expiry) generates a
  `/join/[token]` link. Visiting it while logged in joins that household to
  your account; while logged out, it shows a signup form that creates the
  account and joins in one step. There's currently no email delivery — the
  link is shown on-screen for the inviter to copy and send manually.
- Role is not yet enforced beyond storage (any member can invite, edit
  inventory, etc.) — only ownership of the household membership itself is
  checked. Tightening this (e.g. only `OWNER` can invite/remove members) is a
  reasonable follow-up, not yet implemented.
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
- `ShoppingList` / `ShoppingListItem` — one `ACTIVE` list per household at a
  time (enforced by app logic, not a DB constraint). **Every shopping list
  item maps 1:1 to an `InventoryItem`**: adding an ad-hoc item
  (`addAdHocItemAction`) immediately finds-or-creates a matching
  `InventoryItem` (case-insensitive name match within the household; created
  with category `"Uncategorized"`, quantity 0) and links it — there is no
  such thing as an unlinked shopping list item going forward.
  `completeShoppingListAction` re-runs that find-or-create for any item that
  still lacks a link, as a defensive guarantee at the point the user
  considers the list "done". Marking an item purchased **increments** the
  linked inventory item's quantity by the purchased amount (and records a
  `PriceHistory` row if an estimated price was given); un-marking it reverses
  the increment.
- `PriceHistory` — feeds the (not-yet-built) cost analyzer.

**Meal planning** (schema only, no UI yet)
- `Recipe` + `RecipeIngredient` (ingredients optionally link to
  `InventoryItem`), `MealPlan` + `MealPlanEntry`.

**Budgeting** (schema only, no UI yet)
- `BudgetCategory` (income/expense), `Transaction` (amount, category, date,
  `isRecurring` + `recurrenceFrequency`). The intended (not yet built) link
  between modules: completing a shopping list can create a "Groceries"
  expense `Transaction` — otherwise the two modules are independent.

**User profile** (built)
- A `/dashboard/profile` page (`updateProfileAction` in
  `src/app/dashboard/profile/actions.ts`) for the signed-in user to edit
  their own `User.displayName`. Email is shown read-only and password isn't
  editable there yet (email is the login identifier and there's no
  re-verification flow; password change is a separate future slice) —
  deliberately the smallest useful slice, not a placeholder for a fuller
  form.

## Theming

The app is dark-only (no light-mode toggle) with a fixed background of
`radial-gradient(circle, #180828, #000000)` (set on `body` in
`globals.css`) and `dark` forced on `<html>` in the root layout so the
existing shadcn dark color tokens (card/popover/border/etc.) apply. Don't
reintroduce a plain `bg-background` on `body` — it would paint over the
gradient with a flat color.

## Navigation & responsive layout

Nav sections (Overview, Inventory, Shopping list, Meal planning, Budget,
Household, Profile) are defined once in `src/components/dashboard/nav-items.ts`
(icon + href + label) and consumed by both layouts below — add a section
there, not in the sidebar/bottom-nav components directly.

- **Desktop (`sm` and up)**: `src/components/dashboard/sidebar.tsx` renders a
  left sidebar with an icon + label per section, the `HouseholdSwitcher` at
  the top, and log out pinned to the bottom. Expanded by default; a toggle
  collapses it to an icon-only rail (`w-16` vs `w-56`). The expanded/collapsed
  state is written to the `sidebar_expanded` cookie (`SIDEBAR_COOKIE` in
  `nav-items.ts`) on toggle and read server-side in
  `src/app/dashboard/layout.tsx` so the initial render matches — no
  client-side flash.
- **Mobile (below `sm`)**: `src/components/dashboard/bottom-nav.tsx` renders a
  fixed bottom bar with 5 icons: Overview, Inventory, Shopping list, Budget,
  and a "More" dropdown menu holding Meal planning, Household, Profile, and
  log out (`overflowMobileNavItems`/`primaryMobileNavItems` in
  `nav-items.ts`). Meal planning and Household are in the overflow rather
  than the primary bar because they see lower daily use than
  inventory/shopping/budget. The dashboard `<main>` gets extra bottom padding
  (`pb-24 sm:pb-8`) so content isn't hidden behind the fixed bar.
- On mobile the sidebar is hidden entirely; the `HouseholdSwitcher` instead
  appears in a slim header above the page content (`sm:hidden`), since it
  isn't part of the bottom bar.

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
- UI text is in English (no i18n requirement, unlike some of this household's
  other projects — don't assume Swedish).
- Base UI's `<Select.Value>` (`SelectValue` in `src/components/ui/select.tsx`)
  renders the raw selected `value` as text by default — it does **not** look
  up the matching `SelectItem`'s label. Any `Select` whose `value`s aren't
  already human-readable (e.g. a sentinel like `"__all__"` for "All
  categories") needs an explicit `children` render function on `SelectValue`
  mapping value → label (see `InventoryClient`'s filter selects), or it'll
  silently render the sentinel/id instead of the intended text.

## Not yet built

Meal planning UI, cost-analyzer UI, budgeting UI, the shopping-list →
budget expense link, role-gated permissions, email delivery for invites,
profile email/password/avatar editing, tests. The autonomous agent
build/improve loop itself is intentionally not set up yet — that's a
deliberate separate step once there's a real test suite to gate it on.
