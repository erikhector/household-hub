# Meal prep (GAP-49) — design

Status: implemented 2026-10-14 (shipped behaviour documented in REQUIREMENTS.md,
"Meal prep (GAP-49)"; see "Refinements during implementation" below).
Backlog item: GAP-49 (done, removed from BACKLOG.md). Schema slice already landed (PR #179):
`PreparedBatch`, `MealPlanEntry.preparedBatchId`,
`MealPlanEntry.preparedPortionsUsed`. **No schema change in this work.**

## Goal

A household cooks several dishes in advance ("Sunday: 8 portions chili, 6
portions curry") and spends those portions across the meal planner. The app
tracks how many portions of each batch are left, so planner and fridge
agree.

Success: record batches, assign portions to planner slots, and see the
remaining count go down on assign and back up on unassign/delete.

## Decisions taken

1. **Batches replace GAP-8 leftovers going forward.** "Servings left over" in
   the mark-cooked dialog creates a `PreparedBatch` instead of a
   "Leftovers: …" `InventoryItem`. Existing leftovers inventory rows are left
   untouched (no data migration).
2. **Ingredients are deducted when a batch is recorded**, through the same
   ingredient review step "Mark as cooked" uses. Eating a batch-linked slot
   deducts nothing.
3. **A new "Prep" tab** in meal planning, a "From meal prep" source in the
   add-meal dialog, and a "Meal prep" card on the home dashboard.

## Data rules

- `remainingPortions` = portions not yet assigned to a planner slot.
  Invariant: `0 ≤ remainingPortions ≤ totalPortions`.
- Assigning n portions to a slot: requires `n ≥ 1` and
  `n ≤ remainingPortions`; sets `preparedBatchId`,
  `preparedPortionsUsed = n`, and `portions = n`; decrements the batch by n.
  The decrement is a conditional `updateMany` (`remainingPortions >= n`,
  household-scoped) so concurrent assigns can never drive it negative; a
  zero-row update aborts the transaction.
- A batch-linked entry always has `recipeId = batch.recipeId`.
- Unassigning, or deleting a linked entry, returns `preparedPortionsUsed` to
  the batch (capped at `totalPortions`) and resets the pair to
  `null`/`0`, in the same transaction.
- Moving a linked entry keeps the link (portions are unchanged).
- Discarding a batch deletes it; linked entries keep their recipe and lose
  the link (schema `SetNull`). `preparedPortionsUsed` on those entries is
  reset to 0 in the same transaction so the pair stays in step.
- Default eat-by date: `cookedAt + LEFTOVERS_SHELF_LIFE_DAYS` (3 days),
  overridable per batch. Stored on `expiryDate`.
- Bounds: 1–5 dishes per prep, 1–`MAX_LEFTOVER_SERVINGS` (100) portions per
  batch.
- A batch is "active" while `remainingPortions > 0` or any entry still links
  to it. Inactive batches are not shown anywhere; they are kept (no
  background deletion) until discarded or until their recipe is deleted.

## Units

### `src/app/dashboard/meal-planning/prepared-batch-calc.ts` (pure)

Zod schemas and arithmetic, unit-tested in `prepared-batch-calc.test.ts`:
- `recordPrepSchema` — array of `{ recipeId, portions, expiryDate? }`.
- `assignPortionsSchema` — `{ batchId, slots: { date, mealType, portions }[] }`.
- `defaultBatchExpiry(cookedAt)`.
- `portionsAfterAssign(remaining, requested)` → new remaining or error.
- `portionsAfterReturn(remaining, total, returned)` → capped value.
- `isActiveBatch(batch, linkedEntryCount)`.

### `src/app/dashboard/meal-planning/prep-actions.ts` ("use server")

Every action calls `requireHousehold()`; every id from the client is
re-checked against the household; every write is one `$transaction`.

- `recordPrepAction(input)` — creates the batches (`cookedByMemberId` = the
  session member) and deducts each recipe's ingredients scaled to
  `portions / recipe.servings`, reusing the deduction and AUTO-8
  low-stock/"Next shop" logic shared with `markMealEntryCookedAction`
  (extracted into a shared helper in `cooked-ingredients.ts` rather than
  duplicated). The client sends the reviewed ingredient list exactly as
  mark-cooked does. Returns an undo payload (batch ids, credited
  quantities, auto-added rows).
- `undoRecordPrepAction(payload)` — deletes those batches and credits the
  ingredients back; refuses (translated error) if any of them has a linked
  entry.
- `assignBatchPortionsAction(input)` — for each slot, creates an entry in
  that week's `MealPlan` (find-or-create as `addMealEntryAction` does) or
  links an existing unlinked entry with the same recipe in that slot. All
  or nothing. Slot holding a different dish → validation error.
- `unassignBatchPortionAction(entryId)`.
- `discardBatchAction(batchId)` + `undoDiscardBatchAction(snapshot)`
  (restores the batch and re-links the entries that were linked).

### Changes to existing actions

- `deleteMealEntryAction` (planner-actions.ts): return portions when the
  entry is linked.
- `addMealEntryAction`: accepts an optional `preparedBatchId` (the "From
  meal prep" source), routed through the same assign logic.
- `markMealEntryCookedAction` / `undoMarkMealEntryCookedAction`
  (cooking-actions.ts): for a linked entry, set/clear `consumedAt` only, no
  ingredient movement. For leftovers > 0, create a `PreparedBatch`
  (`totalPortions = remainingPortions = leftovers`, default expiry) instead
  of the inventory row; `LeftoversChange` becomes `{ batchId }` and undo
  deletes it (refusing if it has been planned, same as undoRecordPrep).
- `suggestLeftoversDayAction`: becomes "assign 1 portion of this batch to
  the next free dinner" via the assign logic. *Refined: it stays a
  read-only suggestion; see below.*
- The meal-planning page query loads active batches (with recipe name,
  cook's name, linked-entry count) once and passes them to the tabs.

## UI

All strings in `en.ts` and `sv.ts` under `mealPlanning.prep*`. DESIGN.md
M1–M10 apply; 44 px targets, steppers instead of typing for portions.

- **Prep tab** (`?tab=prep`, `src/components/meal-planning/prep-tab.tsx`):
  full-width "Record prep" button at the top; one card per active batch,
  soonest eat-by first: recipe name, "5 of 8 portions left", `ExpiryBadge`
  for the eat-by date, "Cooked by <name> · <day>", actions **Plan portions**
  (primary) and **Discard** (confirm, then undo toast). Empty state explains
  meal prep and shows the button.
- **Record prep dialog** (`record-prep-dialog.tsx`): step 1, dish rows
  (recipe combobox, portions stepper defaulting to `recipe.servings`,
  optional eat-by date), "Add another dish" up to 5; step 2, the existing
  `IngredientReviewStep` over the combined ingredients. Success toast:
  "Recorded 2 dishes · 14 portions" with Undo and Plan portions.
- **Plan portions dialog** (`plan-portions-dialog.tsx`): week view (prev /
  next week), per day the four meal slots; empty slots and same-recipe
  unlinked slots are selectable, others disabled with their dish name.
  Selected slots get a portions stepper (default 1). Live "3 of 5 left after
  this"; save disabled when over.
- **Add-meal dialog**: a third source "From meal prep" listing active batches
  with portions left, plus a portions stepper.
- **Planner slot**: linked entries show a "Prepped" badge; menu gains
  "Don't use prep" (unassign); the cook button reads "Eaten".
- **Mark-cooked dialog**: "Servings left over" copy updated to say it goes to
  meal prep.
- **Home dashboard** (`src/app/dashboard/page.tsx`): "Meal prep" card, shown
  only with active batches; up to 3 batches with portions left and eat-by,
  link to `?tab=prep`.

No browser storage added.

## Testing

- Unit: `prepared-batch-calc.test.ts`; `prep-actions.test.ts` (tenancy incl.
  foreign batch/entry/recipe ids, validation, over-assign rejected, partial
  assign rolls back, return on unassign/delete, undo blocked once planned,
  ingredient deduction scaled by portions); updated
  `planner-actions.test.ts` and `cooking-actions.test.ts` (linked entry
  eaten without deduction, leftovers create a batch).
- e2e: `e2e/meal-prep.spec.ts` on desktop + mobile — record a 4-portion
  batch of a seeded recipe → plan 2 portions on two days → reload, badges
  and "2 of 4 left" → delete one slot → "3 of 4 left" → mark the other
  "Eaten", inventory unchanged → discard. Update the leftovers flow test.
  Add `?tab=prep` to `e2e/routes.ts` if tab variants are listed there.

## Docs

REQUIREMENTS.md: new "Meal prep (GAP-49)" section, update the Leftovers
(GAP-8) section and the `PreparedBatch` data-model note; delete GAP-49 from
BACKLOG.md. PR title `feat: meal prep batches (GAP-49)`, release note in en
and sv.

## Refinements during implementation

- **Plan leftovers stays a suggestion and links the batch.** The toast's
  "Plan leftovers" still only opens `AddToPlanDialog` prefilled with the
  next free dinner; it doesn't assign anything by itself (Guardrails:
  suggest, don't silently mutate). Confirming posts the leftovers batch's
  id as `preparedBatchId`, so `addMealEntryAction` plans the slot through
  `assignInTx` and it eats from the batch.
- **Past days are not selectable** in the Plan portions dialog: days before
  today are shown, disabled. Prepped food can't be eaten in the past. The
  server still accepts such a slot, harmlessly.
- **Editing a linked entry's recipe or portions unlinks it** (returning its
  portions), so a linked entry always eats the batch's dish at the batch
  size. Copy week and fill empty days never copy a batch link.
- **Returning portions is an optimistic write** guarded on the
  `remainingPortions` just read; a lost race rolls back and answers with
  the generic "Something went wrong" error so the household retries.
- **Undo discard re-links only entries that still fit** (same household,
  unlinked, same dish and portions); the rest have their portions returned
  to the batch.
- **"Mark as eaten"** is the linked entry's cook action (not "Eaten"), and
  its dialog posts no ingredient rows.
- **Mixed units in the prep preview**: a merged row whose dishes use
  different recipe units states the need in the item's own unit instead of
  summing across units.
- The shared inventory helper is `cook-inventory.ts` (not
  `cooked-ingredients.ts`), and the assign/return plumbing is the plain
  server module `prep-assign.ts`.

## Out of scope

Freezer/fridge location, splitting or merging batches, editing a batch's
portion count after recording, migrating old "Leftovers:" inventory rows.
