# UX friction backlog — Sep 2026

Source: a hands-on product walkthrough run 2026-09-14 against this branch —
signed up a fresh household, then drove every dashboard section (Inventory,
Shopping list, Meal planning, Tasks, Household budget, Personal budget,
Household, Profile) with Playwright, at desktop and phone (390px) widths, in
both themes and both locales. This isn't a code read — every finding below
was reproduced by clicking through the running app as a first-time user
would.

**Scope/methodology caveats**, so these findings are read at the right
confidence level:

- Single-member household only — multi-member surfaces (Balances/split
  transactions, "Shared with N others", another member completing a task)
  weren't exercised.
- Receipt scanning and barcode scanning need a real camera/photo, which a
  headless run can't provide — their happy path wasn't driven, only the
  code path that feeds off them (see item 3).
- Email delivery wasn't configured (no `RESEND_API_KEY`), so the
  verification/invite emails themselves weren't sent — only the on-screen
  side of those flows.
- No automated accessibility (axe/contrast) audit — this is a sighted
  click-through, not an a11y pass.

## What's already working well (worth protecting, not re-litigating)

Calling these out so the items below read as gaps in an otherwise solid
product, not a rewrite request:

- The Overview page's "Get set up" checklist is a genuinely good first-run
  pattern — five concrete, checkable onboarding steps instead of a blank
  dashboard.
- Shopping list's "cleared" state, the positive/negative split in the
  notification bell, and Tasks' "no scoring, no streaks" copy (all
  `JOY_GAP_BACKLOG.md` items) are shipped and read exactly as designed —
  calm, not gamified.
- Inventory's "starter kit" chips (Pantry basics / Cleaning supplies /
  Bathroom essentials → "Add 10 items") are a great low-friction way past a
  blank pantry; nothing else in the app offers an equivalent shortcut (see
  item 4 below).
- The invite-a-member dialog, the light/dark toggle, and the English/Swedish
  toggle all work cleanly with no rough edges found.
- i18n coverage is genuinely complete — every screen walked was fully
  translated in Swedish, not just the top-level nav.

---

## Wave 1 — now, copy/UI only, no schema changes

- [ ] **1. Email verification banner never goes away**
      — `src/components/dashboard/email-verification-banner.tsx`,
      `src/app/dashboard/layout.tsx`
      **Problem:** the amber "Please verify your email address" bar renders
      on *every* dashboard page for as long as the account is unverified,
      with no dismiss/snooze control — only actually verifying makes it go
      away. For any household that hasn't configured `RESEND_API_KEY` (or a
      user who just hasn't gotten to the email yet), that's permanent
      warning-colored chrome on top of every screen, forever, pushing all
      page content down a row. The component's own comment calls it "purely
      a nudge," but a nudge with no way to say "not now" behaves like a
      persistent error state.
      **Fix direction:** add a session- or cookie-scoped "remind me later"
      dismiss (re-appears next session, or after N days) — the resend
      action and message stay exactly as they are, this only adds an escape
      hatch. Keep it reachable afterward from Profile, where the
      email-address section already lives.

- [ ] **2. "Needs mapping" is easy to miss and only explained after the fact**
      — `src/components/shopping/shopping-list-client.tsx` (`needsMappingBadge`,
      `unresolvedNotice`), `src/components/shopping/edit-shopping-item-dialog.tsx`
      **Problem:** an ad-hoc shopping list item whose name doesn't
      exact/fuzzy-match an existing pantry item gets added with no inventory
      link — correct behavior (better than silently miscategorizing), but
      the only in-the-moment signal is a small dashed "Needs mapping" badge
      that's easy to check off without noticing. The consequence (checking
      it off as purchased does *not* update pantry stock) is only explained
      afterward, in a toast when the whole list is completed ("Completed —
      1 item wasn't linked to inventory, so it didn't update your stock").
      A first-time user learns the app's central promise ("shopping keeps
      your pantry in sync") has a silent exception only once it's too late
      to act on it for that item.
      **Fix direction:** surface the same explanation at add-time, not just
      completion-time — e.g. inline under the item the moment it's added
      ("New to your pantry — match it or add it as a new item") rather than
      relying on the badge alone being noticed.

- [ ] **3. Cost analyzer and the auto-logged Groceries expense are effectively dead
      for anyone who doesn't use receipt scanning**
      — `src/components/budget/cost-analyzer.tsx`,
      `src/app/dashboard/shopping-list/actions.ts` (`estimatedPrice`),
      `src/components/shopping/edit-shopping-item-dialog.tsx`
      **Problem:** confirmed both by walkthrough and by `REQUIREMENTS.md`'s
      own "Cost analyzer" section, which already flags this: there is no UI
      anywhere in the everyday add/edit-item or check-off flow to set an
      item's `estimatedPrice`. The only two paths that ever populate it are
      Receipt Scan (OCR) and the barcode-lookup flow's product data. A
      household that never scans a receipt gets a permanently empty Cost
      analyzer tab and a Groceries expense that never logs on list
      completion — two real features that look present in the nav but are
      silently inert for most of the ways people actually check off a
      shopping list. Nothing in the checkbox/purchase interaction hints
      that adding a price would unlock anything.
      **Fix direction:** at minimum, a one-line hint on the empty Cost
      analyzer state pointing at receipt scanning as the way to populate it
      (today's copy — "Mark an item purchased with an estimated price" —
      implies a manual path that doesn't exist). The larger option (an
      optional inline price field in the manual purchase flow) is Wave 3
      below, since it's a real flow-design call, not just copy.

- [ ] **4. "At-threshold" restock still reads as low stock**
      — `src/components/inventory/stock-badge.tsx`, low-stock comparison in
      inventory logic (`quantity <= lowStockThreshold`)
      **Problem:** buying an item back up to exactly its own configured
      low-stock threshold (e.g. threshold 6, restocked to 6) still shows the
      orange "Low stock" badge, because the comparison is inclusive. A user
      who just fully restocked gets no "back to normal" signal — which
      undercuts the positive-notification work in `JOY_GAP_BACKLOG.md` item
      4, since the badge itself never confirms the good news the bell just
      announced.
      **Fix direction:** either make the comparison strict (`<`) so hitting
      your own threshold reads as "in stock," or keep the math but adjust
      the badge's boundary condition/copy so "just barely enough" doesn't
      look identical to "nearly out." A small product call either way, not
      a big change.

---

## Wave 2 — next, small additive UI, no schema changes

- [ ] **5. Meal planning is one of four marketed pillars but two taps away on
      mobile**
      — `src/components/dashboard/nav-items.ts` (`primaryMobileHrefs`)
      **Problem:** the landing page pitches four feature pillars in roughly
      equal weight (pantry, shopping, meals, budget). On the phone-width
      bottom nav, the four visible slots are Overview / Inventory / Shopping
      list / Household budget — Meal planning sits behind "More" alongside
      Tasks, Personal budget, Household, and Profile. Someone standing in
      their kitchen deciding what to cook — arguably meal planning's primary
      real-world moment — needs an extra tap that pantry and shopping don't.
      **Fix direction:** this is a genuine placement trade-off (something
      else has to move behind "More" if Meal planning moves up), so it's
      listed here as "worth deciding," not "obviously wrong" — flagging for
      a product call, ideally informed by actual usage data if any exists
      yet, rather than prescribing the swap outright.

- [ ] **6. No "starter categories" shortcut for Budget, unlike Inventory**
      — `src/components/budget/category-manager.tsx` (or equivalent),
      mirrors Inventory's `AddItemDialog` starter-kit chips
      **Problem:** Inventory's empty state offers one-click starter kits
      (Pantry basics, Cleaning supplies, Bathroom essentials) to get past a
      blank pantry fast. Household budget's empty state has no equivalent —
      the "Let's set up your budget" banner leads straight to a bare
      "Add category" dialog (name + income/expense type), one at a time,
      with no suggested starting set (Groceries, Rent, Utilities, Salary).
      Setting up a first, useful budget takes noticeably more manual typing
      than setting up a first, useful pantry did minutes earlier in the same
      onboarding flow.
      **Fix direction:** a small set of one-click starter categories
      (split income/expense, like the starter kits already do for
      locations/units) on the first-visit banner — same interaction
      pattern already proven in Inventory, not a new pattern to design.

- [ ] **7. Category management relocates and gets harder to find after first use**
      — `src/app/dashboard/budget/page.tsx`, `BudgetTabs`, the "Categories"
      card in the Activity tab
      **Problem:** before any category exists, "Add category" is the most
      prominent thing on the page (inside the purple onboarding banner).
      The moment one category exists, that banner disappears entirely, and
      category management relocates to a small card at the very bottom of
      the *Activity* tab — below Safe to spend, Due this period, the
      month's totals, the breakdowns, and the transaction list. A user who
      wants to add a second category later (e.g. "Rent" after "Groceries")
      has no stable, discoverable entry point — they have to remember it
      moved to a different tab and scroll past everything else to find it.
      **Fix direction:** keep a small, consistently-placed "Manage
      categories" affordance regardless of onboarding state — it doesn't
      need to be prominent once categories exist, but it shouldn't move
      screens.

---

## Wave 3 — needs a product decision before scoping

- [ ] **8. Should manual purchase-checking ever collect a price?** `[!]`
      Depends on item 3's fix direction landing first as the cheap version.
      The bigger option: an optional, low-friction price field in the
      everyday "check item off" interaction (not just receipt scan/barcode
      lookup) so Cost analyzer and the Groceries auto-expense work for
      households that shop the old-fashioned way. This is explicitly a
      flow-design trade-off — every additional field on the fastest, most
      repeated interaction in the app (checking off a shopping item) has a
      real friction cost — so it needs a product decision on whether
      "sometimes-populated cost data" is worth it, not just an engineering
      estimate. Recommend deciding this only after item 3's cheaper fix
      (an honest empty-state hint) ships and there's a sense of whether
      receipt scanning alone gets enough households populating this data.

---

## Housekeeping (not user-facing, noticed only while testing)

- Next.js's own dev-mode build-activity indicator (bottom-left "N" badge,
  visible only under `next dev`, never in a production build) overlaps the
  sidebar's "Log out" link on desktop and sits directly on the first
  bottom-nav tab on phone width. Doesn't affect real users, but it got in
  the way of this walkthrough and would do the same for anyone testing on a
  phone against a local dev server. A one-line `devIndicators` config
  change would stop it recurring for future testing sessions.
