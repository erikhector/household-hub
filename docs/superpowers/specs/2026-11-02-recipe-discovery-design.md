# Recipe discovery ("Discover") — design

Date: 2026-11-02 · Status: approved in chat, awaiting spec review

## Goal

Let a household find recipes it hasn't saved, with suggestions, and save
one only when it wants it. Today every recipe is a household-owned row
(typed, imported from a URL, a file or a photo), and every suggestion
surface ("Use it up", Cook now, Cook soon, favourites) ranks only recipes
already saved.

**Success:** from the Recipes tab, a user can open Discover, see recipes
that fit what's in their pantry, search and filter by diet, preview one,
and save or plan it through the normal recipe form, without having typed
the recipe themselves. All of this works with no AI key. When an AI key is
configured, the user can also ask for a few extra ideas.

## Decisions (from the brainstorm)

| Question | Answer |
|---|---|
| Source of unsaved recipes | A built-in catalog, plus optional AI ideas when a provider key is set |
| Suggestion signals | Pantry overlap (expiring items weighted up), free-text search, dietary tags |
| Not included | Variety vs. meal plan |
| What you can do with one | Preview, then **Save** (pre-filled form, reviewed) or **Add to plan** (save first, then plan) |
| Catalog storage | Approach A: a typed, bilingual TypeScript module, server-side only |
| Catalog size | About 120 recipes: Swedish everyday food plus common international dishes |

These follow PRODUCT.md's guardrails. Nothing is saved without an explicit
user action, the feature works with no AI key, and it needs no new paid
infrastructure.

## Rejected alternatives

- **A global `CatalogRecipe` table seeded by a migration.** It would be the
  app's first table not scoped to a household, plus a seed pipeline, for
  about 120 rows that only change through code review anyway.
- **Catalog as client-side JSON.** It adds roughly 150 KB to the
  meal-planning bundle, against the PERF-7/PERF-24 bundle work.
- **A free external API (TheMealDB etc.).** English only, the API key terms
  limit public use, and suggestions break when the API is down.
- **Planning a catalog recipe without saving it.** That needs
  `MealPlanEntry` schema changes and changes to the shopping-list and
  cooking bridges. Saving first keeps every downstream feature unchanged.

## Architecture

```
src/lib/recipe-catalog/
  types.ts          CatalogRecipe, CatalogIngredient, Localized<T>
  data.ts           the ~120 recipes (server-only; never imported by "use client")
  rank.ts           rankCatalogRecipes(): pure, no I/O
  rank.test.ts
  data.test.ts      catalog integrity checks
  to-parsed.ts      catalogToParsedRecipe(recipe, locale) → ParsedRecipe & {servings, tags}
  to-parsed.test.ts
src/lib/recipe-ideas/
  ai.ts             prompt, Zod schema, Gemini schema, Anthropic tool, mapper
  ai.test.ts
src/app/dashboard/meal-planning/
  discover-actions.ts       searchRecipeCatalogAction, suggestRecipeIdeasAction
  discover-actions.test.ts
src/components/meal-planning/
  discover-sheet.tsx        the sheet: search, tag chips, results, AI button
  discover-preview.tsx      preview of one recipe + Save / Add to plan
e2e/recipe-discover.spec.ts
```

### Catalog data (`types.ts`, `data.ts`)

```ts
type Localized<T> = { en: T; sv: T };
type CatalogIngredient = {
  name: Localized<string>;   // matched against inventory names
  quantity: number;
  unit: string;              // a unit units.ts knows (normalizeUnit round-trips)
  note?: Localized<string>;  // prep note, e.g. "finely chopped"
};
type CatalogRecipe = {
  id: string;                // stable kebab-case slug, e.g. "kottbullar"
  name: Localized<string>;
  servings: number;
  ingredients: CatalogIngredient[];
  instructions: Localized<string>;  // one step per line, as the form stores it
  tags: RecipeTag[];         // from the closed RECIPE_TAGS set (GAP-29)
};
```

- About 120 recipes. The mix is roughly half Swedish everyday food
  (köttbullar, pyttipanna, laxpudding, ärtsoppa, fiskgratäng, …) and half
  common international dishes (pasta, curries, stir-fries, soups, salads,
  bakes), with at least 25 vegetarian or vegan, at least 15 `quick`, and
  some `glutenFree`/`dairyFree`. Both languages are written by hand. A
  Swedish recipe must not read like a machine translation, and units are
  metric (`g`, `dl`, `msk`, `tsk`, `pcs` …) in both.
- Ingredient names use the plain words people give pantry items ("milk",
  not "whole milk, cold"), because name matching depends on them.
  Qualifiers go in `note`.
- **Server-only.** `data.ts` is only imported from Server Actions and
  `page.tsx`. A test, alongside `client-bundle-guard.test.ts`'s existing
  walk, fails if any `"use client"` file reaches `recipe-catalog/data`.
- Content license: the recipes are written for Squirrel, not copied. A
  short header comment in `data.ts` says so.

### Ranking (`rank.ts`)

```ts
rankCatalogRecipes(
  catalog: CatalogRecipe[],
  pantry: { name: string; quantity: number; expiring: boolean; low: boolean }[],
  options: { query: string; tags: RecipeTag[]; locale: "en" | "sv";
             savedNames: string[]; limit: number },
): CatalogResult[]
// CatalogResult = { id, name, tags, servings, haveCount, totalCount,
//                   expiringMatches: string[], score }
```

- **Filtering.** Each selected tag must be on the recipe (AND). The
  recipe list's GAP-29 filter is a single-select; Discover allows several
  chips because "vegetarian + quick" is a common combination. The query is trimmed, lowercased and
  diacritic-folded (`ä`→`a` is **not** folded, because Swedish treats it as
  its own letter; only combining marks such as `é` are). It must be a
  substring of the localized name or of any localized ingredient name.
- **Recipes already saved are hidden.** A recipe is dropped when its
  localized name equals a saved recipe's name (case-insensitive, trimmed),
  so Discover never offers what the household already has.
- **Pantry match.** A catalog ingredient matches a pantry item with
  `quantity > 0` (the same zero-quantity gate as "Use it up") when the
  pantry item's case-insensitive, trimmed name equals the ingredient's
  English OR Swedish name. Matching uses both languages because the pantry
  is free text in whatever language the household types, which need not be
  the UI language; a current-locale-only match would make a Swedish pantry
  look empty to an English-speaking member. Search still uses the current
  locale only. The match is deduplicated per pantry item. It's deliberately
  as loose as `getCookableRecipes`' fallback: no fuzzy matching in v1.
- **Score.** `haveCount / totalCount` plus `0.15 ×` the number of expiring
  matches (capped at 3), so a recipe that uses up something expiring
  ranks above an equally covered one. Ties break on more expiring matches,
  then a higher `haveCount`, then the localized name (`localeCompare` with
  the locale).
- **Empty query and no tags** ("Good with what you have"): only recipes
  with `haveCount ≥ 1`. If none qualify (an empty pantry), it falls back to
  a fixed `featured` order (the first 12 catalog entries, curated to be
  varied), so a new household still sees something.
- `limit` defaults to 30. The client gets results, not the catalog.

### Conversion (`to-parsed.ts`)

`catalogToParsedRecipe(recipe, locale)` returns the same `ParsedRecipe`
shape (plus `servings` and `tags`) that URL, file and photo import produce.
Each ingredient's `rawText` is the localized display line
(`"2 dl milk"`), and `note` is the localized note. This shape is the only
thing the form ever receives, so the form needs no catalog-specific
code.

### Server Actions (`discover-actions.ts`)

Both start with `requireHousehold()` and take nothing that names a
household.

1. `searchRecipeCatalogAction({ query, tags })`, called directly from a
   transition and debounced in the client:
   - Zod: `query` is a string of at most 100 characters; `tags` is a string
     array passed through `parseRecipeTags` (unknown keys are dropped).
   - Loads the household's inventory (`name, quantity, unit,
     lowStockThreshold, expiresAt`) and saved recipe names, both scoped by
     `householdId`. It derives `expiring`/`low` with `getExpiryStatus` and
     `getStockStatus`, as "Use it up" does, then returns
     `rankCatalogRecipes(...)`.
   - `page.tsx` also calls the same ranking once for the first render
     (empty query, no tags), so the sheet opens with results, not a
     spinner.
2. `getCatalogRecipeAction(id)` returns `catalogToParsedRecipe` for one
   id (as `{ recipe }`, or `{ error }` if not found), plus the per-ingredient
   "have it" flags for the preview. It's needed so the client never holds
   the full catalog.
3. `suggestRecipeIdeasAction({ tags })` (phase 2, see below).

### UI

- **Entry point.** A **Discover** button in the Recipes tab's action row,
  beside "New recipe" and the import buttons. It also appears in the
  Recipes empty state, when the household has no recipes, as the secondary
  action beside "New recipe", which stays the empty state's primary (one
  primary per view, DESIGN.md M2).
- **Discover sheet** (`discover-sheet.tsx`). A Base UI dialog, full height
  on phones (follows DESIGN.md M1–M10: thumb-reachable close, no
  horizontal scroll at 320 px, 44 px targets, the search field not hidden
  by the keyboard). Its contents:
  - A search field (`type="search"`, labelled) and the GAP-29 tag chips
    (`aria-pressed`, using the existing `ChipScroller`).
  - The heading "Good with what you have" when there's no query and no
    tags, otherwise "Results". Each row shows the name, tag chips and
    "You have 5 of 8", plus "uses milk, spinach (expiring)" when there are
    expiring matches.
  - An empty state ("No recipes match. Try fewer filters.") and a
    loading state that keeps the previous results visible (a dimmed list),
    not a spinner that makes the list jump.
- **Preview** (`discover-preview.tsx`), opened from a row. It shows the
  name, servings and tags, the ingredient list with each row marked
  "have it" or "missing" (by icon *and* text, not colour alone), and the
  steps. Two buttons:
  - **Save to my recipes** opens `RecipeFormDialog` in create mode,
    pre-filled through the existing `applyImportedRecipe` path. Servings
    and tags are pre-set too. The user then goes through the usual
    ingredient matching (MATCH review) and saves. The dialog gets the
    parsed recipe through a new `initialRecipe?: FileRecipe` prop, the same
    shape file import produces (`src/lib/recipe-import/parse-file.ts`).
  - **Add to plan** does the same, but after a successful create it opens
    `AddToPlanDialog` for the new recipe. No "save then plan" hand-off
    exists yet, so `createRecipeAction` starts returning the new id in
    `ActionState.createdId` (the field UX-109 added for transactions), and
    `RecipeFormDialog` gets an optional `onCreated(recipeId)` callback. The
    normal create path ignores it, so its behaviour doesn't change.
- **Copy.** Every string goes in `mealPlanning.discover` in `en.ts` and
  `sv.ts`. Plurals ("You have {n} of {total}") use `{ one, other }` pairs.

### Optional AI ideas (phase 2)

- `page.tsx` already computes whether `GEMINI_API_KEY` or
  `ANTHROPIC_API_KEY` is set, for photo import. It passes the same
  `aiAvailable` flag to the sheet. Without a key, the **Ask for ideas**
  button doesn't render, and a direct call returns "not configured".
- `suggestRecipeIdeasAction({ tags })`:
  - `requireHousehold()`, then `checkRateLimit("recipe-ideas:<householdId>",
    20, 1 h)`. The key is separate from photo import's; the numbers are the
    same.
  - Input to the model: the names (not quantities, prices or anything
    else) of pantry items with `quantity > 0`, capped at 60 with expiring
    ones first; the selected tag keys; the locale; and the names of the
    household's saved recipes (capped at 50), so it doesn't suggest them.
    The pantry item names are household data sent to a third party, the
    same privacy tradeoff the receipt and photo scans already make. The
    privacy page's "Third parties" Gemini/Anthropic paragraph
    (`src/app/privacy/page.tsx`, currently listing the scans) gets a
    **Recipe ideas** entry saying only pantry item names and recipe names
    are sent.
  - `runProviderChain` without an image, with a text-only prompt in
    `src/lib/recipe-ideas/ai.ts` asking for exactly 3 recipes in the
    user's language, metric units, and ingredient names as plain words.
    The output is validated with a Zod schema matching `CatalogRecipe`'s
    single-language shape (name ≤ 120 chars, 1–30 ingredients, quantity
    > 0, instructions ≤ 4 000 chars, tags filtered by `parseRecipeTags`,
    units through `normalizeUnit` with unknown ones falling back to
    `pcs`). Invalid entries are dropped. Zero valid entries returns an
    error.
  - Returns `ParsedRecipe & { servings, tags }` objects with a
    client-only id. Nothing is stored. The sheet shows them above the
    catalog results, labelled **AI idea**, and the same preview/Save/Add to
    plan flow applies. They're lost when the sheet closes.
  - Errors (busy, failed, rate-limited, not configured) are shown inline in
    the sheet with the existing photo-import wording pattern, never as a
    blank list.

## Error handling

- The catalog is static code, so a search can only fail on the inventory
  query. That shows the shared "couldn't load" inline error with a retry
  and keeps the last results.
- A preview for an unknown id (catalog changed between deploys) shows "This
  recipe is no longer available" and closes back to the list.
- Saving goes through the existing create action, so every existing
  validation and error message applies unchanged.

## Browser storage

None. The query and tags live in component state only, so
`cookie-inventory.ts` is unchanged.

## Testing

- **`rank.test.ts`:** tag AND-filtering; query on name and ingredient in
  both locales; diacritic folding (é) without folding å/ä/ö; saved-name
  hiding; the zero-quantity gate; dedupe per pantry item; the expiring
  boost and its cap; tie-break order; the "Good with what you have"
  `haveCount ≥ 1` rule; the empty-pantry `featured` fallback; `limit`.
- **`data.test.ts` (catalog integrity):** ids unique and kebab-case; at
  least 120 entries; every `Localized` field non-empty in `en` and `sv`;
  tags ⊂ `RECIPE_TAGS`; every unit known to `units.ts`; quantities > 0;
  servings 1–12; the vegetarian/vegan and `quick` minimums; no two recipes
  with the same name in a locale.
- **`to-parsed.test.ts`:** locale selection, `rawText`/`note`, servings
  and tags carried over.
- **`discover-actions.test.ts`** (mocked prisma/session as in
  `recipe-actions.test.ts`): every action calls `requireHousehold`;
  inventory and recipe queries are scoped by `householdId`; invalid input
  is rejected or cleaned; an unknown id returns an error; the AI action
  covers not configured, rate-limited, provider busy, invalid JSON
  (dropped entries), the zero-valid-entries error, and the prompt
  containing only item names.
- **`src/lib/recipe-ideas/ai.test.ts`:** schema validation and mapping.
- **A bundle guard:** no `"use client"` file reaches
  `recipe-catalog/data`.
- **e2e `recipe-discover.spec.ts`** (desktop and mobile, `expectHydrated`
  before clicks, `unique()` not needed because names come from the
  catalog, so the test deletes its saved recipe in `E2E_HOUSEHOLD` at the
  end):
  open Discover → the "Good with what you have" heading is visible →
  search for a known catalog recipe → tick a tag chip and see the list
  narrow → open the preview and see "have it"/"missing" → Save → the form
  is pre-filled with the name → submit → reload → the recipe is in the
  list, and reopening Discover no longer offers it. A second test runs
  Add to plan through to the plan dialog. AI is not run in e2e (no key);
  it's covered by the unit tests.
- Discover is a sheet, not a page, so `e2e/routes.ts` is unchanged.
  `expectNoHorizontalOverflow` is asserted with the sheet open on mobile.

## Delivery

Two PRs off `next`, each with REQUIREMENTS.md updated (a new "Recipe
discovery" section under Meal planning) and a release note in both
languages:

1. `feat: discover recipes from a built-in catalog`: catalog, ranking,
   search, preview, save, add to plan. Most of the diff is `data.ts`
   content. To keep review sane, the catalog could land first in its own
   commit.
2. `feat: ask for recipe ideas when AI is configured`: the AI action,
   button, privacy-page line.

## Out of scope (v1)

- Fuzzy or alias-based ingredient matching (MATCH aliases could be
  reused later).
- Recipe photos for catalog entries.
- Ranking for variety against the meal plan.
- Saving AI ideas anywhere except through the normal form.
- User-contributed or shared catalog entries.
