# Recipe ingredient matching: design and implementation plan

Status: **proposed**. Tracked in BACKLOG.md as `MATCH-1` … `MATCH-5`. When an
item ships, document the behaviour in REQUIREMENTS.md ("Meal planning" →
"Ingredient → inventory linking" and "Recipe import from URL"), delete the
backlog item, and move this file to `docs/archive/` once every item is done.

## 1. The problem

Saving a recipe links each ingredient row to an `InventoryItem`, and it does
this silently. `parseIngredientRows`
(`src/app/dashboard/meal-planning/recipe-actions.ts`) runs a
case-insensitive **exact** name lookup, and every name that doesn't match
becomes a new inventory item (`quantity: 0`, `lowStockThreshold: 0`, guessed
category). Nobody sees or approves that step. With an imported recipe it
goes wrong in predictable ways:

| Imported line | What happens today | What the user wanted |
|---|---|---|
| `3 eggs` | new item "eggs" next to the existing "Egg" | link to "Egg" |
| `2 dl crème fraiche, gärna lätt` | new item "crème fraiche, gärna lätt" | link to "Crème fraiche" + note "gärna lätt" |
| `1 gul lök, finhackad` | new item "gul lök, finhackad" | link to "Gul lök" |
| `½ tsk salt` | `½` isn't parsed, so the whole line becomes the name "½ tsk salt" | link to "Salt", or don't track it |
| `1,5 dl mjölk` | `1,5` isn't parsed, so the whole line becomes the name | 1.5 dl → "Mjölk" (stored in l) |
| `2-3 vitlöksklyftor` | new item "-3 vitlöksklyftor" | 3 cloves → "Vitlök" |
| `300 g vetemjöl` (pantry counts flour in `pcs` = bags) | links, but every cook/shopping preview reports a unit mismatch | remember "1 pcs = 2000 g" once |
| `vatten` | new inventory item "vatten" | not tracked at all |

The effects add up:

- **Inventory clutter.** One import can add 5–15 zero-stock phantom items.
  They show up in inventory, search, category chips, "Use it up" and the
  AI category fallback.
- **Wrong numbers downstream.** "What can I cook?", "Add missing
  ingredients", "Mark as cooked" and recipe cost all use
  `RecipeIngredient.inventoryItemId`. A phantom duplicate always reads as 0
  in stock, so a recipe you could cook shows as missing ingredients and the
  shopping list asks you to buy eggs you already have.
- **Unit mismatches never resolve.** `src/lib/units.ts` only converts
  within one dimension (volume↔volume, weight↔weight). Weight vs volume and
  count vs measure hit `unitMismatch` in `cooked-ingredients.ts` every time,
  and nothing is remembered, so the user fixes the same flour/egg/onion
  mismatch on every cook.
- **Edits re-link by name.** `updateRecipeAction` deletes and recreates
  every row, then re-runs find-or-create. Fixing a typo in one ingredient
  name can quietly create another item.

The same silent find-or-create also happens in
`addMissingIngredientsToShoppingListAction`
(`meal-planning/cooking-actions.ts`), but only for ingredients that aren't
linked.

The rest of the app already stopped doing this. Shopping-list import,
templates and smart-add leave unmatched rows **unlinked** for "Resolve
mappings" (`createInventoryLinker`, `ResolveMappingsDialog`). Receipt
registration shows a "Use existing / Create new" review with confident
matches auto-accepted (AUTO-11, `matchReceiptLines`). Recipes are the last
path that still creates silently.

## 2. How others solve it

| App | Model | What we take from it |
|---|---|---|
| **Mealie** | Separate *Foods* and *Units* tables, each with **aliases**. After import, a **"Parse ingredients"** screen shows each line split into amount / unit / food / note, with the matched food or a **"Create food"** button. There are several parser back-ends (brute-force, NLP/CRF, OpenAI). | A per-line review that shows the original text next to the parsed result. Aliases so a synonym is fixed once. A separate *note* field for prep text. Users complain about the friction of parsing every recipe by hand ([Mealie survey Q12](https://mealie.io/news/surveys/2024-october/q12/)) and about aliases the parser ignores ([mealie#6841](https://github.com/mealie-recipes/mealie/issues/6841)), so **confident rows must not need a click**, and aliases must be used by the matcher itself. |
| **Tandoor** | Food/unit **alias automations**, "never a unit" rules, word transposition. These run on every import and on the simple ingredient input. Foods have per-food properties and an "ignore shopping" flag. | Aliases are learned rules that run automatically before the user sees anything. Some foods (water, and salt for many households) are **never tracked**. ([Tandoor automation docs](https://docs.tandoor.dev/features/automation/)) |
| **Grocy** | Every recipe ingredient must be a *product*. **Global unit conversions** (1 kg = 1000 g) plus **product-specific conversions** (1 pack = 6 pcs, 1 dl rice = 85 g). An ingredient can be set to only check that "any amount" is in stock. With no conversion, the recipe amount goes to the shopping list unchanged. ([grocy food tutorial](https://github.com/grocy/grocy-docs/blob/master/tutorials/food.md), [grocy#1132](https://github.com/grocy/grocy/issues/1132)) | **Per-item unit conversions** are the right answer to weight↔volume↔count, because density belongs to the ingredient, not to the unit. Keep today's "leave it, ask at cook time" as the fallback. |
| **AnyList / Paprika / Mealime / Plan to Eat** | No inventory. Ingredients merge into list items by name, and the category is learned. | Low friction is the baseline users expect, so the review has to feel lighter than retyping. |
| **Squirrel, receipts (AUTO-11)** | Rows sorted by confidence, confident rows collapsed into "N items matched", one Apply, explicit per-row choice sent to the server. | Copy the interaction exactly. Users already know it, and it satisfies the Guardrails' "suggest, don't silently mutate". |

**Conclusion.** Squirrel needs three things. Every approach above has them
in some form, but none has all three with low friction.

1. A **review step** that only asks about rows it isn't sure of.
2. **Learned memory**: *aliases* (this name means that item) and *per-item
   unit conversions* (for this item, 1 dl = 60 g). Next time, the same
   decision is automatic.
3. A **better line parser**, so the matcher gets a clean name and the prep
   text ends up in a note.

## 3. Proposed flow

### 3.1 Two-step recipe dialog

`RecipeFormDialog` gets a second step inside the same dialog (a content
swap with a Back button, no nested dialog, so it works on the 412 px mobile
layout).

```
 Step 1: Recipe (as today)                Step 2: Match ingredients
 ┌───────────────────────────────┐       ┌────────────────────────────────────┐
 │ Import from URL [……] [Import] │       │ ← Back        Match ingredients     │
 │ Name, servings, tags, …       │       │                                    │
 │ Ingredients                   │  ───▶ │ ✓ 9 matched to your pantry  [Show] │
 │  2 dl  crème fraiche          │ Next  │                                    │
 │  3 pcs eggs                   │       │ Needs a look (3)                   │
 │  …                            │       │ ┌────────────────────────────────┐ │
 │                 [Save]        │       │ │ "3 eggs"                       │ │
 └───────────────────────────────┘       │ │ (•) Use existing [Egg      ▾]  │ │
                                         │ │ ( ) Create new   ( ) Don't track│ │
                                         │ │ 3 pcs → pantry counts pcs  ✓   │ │
                                         │ └────────────────────────────────┘ │
                                         │ ┌────────────────────────────────┐ │
                                         │ │ "300 g vetemjöl"               │ │
                                         │ │ (•) Use existing [Vetemjöl ▾]  │ │
                                         │ │ ⚠ Recipe uses g, pantry counts │ │
                                         │ │   pcs.                         │ │
                                         │ │ (•) Remember: 1 pcs = [2000] g │ │
                                         │ │ ( ) Use [0.15] pcs here only   │ │
                                         │ │ ( ) Decide when cooking        │ │
                                         │ └────────────────────────────────┘ │
                                         │ ┌────────────────────────────────┐ │
                                         │ │ "vatten"                       │ │
                                         │ │ ( ) Use existing ( ) Create new│ │
                                         │ │ (•) Don't track                │ │
                                         │ └────────────────────────────────┘ │
                                         │                          [Save]    │
                                         └────────────────────────────────────┘
```

**When step 2 appears.** Pressing Save in step 1 first calls a read-only
`previewIngredientMatchesAction`.

- **Every row is confident** (see 3.2) and every unit reconciles: the
  recipe saves straight away with no step 2. The toast says
  "Saved · 9 ingredients linked to your pantry". Editing a recipe you've
  already matched costs nothing extra.
- **Anything is uncertain**: the dialog goes to step 2 and the button on
  step 1 reads "Next: match ingredients". Nothing has been written yet.
- After a URL import the dialog always shows the step-1 fields first, as
  today, so the user can fix names and amounts before matching.

**Row states** (each row has one decision, sent explicitly to the server):

| Decision | Meaning | Default when |
|---|---|---|
| **Use existing** | link to the chosen `InventoryItem` | exact / alias / confident fuzzy match, or any fuzzy suggestion ≥ 0.35 |
| **Create new** | create an item with an editable name, category (resolver guess) and **unit** | no suggestion clears 0.35 |
| **Don't track** | save the ingredient with no inventory link, skipped by cook/shopping/cost | name is in a small built-in staples list (water / vatten, ice / is) or was set that way before (alias memory) |

Rows already linked when a recipe is edited carry their `inventoryItemId`
through step 1 as hidden fields. They are **not re-matched** unless the
name was changed. That fixes the "renaming re-links" problem.

**Batch helpers** for long imports: "Create all new" (everything left over
becomes Create new with guessed categories) and "Don't track the rest".
Both only change decisions in the UI. Nothing is written until Save.

### 3.2 Matching order (pure, `src/lib/recipes/ingredient-match.ts`)

For each parsed row name `n`, against the household's inventory, aliases
and "untracked" memory:

1. **Existing link** (edit only, name unchanged): keep it. Confident.
2. **Exact** normalized name (`normalizeItemName`): confident.
3. **Alias** (`ItemAlias`, MATCH-2): confident. An alias can point at an
   item or say "untracked".
4. **Plural/singular fold**: strip a final English `-s`/`-es` or Swedish
   `-ar/-or/-er/-na` and compare again (the same fold the substitutions
   table uses). Confident only if exactly one item matches.
5. **Fuzzy** `findInventoryMatches`: confident only when score ≥ 0.9 **and**
   it leads the runner-up by ≥ 0.15 (the AUTO-11 thresholds). A best guess
   ≥ 0.35 is pre-selected but left open for review.
6. Otherwise, no suggestion (defaults to Create new).

A confident match on the name alone isn't enough: the **unit must also
reconcile** (3.3) for the row to skip review.

### 3.3 Units: reconcile, remember or override

For recipe unit `U`, the linked item's unit `I`, and the item's stored
conversions:

| Class | Example | Review needed? |
|---|---|---|
| **same** (after canonicalizing synonyms: `st`/`pc`/`piece`/`pcs`, `msk`/`tbsp`, `tsk`/`tsp`, `l`/`liter`, …) | 3 st egg → egg in pcs | no |
| **convertible** by the generic table (`units.ts`) | 2 dl milk → milk in l | no |
| **known for item**, a saved `ItemUnitConversion` (MATCH-3) applies directly or through the generic table | 300 g flour → flour in pcs, with 1 pcs = 2000 g saved | no |
| **unknown**: different dimension, count vs measure, or unrecognized unit | 300 g flour → flour in pcs, nothing saved | **yes** |

For an unknown row the review offers three choices:

1. **Remember for this item**: "1 pcs = [2000] g". Saved as an
   `ItemUnitConversion`, so every recipe, cook, shopping preview and cost
   estimate uses it from now on. This is the Grocy product-conversion
   model. Pre-filled from a small built-in table of typical densities and
   piece weights (flour ≈ 0.6 g/ml, sugar ≈ 0.85 g/ml, egg ≈ 55 g,
   onion ≈ 150 g, …) when the item name matches, shown with "≈" like
   estimated expiry dates. Otherwise left empty.
2. **Override for this recipe only**: rewrite this row's amount in the
   item's own unit ("[0.15] pcs"). The original text is kept in
   `RecipeIngredient.rawText` so the recipe still reads "300 g vetemjöl" to
   the cook.
3. **Decide when cooking**: today's behaviour. The row stays mismatched
   and `MarkCookedDialog` asks for the amount.

**Unit for a new item.** Pantries count things differently from how
recipes measure them, so the default is picked per dimension, and is
always editable:

- count units (`pcs`, `st`, `can`, `clove`, …): the recipe's unit,
  canonicalized
- volume ≥ dl (`dl`, `l`, `cup`): `l`
- weight: `g`
- spoon measures and `pinch`/`krm`: `pcs` (you buy a jar of spice, not
  3 tsp of it), with a hint that "Don't track" may fit better

If the chosen new-item unit doesn't reconcile with the recipe unit, the
same three unit choices appear on the row.

### 3.4 What the save action receives and does

The save action gets new parallel `FormData` arrays, shaped like today's
`ingredientName`/`ingredientQuantity`/`ingredientUnit`, one entry per row:

- `ingredientDecision`: `existing` | `new` | `untracked`
- `ingredientItemId` (for `existing`)
- `ingredientNewName`, `ingredientNewCategory`, `ingredientNewUnit` (for `new`)
- `ingredientUnitAction`: `none` | `remember` | `override` | `defer`, plus
  `ingredientUnitFactor` for `remember`
- `ingredientRawText`, `ingredientNote`

Server rules (in `recipe-actions.ts`):

- `requireHousehold()`. Every `ingredientItemId` is checked in one
  `inventoryItem.findMany({ where: { id: { in }, householdId } })`. An
  unknown or foreign id is rejected, never silently created.
- Zod validates each decision, and the length caps stay as today
  (and the row count is capped, which also covers SEC-7's recipe part).
- `new` rows are created in one `createManyAndReturn`, deduped by
  normalized name as today, with the category resolver + AI fallback as
  today.
- A row with **no decision** (an old client, or a direct POST) falls back
  to *link if exact, otherwise leave unlinked*. It **never creates**. That
  matches the shopping-list linkers.
- Recipe, rows, created items, new aliases and new conversions are written
  in **one `$transaction`**.
- **Learning** (MATCH-2/3): when the user links name `n` to item `X` and
  `normalize(n) ≠ normalize(X.name)`, upsert `ItemAlias(n → X)`. When they
  pick Don't track, upsert `ItemAlias(n → untracked)`. Accepting a
  pre-selected *confident* match doesn't write an alias (it would match
  again anyway). `remember` upserts `ItemUnitConversion`.

### 3.5 Downstream effects

- `expandRecipeIngredients` / `loadRecipeGraph` skip `untracked` rows for
  inventory purposes. They still show in the recipe card.
- A row with `inventoryItemId = null` **and** `untracked = false` keeps
  today's name-fallback (its item was deleted, `onDelete: SetNull`).
- `missing-ingredients.ts`, `cooked-ingredients.ts`, `recipe-cost.ts` and
  `cookable-recipes.ts` switch from `convertQuantity`/`unitsAreComparable`
  to one `convertForItem(qty, fromUnit, item, conversions)` in
  `units.ts`. It tries same unit, the generic table, then the item's
  conversions, alone or chained through the generic table. The loader
  fetches conversions for the household once per request (PERF-1 style).
- `addMissingIngredientsToShoppingListAction` stops find-or-creating. A
  row without an item becomes an **unlinked** shopping-list item for
  "Resolve mappings", the same as import and templates.
- **Aliases pay off elsewhere** (MATCH-5): `createInventoryLinker`
  (import, templates, smart-add), the receipt matcher and
  `ResolveMappingsDialog` consult `ItemAlias`. Fixing "eggs → Egg" once
  then also fixes shopping lists and receipts.

## 4. Data model (MATCH-2, MATCH-3)

```prisma
model RecipeIngredient {
  // …existing fields…
  untracked Boolean @default(false) // "Don't track": no inventory link on purpose
  rawText   String?                 // original imported/typed line, shown to the cook
  note      String?                 // prep text split off the name ("finely chopped")
}

// A household's learned "this ingredient/product name means that item".
// `inventoryItemId = null` means "this name is never tracked" (e.g. vatten).
model ItemAlias {
  id              String   @id @default(cuid())
  householdId     String
  normalizedName  String   // normalizeItemName(name)
  inventoryItemId String?
  createdAt       DateTime @default(now())

  household     Household      @relation(fields: [householdId], references: [id], onDelete: Cascade)
  inventoryItem InventoryItem? @relation(fields: [inventoryItemId], references: [id], onDelete: Cascade)

  @@unique([householdId, normalizedName])
  @@index([inventoryItemId])
}

// Per-item conversion into the item's own unit: 1 `fromUnit` = `factor` × item.unit.
// Only needed where units.ts's generic table can't convert (weight↔volume, count↔measure).
model ItemUnitConversion {
  id              String   @id @default(cuid())
  inventoryItemId String
  fromUnit        String   // canonicalized unit
  factor          Float    // > 0
  createdAt       DateTime @default(now())

  inventoryItem InventoryItem @relation(fields: [inventoryItemId], references: [id], onDelete: Cascade)

  @@unique([inventoryItemId, fromUnit])
}
```

Tenancy: `ItemUnitConversion` is always reached through an item that has
already been checked against the household. `ItemAlias` carries
`householdId` because the untracked alias has no item.

Changing an item's unit in the item form: conversions whose `fromUnit` is
now the item's own unit are deleted. The rest become wrong in scale, so
the form asks the user to review them (the item dialog shows a small
"Unit conversions" list where each can be edited or removed). Deleting an
item cascades both tables.

## 5. Parser improvements (MATCH-4, pure, no schema)

`parseIngredientString` in `src/lib/recipe-import.ts`, all unit-tested with
Swedish and English fixtures:

- Unicode fractions (`½ ¼ ¾ ⅓ ⅔`), `1½`, comma decimals (`1,5`), ranges
  (`2-3`, `2–3`: take the upper bound and keep "2–3" in the note),
  leading `ca`/`about`/`ungefär`.
- Units attached to the number (`500g`, `2dl`), `st`/`pcs` canonicalized.
- **Prep-note split**: text after the first comma, or inside parentheses,
  goes to `note` ("1 gul lök, finhackad" → name "gul lök", note
  "finhackad"). Also a small list of leading prep adjectives (`finhackad`,
  `riven`, `chopped`, `grated`, …) are moved to the note.
- "Salt och peppar" / "salt and pepper" are split into two rows.
- Imported lines keep their original text (`rawText`).

This helps even before MATCH-1, because cleaner names match more often.

## 6. Existing data (MATCH-5)

Households already have phantom items. Two cleanup tools, both
review-first:

- **"Review ingredient matches"** on the recipe manager opens step 2 for
  one recipe with its current links shown as decisions, so a wrong link
  can be moved.
- **Merge items** (inventory item menu → "Merge into…"): moves
  `RecipeIngredient`, `ShoppingListItem`, `PriceHistory` and barcode links
  to the target, adds stock (converted via 3.3), writes an alias from the
  old name, then deletes the old item. Offered as a suggestion on items
  that have `quantity 0`, no stock history, are only referenced by recipes,
  and have a confident fuzzy match to another item.

## 7. Implementation plan

Order matters: MATCH-4 and MATCH-1 need no schema change. MATCH-2 and
MATCH-3 each add one migration (Phase 2 rules: one at a time).

| ID | Scope | Schema | Size |
|---|---|---|---|
| **MATCH-4** | Parser improvements (§5) | none | S |
| **MATCH-1** | Stop silent creation: pure matcher, preview action, step-2 review, explicit decisions on save, keep links on edit, shopping bridge stops creating (§3.1, 3.2, 3.4, 3.5 minus untracked/aliases/conversions) | none | M |
| **MATCH-2** | "Don't track" + `rawText`/`note` + `ItemAlias` learning and lookup (§3.4 learning, §4) | 1 migration | M |
| **MATCH-3** | `ItemUnitConversion`, `convertForItem`, unit choices in review, density hints, conversions list in the item dialog (§3.3) | 1 migration | M |
| **MATCH-5** | Aliases in shopping/receipt linkers, recipe "Review ingredient matches", Merge items (§3.5 last bullet, §6) | none | L |

### MATCH-1 file-level plan

- `src/lib/recipes/ingredient-match.ts` (new, pure) and its test:
  `matchIngredientRows(rows, inventory, { existingLinks })` →
  `{ rowIndex, status: "confident" | "suggested" | "none", itemId?,
  candidates[], unitClass }`. Reuses `normalizeItemName`,
  `findInventoryMatches` and the AUTO-11 thresholds (moved to a shared
  constant, not copied).
- `src/lib/units.ts`: add `canonicalUnit()` (count and Swedish synonyms)
  and `classifyUnits()`. `unitsAreComparable` uses the canonical form.
- `recipe-actions.ts`: `previewIngredientMatchesAction(rows)` (read-only,
  `requireHousehold`, one inventory `findMany`).
  `parseIngredientRows` → `resolveIngredientDecisions` (explicit decisions,
  validation, one transaction, no create without `new`). A row cap (e.g.
  100).
- `cooking-actions.ts`: the bridge leaves unmatched rows unlinked.
- `src/components/meal-planning/recipe-form-dialog.tsx`: step state, hidden
  link fields per row. New `ingredient-review-step.tsx` built from
  `AutoMatchedSection` and the `ResolveMappingsDialog` row UI
  (`ItemCombobox`, `ComboField` for category).
- `en.ts` / `sv.ts`: `mealPlanning.ingredientReview.*` (title,
  matchedSummary {one, other}, needsLook, useExisting, createNew,
  dontTrack, createAllNew, back, next, unit hints, savedLinked
  {one, other}).
- Tests:
  - `ingredient-match.test.ts`: exact, plural fold, fuzzy margin, ties
    stay open, units.
  - `recipe-actions.test.ts`: foreign item id rejected, no decision →
    never creates, `new` creates with category, edit keeps links, one
    transaction.
  - `e2e/recipe-ingredients.spec.ts`: type "Tomatos" against seeded
    "Tomatoes", review suggests it, save, reload, the inventory count is
    unchanged. An all-confident recipe saves without step 2. Runs on
    desktop and mobile.

### Open questions for the product owner

1. **Salt/pepper/oil default**: link if the item exists, otherwise default
   to *Don't track* rather than *Create new*? (Proposed: only water and ice
   default to Don't track. Everything else follows the normal rules, and
   aliases remember the household's choice.)
2. **Density hint table**: ship with MATCH-3, or start with empty factor
   fields and add hints later? (Proposed: ship a short table of about 20
   staples, marked "≈".)
3. **Aliases outside recipes** (MATCH-5): should an alias learned in the
   recipe review also auto-link shopping-list rows? (Proposed: yes. It's
   the same household vocabulary.)

## Sources

- Mealie: [ingredient parser guide](https://mealie.io/contributors/guides/ingredient-parser/),
  [FAQ](https://mealie.io/documentation/getting-started/faq/),
  [2024 survey feedback on recipes](https://mealie.io/news/surveys/2024-october/q12/),
  [unit alias bug #6841](https://github.com/mealie-recipes/mealie/issues/6841)
- Tandoor: [automation docs](https://docs.tandoor.dev/features/automation/)
- Grocy: [food tutorial](https://github.com/grocy/grocy-docs/blob/master/tutorials/food.md),
  [recipe unit conversion request #1132](https://github.com/grocy/grocy/issues/1132),
  [linked quantity units #177](https://github.com/grocy/grocy/issues/177)
- In-repo precedent: REQUIREMENTS.md "Receipt scanning" (AUTO-11),
  shopping list "Resolve mappings", "Mark meal as cooked" (`unitMismatch`)
