# Recipe ingredient matching: design and implementation plan

Status: **proposed**. Tracked in BACKLOG.md as `MATCH-1` … `MATCH-7`. When an
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
the form sends the user to the item page (§6.1), where "Change unit…"
converts stock and re-expresses the conversions in one step. Deleting an
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

## 6. Item catalog: usage, units and duplicates (MATCH-6, MATCH-7)

Matching only works if the item list it matches against is clean.
Households already have phantom items and duplicates ("Egg" / "eggs" /
"Ägg"). Even after MATCH-1 there is no place to see how an item is used or
to fix its units. So the design adds two pages under inventory.

### 6.1 Item page `/dashboard/inventory/items/[id]` (MATCH-6)

This opens from an item row's menu ("Details"), from the catalog below, and
from a linked ingredient in the recipe card and review step. It has four
sections:

```
┌ Vetemjöl ───────────────────────────── Baking · Pantry ┐
│ In stock: 1 pcs          [Change unit…]                  │
│                                                          │
│ Units                                                    │
│   Counted in pcs                                         │
│   1 pcs = 2000 g                          [Edit] [✕]     │
│   1 dl  = ≈ 60 g                          [Edit] [✕]     │
│   [+ Add conversion]                                     │
│   Try it: [300] [g ▾] = 0.15 pcs                         │
│                                                          │
│ Used in 4 recipes                                        │
│   Pannkakor      3 dl   = 0.009 pcs  ✓                   │
│   Kanelbullar    750 g  = 0.375 pcs  ✓                   │
│   Pizzadeg       5 dl   = 0.015 pcs  ✓                   │
│   Sockerkaka     2 cups             ⚠ [Add cups…]        │
│                                                          │
│ Also on          Weekly list (1 pcs) · Template "Bak"    │
│ Names that map here   vetemjol · wheat flour  [✕]        │
│                                                          │
│ [Merge into another item…]                               │
└──────────────────────────────────────────────────────────┘
```

- **Used in.** Every `RecipeIngredient` linked to the item, with the
  amount as the recipe writes it and the same amount in the item's unit
  through `convertForItem` (§3.3). A row that can't convert gets ⚠ and an
  inline "Add {unit}…" button that opens the add-conversion form with that
  unit filled in. Fixing it there fixes that recipe's cook, shopping and
  cost numbers everywhere. Each recipe name opens that recipe. Also lists
  pending shopping-list rows and templates that point at the item.
- **Units.** The item's `ItemUnitConversion` rows (MATCH-3), which can be
  added, edited and deleted. The "Try it" line is a live calculator, so a
  factor can be sanity-checked before it's trusted. Density hints (§3.3)
  pre-fill new rows, marked "≈".
- **Change unit…** (e.g. flour from `pcs` to `g`). This is a dialog with the
  new unit and a factor, pre-filled when the generic table can convert
  (`l` → `dl` = 10). It shows the result before saving
  ("1 pcs → 2000 g, low-stock at 0.5 pcs → 1000 g") and, in one
  transaction, converts `quantity` and `lowStockThreshold` and re-expresses
  every conversion (`factor ÷ f`). The old unit becomes a conversion
  (`1 pcs = 2000 g`), so recipes and lists written in the old unit keep
  working. `lastKnownPrice` and `PriceHistory` stay as they are: they're
  per purchase line and already record their own unit (GAP-9). This is
  the only place stock is converted between units. The item form's unit
  field stays a plain edit for items with no stock.
- **Names that map here.** The item's `ItemAlias` rows (MATCH-2), each
  removable, so a wrong learned match can be undone.

### 6.2 Catalog `/dashboard/inventory/items` (MATCH-7)

A list of every item, reached from "Manage items" in the inventory page's
menu. The menu entry shows a badge with the number of open duplicate groups.
The list has filter chips:

| Chip | Shows |
|---|---|
| **All** | name, category, stock + unit, "used in N recipes" |
| **Possible duplicates** | groups (6.3) |
| **Never stocked** | quantity 0, no `PriceHistory`, never on a purchased list row. These are mostly phantom items created from recipes. |
| **Unit problems** | items that at least one recipe uses in a unit that can't be converted |

Each row opens the item page. On phones the rows become cards, like the
inventory list. The server does the grouping once per request, as a pure
calculation over one inventory `findMany` with `_count` of the relations
(PERF-1 style, no query per item).

### 6.3 Duplicate detection and merge

**Detection** is a pure calculation, `findDuplicateGroups(items, aliases,
dismissals)` in `src/lib/inventory/duplicates.ts`. Two items are a
candidate pair when any of these holds:

- their normalized names are equal
- they're equal after the plural fold (§3.2)
- one's name is an alias of the other
- fuzzy score ≥ 0.8

A pair that was dismissed is skipped. Pairs are joined into groups
(union-find), and groups are sorted by strongest pair. Each member is
tagged: *never stocked*, *used in N recipes*, *has barcode*, unit. The
suggested **keeper** is, in order: the one with stock, then the most
recipe/list/price history, then the oldest.

```
┌ Possible duplicates (3 groups) ──────────────────────────┐
│ Egg                                                      │
│  (•) Egg      12 pcs · 5 recipes · barcode    keep       │
│  [✓] eggs      0 pcs · 2 recipes · never stocked         │
│  [✓] Ägg       0 st  · 1 recipe                          │
│  [Merge 2 into Egg]         [Not duplicates]             │
│──────────────────────────────────────────────────────────│
│ Crème fraiche                                            │
│  (•) Crème fraiche  2 pcs (burk)                         │
│  [✓] crème fraiche, gärna lätt  0 dl · 1 recipe          │
│  ⚠ dl → pcs: 1 pcs = [2] dl                              │
│  [Merge into Crème fraiche]   [Not duplicates]           │
└──────────────────────────────────────────────────────────┘
```

**Not duplicates** is saved for the whole household (not in the browser),
so the group doesn't come back for anyone:
`InventoryDuplicateDismissal(householdId, itemAId, itemBId)`, ids stored
sorted, unique, cascading with either item.

**Merge** is available here and from the item page. It first runs a
read-only `previewMergeAction(keeperId, mergeIds)` that shows exactly
what will move:

| Moved from each merged item | How |
|---|---|
| Stock | added to the keeper, converted with `convertForItem`. If the units can't be converted, the row asks for a factor ("1 pcs = [2] dl"), and that factor is saved as an `ItemUnitConversion` on the keeper, so the moved recipe rows reconcile too. |
| `RecipeIngredient`, `ShoppingListItem`, `ShoppingListTemplateItem` | re-pointed to the keeper. Amounts and units are kept, and the conversions make them work. If the keeper and a merged item are both pending on the same list, the rows are summed when the units convert and otherwise kept as two rows. |
| `PriceHistory` | re-pointed. Each row already records its own quantity and unit. |
| `ItemAlias`, `ItemUnitConversion` | re-pointed. Conversions are re-expressed through the merge factor, and the keeper's own row wins on a conflict. The merged item's name becomes a new alias, so the next import matches the keeper. |
| Barcode | the keeper keeps its own. If it has none it takes the merged item's (cleared first, because of `@@unique([householdId, barcode])`). |
| Expiry / threshold / price / category | the keeper's, except that an empty value takes the merged item's (the earliest real expiry wins). |
| `Notification` | deleted. These are stale alerts about an item that no longer exists. |

`mergeInventoryItemsAction({ keeperId, merge: [{ id, factor? }] })`:
`requireHousehold()`, and every id is checked in one `findMany` scoped to the
household. It does everything above and then deletes the merged items, all
in **one `$transaction`**. It's Zod-validated, with at most 10 items per
merge.

**Confirm, not undo.** The repo's convention is "undo over confirm". A
merge breaks that on purpose, because it re-points rows in six tables, and
a reliable undo would need a stored snapshot of all of them. Instead the
preview is the confirmation: it lists every count that will move, and
Merge is the only button that writes.

Also: **"Review ingredient matches"** on each recipe card (MATCH-5) opens
the §3.1 step for one recipe, with its current links shown as decisions,
so a wrong link can be moved without merging anything.

## 7. Implementation plan

Order matters: MATCH-4 and MATCH-1 need no schema change. MATCH-2 and
MATCH-3 each add one migration (Phase 2 rules: one at a time).

| ID | Scope | Schema | Size |
|---|---|---|---|
| **MATCH-4** | Parser improvements (§5) | none | S |
| **MATCH-1** (shipped) | Stop silent creation: pure matcher, preview action, step-2 review, explicit decisions on save, keep links on edit, shopping bridge stops creating (§3.1, 3.2, 3.4, 3.5 minus untracked/aliases/conversions) | none | M |
| **MATCH-2** | "Don't track" + `rawText`/`note` + `ItemAlias` learning and lookup (§3.4 learning, §4) | 1 migration | M |
| **MATCH-3** | `ItemUnitConversion`, `convertForItem`, unit choices in review, density hints (§3.3). The conversions UI lives on the item page (MATCH-6) | 1 migration | M |
| **MATCH-6** | Item page: used in recipes/lists, conversions CRUD + calculator, "Change unit…", aliases list (§6.1) | none (uses MATCH-2/3 tables) | M |
| **MATCH-7** | Catalog page with filters, duplicate groups, "Not duplicates", merge preview + merge (§6.2, 6.3) | 1 migration (`InventoryDuplicateDismissal`) | L |
| **MATCH-5** | Aliases in shopping/receipt linkers, per-recipe "Review ingredient matches" (§3.5 last bullet, §6.3 end) | none | M |

Build order: MATCH-4 → MATCH-1 → MATCH-2 → MATCH-3 → MATCH-6 → MATCH-7 →
MATCH-5. MATCH-6 and MATCH-7 each add a page, so each must also add its
entries to `e2e/routes.ts` (with a seeded item and seeded duplicate pair in
`e2e/seed.ts`) and an e2e flow spec: change a unit and see the stock
converted, and merge a duplicate and see the recipe now pointing at the
keeper.

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

### Decisions (product owner, 2026-09-27)

1. **Default to Don't track**: only water and ice. Everything else follows
   the normal matching rules, and aliases remember the household's choice.
2. **Density hints**: ship with MATCH-3, as a short table of about 20
   staples marked "≈".
3. **Aliases outside recipes**: yes. An alias learned in the recipe review
   also links shopping-list and receipt rows (MATCH-5).
4. **Merge**: confirm with a preview, no undo (§6.3).
5. **Catalog entry point**: a "Manage items" entry on the inventory page,
   with the duplicate-group badge (§6.2). No new bottom-nav tab.

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
