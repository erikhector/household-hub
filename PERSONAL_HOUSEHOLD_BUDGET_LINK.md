# Personal ↔ Household budget link — design spike (2026-09-21)

Source: a direct product request — "if we add Rent as a shared cost, it would pop up under
my personal budget." This document investigates how that connection would work and stay
intuitive.

**This document is a plan only.** No schema, component, or action code was changed while
producing it. It's meant to be handed back for a human decision on scope/wave before any
implementation task is scoped from it — same convention as `PERSONAL_BUDGET_UNIFICATION.md`
(a prior spike in this repo, which is about unifying the *component code* between the two
budgets and is orthogonal to this one, which is about linking their *data*).

Status legend for the proposed waves in §5: `[ ]` not started · `[~]` in progress ·
`[x]` merged · `[!]` blocked / needs a human decision.

## 1. Recommendation

**Surface the current user's share of split household costs inside Personal Budget as a
read-only reference, rather than syncing or copying data between the two ledgers.**

The household budget and personal budget are two deliberately separate Prisma model
families today (`BudgetCategory`/`Transaction`/`RecurringTemplate`, scoped by
`householdId`, vs. `PersonalBudgetCategory`/`PersonalTransaction`/`PersonalRecurringTemplate`,
scoped by `userId` — see `prisma/schema.prisma`'s own "Personal budget" section comment).
Household transactions already have exactly the mechanism this feature needs:
**`TransactionSplit`**, the Splitwise-style opt-in expense split added for "who owes whom"
(`REQUIREMENTS.md`'s "Household expense splitting" section). A split transaction's
`amountOwed` per `HouseholdMember` *is* "your share of a shared cost" — that's the bridge to
reuse, not a new synced/duplicated transaction.

## 2. Why copying the transaction into Personal Budget is the wrong shape

It's tempting to read "pop up under my personal budget" as "when Rent is logged in the
household budget, also create a `PersonalTransaction` for it." Concretely, that runs into
problems this repo has already solved once, in the opposite direction, and rejected the
naive version of:

- **Which amount?** The household's full ¤1,200 rent, or the ¤400 that's actually this
  member's share? Logging the full amount overstates what actually left this person's own
  pocket whenever the cost is split (the common case for "Rent" specifically) — it would make
  Personal Budget's "safe to spend" wrong for exactly the households this feature is meant to
  help.
- **Two ledgers, one bill, no sync.** A copied `PersonalTransaction` would need to track edits,
  amount corrections, and deletes made to the original household `Transaction` forever, with
  no existing FK or sync mechanism between the two model families to do that (by design — see
  `PERSONAL_BUDGET_UNIFICATION.md` §1 quoting the schema's own "kept as a straight duplicate
  rather than a shared/polymorphic table" comment). A live reference avoids ever needing that
  sync.
- **Category mapping is undefined.** A household "Rent" `BudgetCategory` and a personal
  "Rent" `PersonalBudgetCategory` are unrelated rows (different tables, different owners,
  possibly named differently or not existing at all on the personal side). Auto-creating or
  matching them is a second feature by itself and a likely source of duplicate/junk categories.
- **It doesn't handle the actual ask.** The concrete example is a *recurring* cost that should
  "pop up" — i.e., show up as expected/due — which is a forward-looking anticipation, not just
  a record of a past transaction. Copying already-posted transactions after the fact doesn't
  produce that "pops up" feeling at all; see §4 below for what does.

## 3. Recommended shape: a read-only "shared with your household" surface

Two related pieces, because the household budget already distinguishes "posted" (a real
`Transaction`) from "due" (a `RecurringTemplate` period not yet posted) — REQUIREMENTS.md's
"Recurring budget templates" section — and the Rent example is specifically about the *due*
case:

### 3a. Already-posted split transactions (no schema change needed)

For any `Transaction` this month that has `TransactionSplit` rows including one of the
signed-in user's `HouseholdMember` ids (across every household they belong to — see §4), show
a read-only line in Personal Budget: category name, **the user's own `amountOwed`** (never the
full transaction amount), which household it's from (only when the user is in more than one
household — see §6), and who paid. This is a pure join over data that already exists; no
migration required.

### 3b. Due-but-not-yet-posted recurring costs (needs one additive schema piece)

This is the actual "Rent pops up" case, and it's the part that's currently impossible: a
`RecurringTemplate` (e.g. "Rent") has **no split concept at all** today — only a logged
`Transaction` can carry a `TransactionSplit`. Before anyone logs September's rent payment,
there is no `TransactionSplit` row yet for the due widget to find, so there is nothing for
Personal Budget to surface, even though this is precisely the moment ("it's due, plan for it")
the feature is meant to help with.

Proposed addition, mirroring `TransactionSplit` exactly:

```
model RecurringTemplateSplit {
  id                  String   @id @default(cuid())
  recurringTemplateId String
  householdMemberId   String
  amountOwed          Float
  createdAt           DateTime @default(now())

  recurringTemplate RecurringTemplate @relation(fields: [recurringTemplateId], references: [id], onDelete: Cascade)
  householdMember   HouseholdMember   @relation(fields: [householdMemberId], references: [id], onDelete: Cascade)

  @@unique([recurringTemplateId, householdMemberId])
}
```

- `RecurringTemplateDialog` gains the same "Split this bill" checkbox `TransactionDialog`
  already has (opt-in, only offered when `members.length > 1`, defaulting to an even split via
  the existing `evenSplitAmounts` helper). Unsplit templates behave exactly as they do today —
  same "opt-in, previously-existing behavior unaffected" convention the original
  transaction-splitting feature used.
- Once "Rent" has a split, the personal-budget-side `computeTemplateStatuses` query (the same
  pure helper `src/lib/recurring-template-calc.ts` already uses for both budgets) can be run
  again from the *personal* side: fetch every active `RecurringTemplate` with a
  `RecurringTemplateSplit` for one of the user's `HouseholdMember` ids, compute its
  due/acknowledged/posted status for the current period, and surface the `"due"` ones in a
  Personal Budget widget — this is genuinely "Rent pops up under my personal budget" before
  anyone has logged anything.
- Bonus, not required for the core ask: pre-fill a transaction's split from the template's
  saved split when logging it via `logRecurringTemplateAction`, so the household side doesn't
  have to re-enter the same split every period either.

### Where it renders

- **Superseded 2026-09-21**: the original plan below put 3a/3b in their own dedicated "Shared
  with your household" card on the Overview tab, plus a separate "Log a shared expense" entry
  point in the tab bar. Per product feedback, both were merged into the normal personal-budget
  surfaces instead: 3b's due rows render inline in `PersonalDueRecurringWidget`'s existing due
  list (`src/components/personal-budget/personal-due-recurring-widget.tsx`), and 3a's posted
  rows render inline in `PersonalTransactionList`
  (`src/components/personal-budget/personal-transaction-list.tsx`), each row badged "Shared"
  (`Users` icon) rather than shown in a separate section. The standalone `SharedWithHouseholdCard`
  was removed entirely, and at the same time the "Log a shared expense" button/dialog was removed
  too. The text immediately below describes the original, now-superseded card/section shape; kept
  for context on the read-only-mirror reasoning, which still holds for 3a/3b's *display*.
- **Restored 2026-09-21 (later the same day)**: a direct follow-up request ("I can not log a
  transaction from my personal budget that is a shared expense — I want to be able to do it from
  there also") asked for the entry point back. `LogSharedExpenseDialog`
  (`src/components/personal-budget/log-shared-expense-dialog.tsx`) and
  `createSharedExpenseFromPersonalBudgetAction`
  (`src/app/dashboard/budget/actions.ts`) are back, triggered from a "Log a shared expense" button
  next to Personal Budget's "Add transaction" button (`PersonalBudgetTabs`), shown only for
  households the user belongs to with more than one member. This still writes to the same single
  household `Transaction`/`TransactionSplit` tables `createTransactionAction` does — no
  `PersonalTransaction` copy, no second ledger — so §2's and §6's "one ledger, no sync, never a
  second place to log the same bill" reasoning is unaffected: this is a second *entry point* into
  that one ledger, not a second ledger. The household budget remains the only place to *edit* or
  *delete* a shared expense once logged.
- Every row is a link ("View in {household name}'s Budget →") to
  `/dashboard/budget?month=...`, never an edit/delete/log-transaction control. The household
  budget stays the one place these get logged, edited, or acknowledged — the personal side is
  purely a mirror, which is what makes the "no sync needed" argument in §2 hold.
- **Safe to spend**: extend the personal page's call into `computeSafeToSpend` by feeding
  3b's due amounts in as extra `ExpectedRecurringExpense`-shaped rows alongside the user's own
  personal recurring estimate (no change to the pure function's signature — its existing
  `expectedRecurring` list is already just "amounts not yet logged that will reduce what's
  safe to spend"). Give each row returned to the UI an optional `source: "personal" | "shared"`
  tag (a display-layer addition, computed in `page.tsx`, not inside the pure calc function) so
  the breakdown list can badge shared rows distinctly rather than looking like the user's own
  bill.

## 4. Multi-household handling

A user can belong to more than one household today — `src/lib/session.ts`'s `requireHousehold`
already resolves a full `memberships` list per user and picks one as "active" via a cookie,
with `PushSubscription`'s own schema comment noting the same fact ("a user can belong to
multiple households"). Personal Budget's page currently calls `requireUserId()` only and never
looks at household membership at all.

**Recommendation: aggregate shared obligations across every household the user belongs to,
not just the currently-"active" one.** This is "money that's actually mine," which doesn't
depend on which household happens to be selected in a switcher elsewhere in the app. Cost is
one extra query (`prisma.householdMember.findMany({ where: { userId } })` to get the relevant
membership ids, then join splits/template-splits through those) — cheap, and avoids a
confusing "my rent disappeared from my personal budget because I switched active households"
bug.

## 5. Proposed implementation waves (not started — for a human to schedule)

- [x] **A. Posted shared transactions surface (no schema change)** — join this month's
      `TransactionSplit` rows across all the user's `HouseholdMember` ids, show them read-only
      in a new Personal Budget section (§3a). Lowest risk, ships independently, and already
      answers "a split bill I paid/owe shows up in my personal budget" for anything already
      logged.
- [x] **B. `RecurringTemplateSplit` + due-widget surfacing** — the schema addition and
      `RecurringTemplateDialog` UI in §3b, plus the personal-side due query. This is the piece
      that actually satisfies the literal "add Rent as a shared cost, it pops up under my
      personal budget" example, since it covers the anticipatory "due" case, not just
      after-the-fact postings. Real migration + UI work; depends on nothing in wave A but is
      the wave that matters most for the stated ask.
- [x] **C. Safe-to-spend + ledger polish** — thread wave A/B's rows into
      `computeSafeToSpend`'s breakdown with a `source`/household-name tag, add the "Shared"
      badge treatment (mirroring `TransactionList`'s existing "Split" badge convention), and
      decide whether posted shared transactions also belong in Personal Budget's
      Activity/transaction list (making the personal ledger a complete "everything affecting my
      money" view) or stay confined to the Overview section only (§7 leaves this open).
      Implemented initially confined to a dedicated "Shared with your household" Overview
      section, per §7/§8. **Superseded 2026-09-21** (see "Where it renders" above): posted
      shared rows now render inline in `PersonalTransactionList` itself, badged "Shared", so
      the personal transaction list is now the "everything affecting my money" view §7 asked
      about — the standalone card was removed.

Wave A alone is shippable and useful on its own; wave B is what the concrete example in the
request actually needs.

## 6. UX notes on staying intuitive

- **Always show the user's share, never the total.** Label it explicitly ("Your share:
  400.00 of 1,200.00 total") so nobody reads their personal budget as being on the hook for
  the whole rent.
- **Unmistakably read-only.** No edit/delete, no second "log this" button — a single "View in
  {household} Budget →" link. Two places to log the same bill is exactly the double-entry
  problem this design is built to avoid; the UI must never imply there's a second place to
  act.
- **Don't clutter the common case.** Most households have one household per user; only show
  the household name on a row when the user actually belongs to more than one (§4). For
  everyone else, "Rent — your share: 400.00" is enough.
- **Zero extra setup for the common path.** This falls out of the same "split this bill"
  checkbox members already use for settle-up (`TransactionDialog`/the proposed
  `RecurringTemplateDialog` addition) — nobody has to separately "link" a household category to
  a personal one. Split a bill once, it appears in every splittee's personal budget
  automatically.
- **Distinguish visually from the user's own entries** — same instinct as `TransactionList`'s
  existing "Split" badge with a payer tooltip; a shared row should never be visually
  indistinguishable from something the user personally logged in their own personal budget.

## 7. Non-goals

- Not a shared/pooled-wallet model — no money actually moves between household and personal
  budgets, and this doesn't change how `HouseholdBalances`/settle-up works.
- No auto-creating `PersonalTransaction` rows from household activity (or the reverse) — one
  direction, read-only, reference display only, per §2's reasoning.
- No settle-up/payment integration — matches `HouseholdBalances`' own documented
  read-only-for-now scope (REQUIREMENTS.md: "no payment integration of any kind").
- No retroactive backfill of `RecurringTemplateSplit` for existing templates — unsplit
  templates stay invisible to Personal Budget until a household member opts one into a split,
  the same "existing behavior unaffected until opted in" convention the original
  transaction-splitting feature used.

## 8. Open questions for a human

- Is wave B (a real schema migration) worth doing to get the "due, not yet logged" case, or is
  wave A alone (posted-only) an acceptable smaller first ship? The literal example in the
  request needs wave B.
- Copy/terminology for the new section ("Shared with your household" / "Shared costs" /
  something else) needs a product decision plus translation in both
  `src/lib/i18n/dictionaries/{en,sv}.ts`.
- Should a posted shared transaction also appear in Personal Budget's Activity/transaction
  list (a fuller "everything affecting my money" ledger), or stay confined to a dedicated
  Overview section? Leaning toward Overview-only for the first pass, to keep the personal
  transaction list unambiguously "things I logged myself."
- Confirm the multi-household aggregation call in §4 (all households vs. active-only) — it's a
  product decision even though the technical cost is symmetric either way.
