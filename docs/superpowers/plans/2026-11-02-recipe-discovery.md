# Recipe Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household find, preview and save recipes it hasn't added,
ranked by what's in its pantry, from a built-in bilingual catalog, plus
optional AI ideas when a provider key is set.

**Architecture:** A server-only TypeScript catalog (`src/lib/recipe-catalog/`)
ranked by a pure function, exposed through `requireHousehold()`-scoped Server
Actions to a "Discover" sheet on the Recipes tab. Saving reuses
`RecipeFormDialog`'s import pre-fill path, so every save goes through the
normal create action and MATCH review. AI ideas reuse `runProviderChain`
text-only and return the same `FileRecipe` shape.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Prisma 7, Zod, Base UI
(shadcn), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-recipe-discovery-design.md`
(read it first; this plan only records decisions the spec leaves open).

## Global Constraints

- Follow AGENTS.md: feature branch off `next`; `requireHousehold()` in every
  action; never accept a household id from the client; every Prisma query
  scoped by `householdId`.
- All user-facing text in both `src/lib/i18n/dictionaries/en.ts` and `sv.ts`
  under `mealPlanning.discover`; plain strings or `{ one, other }` only; no
  hardcoded JSX strings.
- Base UI: compose with `render`, never `asChild`.
- `src/lib/recipe-catalog/data.ts` must never be reachable from a `"use client"`
  file; no client component may import `zod` (PERF-7/24 guard).
- No browser storage (`cookie-inventory.ts` unchanged). No schema migration.
- DESIGN.md Mobile UX rules M1–M10 apply to every new UI piece.
- Catalog: ≥ 120 recipes; every `Localized` field non-empty in `en` and
  `sv`; ≥ 25 tagged `vegetarian` or `vegan`; ≥ 15 tagged `quick`; metric
  units known to `src/lib/units.ts`; servings 1–12; text written for
  Squirrel, not copied.
- Ranking constants: expiring boost `0.15` per expiring match, capped at `3`
  matches; default `limit` `30`; featured fallback = first `12` catalog
  entries.
- AI: rate limit key `recipe-ideas:<householdId>`, `20` per `60 * 60 * 1000`
  ms; ≤ `60` pantry names (expiring first); ≤ `50` saved recipe names;
  exactly `3` ideas requested; name ≤ 120 chars, 1–30 ingredients,
  quantity > 0, instructions ≤ 4 000 chars.
- Two PRs: Tasks 1–9 (`feat: discover recipes from a built-in catalog`),
  Tasks 10–11 (`feat: ask for recipe ideas when AI is configured`). Each
  PR: REQUIREMENTS.md section, release note in en + sv, `self-review`
  skill, `npm run check && npm run build`, `npm run test:e2e` for UI.

## Deviation from the spec (flag in the PR)

**Pantry matching uses both languages.** The spec says ingredients match pantry
items "in the current locale". A Swedish household using the English UI
names its pantry "mjölk", which would never match "milk". So `rankCatalogRecipes`
matches a pantry name against the ingredient's `en` **or** `sv` name.
Search text still matches only the current locale's text. Update the spec's
"Pantry match" bullet in Task 9 to say this.

## Review Focus

1. **A pantry named in the language the UI isn't using.** An `en` UI user
   whose pantry item is "Mjölk" (Swedish for milk) should still see "You have 1 of N" for a recipe with milk. This is pinned in Task 3
   (`matches pantry names in either language`).
2. **Search input with regex characters or only whitespace.** `"("`,
   `"  "` or `"c++"` must not throw. Whitespace-only behaves like an empty
   query. Pinned in Task 3 (`treats the query as literal text`).
3. **Cancelling a pre-filled Save.** Opening "Save to my recipes", then
   closing the form, then pressing **New recipe** must give an empty form,
   not the catalog recipe. Pinned in Task 8's e2e
   (`new recipe is blank after a cancelled discover save`).
4. **Fast typing.** Answers to earlier searches arriving after later ones
   must not overwrite the results for the final query. Pinned in Task 7
   (client keeps a request counter and drops stale answers) and Task 8's
   e2e (`shows results for the last query typed`).
5. **AI returns something already saved.** An idea whose name matches a
   saved recipe (case- or space-different) should be dropped, as the
   catalog hides those. Pinned in Task 10
   (`drops ideas that match a saved recipe name`).

---

### Task 1: Catalog types, integrity tests, first 60 recipes

**Files:**
- Create: `src/lib/recipe-catalog/types.ts`
- Create: `src/lib/recipe-catalog/data.ts`
- Test: `src/lib/recipe-catalog/data.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  import type { RecipeTag } from "@/lib/recipe-tags";
  export type Localized<T> = { en: T; sv: T };
  export type CatalogIngredient = { name: Localized<string>; quantity: number; unit: string; note?: Localized<string> };
  export type CatalogRecipe = { id: string; name: Localized<string>; servings: number;
    ingredients: CatalogIngredient[]; instructions: Localized<string>; tags: RecipeTag[] };
  // data.ts
  export const RECIPE_CATALOG: readonly CatalogRecipe[];
  export const FEATURED_COUNT = 12; // the first 12 entries are the curated, varied featured set
  ```

- [ ] **Step 1: Write `data.test.ts`.** Make the minimums constants at the top
  (`MIN_RECIPES = 60` for now, raised to `120` in Task 2). The tests:
  - `ids are unique kebab-case`: each id matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`, and `new Set(ids).size === ids.length`.
  - `has at least MIN_RECIPES recipes`.
  - `every localized field is filled in both languages`: name, instructions, every ingredient name and every note are non-empty after `trim()` in `en` and `sv`.
  - `tags come from RECIPE_TAGS`: `parseRecipeTags(r.tags)` deep-equals `r.tags`, which checks both membership and canonical order.
  - `units are known`: for every ingredient, `unitKind(i.unit) !== null`.
  - `quantities and servings are sane`: `quantity > 0` and is finite; `1 <= servings <= 12`.
  - `names are unique per language`: no two recipes share a lowercased trimmed name in `en`, nor in `sv`.
  - `instructions have one step per line`: `instructions.en.split("\n").length >= 2` (and the same for `sv`).
- [ ] **Step 2: Run `npx vitest run src/lib/recipe-catalog/data.test.ts`.** Expect FAIL (module not found).
- [ ] **Step 3: Write `types.ts` and `data.ts` with the first 60 recipes.** Make
  them the Swedish half: husmanskost and Swedish weeknight food
  (köttbullar, pyttipanna, laxpudding, ärtsoppa, fiskgratäng, raggmunk,
  kalops, Janssons, korvstroganoff, …). Put a varied set of 12 first: at
  least 3 vegetarian, 3 quick, 2 fish. Use plain ingredient words such as
  "milk"/"mjölk", "egg"/"ägg" and "yellow onion"/"gul lök", with qualifiers
  in `note`. Units are `g`, `kg`, `dl`, `l`, `msk`, `tsk`, `krm`, `pcs`;
  check each with `unitKind`. Add a header comment saying the recipes were
  written for Squirrel, are server-only (never import from `"use client"`),
  and that the first `FEATURED_COUNT` entries are the featured set.
- [ ] **Step 4: Run the test again.** Expect PASS.
- [ ] **Step 5: Commit** with `feat(catalog): add recipe catalog types and first 60 recipes`.

### Task 2: Remaining 60 recipes (international)

**Files:** Modify `src/lib/recipe-catalog/data.ts` and `data.test.ts`.

- [ ] **Step 1:** In `data.test.ts`, set `MIN_RECIPES = 120`, then add:
  - `has enough vegetarian or vegan recipes`: ≥ 25 recipes whose tags include `vegetarian` or `vegan`.
  - `has enough quick recipes`: ≥ 15 recipes tagged `quick`.
- [ ] **Step 2:** Run it. Expect FAIL on the count.
- [ ] **Step 3:** Append 60 common international dishes (pasta, curries, stir-fries, soups, salads, bakes, tacos, …). Make the tag minimums true across the whole catalog, and include some `glutenFree` and `dairyFree`.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5: Commit** with `feat(catalog): add 60 international recipes`.

### Task 3: `rankCatalogRecipes`

**Files:**
- Create: `src/lib/recipe-catalog/rank.ts`
- Test: `src/lib/recipe-catalog/rank.test.ts`

**Interfaces:**
- Consumes: `CatalogRecipe`, `FEATURED_COUNT` (Task 1); `RecipeTag`; `Locale` from `@/lib/i18n/locales`.
- Produces:
  ```ts
  export type PantryEntry = { name: string; quantity: number; expiring: boolean };
  export type CatalogResult = { id: string; name: string; tags: RecipeTag[]; servings: number;
    haveCount: number; totalCount: number; expiringMatches: string[] /* localized ingredient names */ };
  export type RankOptions = { query: string; tags: RecipeTag[]; locale: Locale; savedNames: string[]; limit?: number };
  export function rankCatalogRecipes(catalog: readonly CatalogRecipe[], pantry: PantryEntry[], options: RankOptions): CatalogResult[];
  export function normalizeForSearch(text: string): string; // also used by Task 10
  export function ingredientHaves(recipe: CatalogRecipe, pantry: PantryEntry[]): boolean[]; // per ingredient; used by Task 6
  ```
  The spec's `low` flag is dropped from `PantryEntry` because the score
  doesn't use it (YAGNI).

- [ ] **Step 1: Write `rank.test.ts`.** Use a small inline fixture catalog,
  not `RECIPE_CATALOG`. Tests:
  - `filters by every selected tag (AND)`: `["vegetarian","quick"]` returns only recipes that have both tags.
  - `searches name and ingredient names in the current locale`: `"lax"` with `sv` finds the salmon recipe, and so does `"salmon"` with `en`. `"lax"` with `en` doesn't find it unless the English text contains "lax".
  - `folds accents but not å/ä/ö`: `"creme"` finds "Crème brûlée". `"lok"` doesn't find "lök". `"lök"` does.
  - `treats the query as literal text`: `"("`, `"c++"` and `".*"` don't throw and return `[]` on the fixture. `"   "` returns the same as `""`.
  - `hides recipes already saved`: `savedNames: ["  KÖTTBULLAR "]` with `sv` hides köttbullar.
  - `ignores pantry items with quantity <= 0`.
  - `matches pantry names in either language`: an `en` locale and pantry `[{name:"Mjölk",quantity:1,expiring:false}]` gives haveCount 1 for a recipe with milk.
  - `haveCount counts covered ingredients`: a recipe with ingredients "egg" and "egg" (yolk/white) and pantry `egg` gives `haveCount 2, totalCount 2`. The same expiring pantry item lists once in `expiringMatches` and boosts once.
  - `boosts expiring matches, capped at 3`: two recipes with equal coverage, where the one with an expiring match ranks first. A recipe with 5 expiring matches scores the same boost as one with 3. Assert the order against a crafted fixture.
  - `breaks ties by expiring count, then haveCount, then localized name`.
  - `with no query and no tags, only recipes with haveCount >= 1`.
  - `falls back to the featured set when nothing matches the pantry`: an empty pantry, no query and no tags returns the first `min(FEATURED_COUNT, catalog.length)` recipes in catalog order, minus any saved ones.
  - `respects limit, default 30`.
- [ ] **Step 2:** Run `npx vitest run src/lib/recipe-catalog/rank.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** `normalizeForSearch` = `text.normalize("NFD")`, then strip U+0300–U+036F *except* when it would break å/ä/ö. The simplest way: NFC-normalize first, map `å ä ö Å Ä Ö` to placeholders, NFD, strip combining marks, restore the placeholders, `toLowerCase()`, `trim()`, collapse whitespace. Match with `String.includes`, never `RegExp`. The score is `haveCount / totalCount + 0.15 * Math.min(expiringMatches, 3)`. Pantry names go through `normalizeForSearch` too.
- [ ] **Step 4:** Run the test. Expect PASS.
- [ ] **Step 5: Commit** with `feat(catalog): rank catalog recipes by pantry overlap, search and tags`.

### Task 4: `catalogToParsedRecipe`

**Files:** Create `src/lib/recipe-catalog/to-parsed.ts`. Test: `to-parsed.test.ts`.

**Interfaces:**
- Consumes: `CatalogRecipe`; `FileRecipe` from `@/lib/recipe-import/parse-file` (`ParsedRecipe & { servings; tags }`).
- Produces: `export function catalogToParsedRecipe(recipe: CatalogRecipe, locale: Locale): FileRecipe`.

- [ ] **Step 1: Write the tests.**
  - `picks the locale's text`: name, instructions, and ingredient name/note, for both `en` and `sv`.
  - `builds rawText as the display line`: `{quantity:2,unit:"dl",name:{en:"milk"}}` gives `rawText === "2 dl milk"`. A `pcs` unit is left out and nothing is pluralised: `{quantity:2,unit:"pcs",name:{en:"egg"}}` gives `"2 egg"`. A note is appended after a comma: `{quantity:1,unit:"pcs",name:{en:"yellow onion"},note:{en:"finely chopped"}}` gives `"1 yellow onion, finely chopped"`.
  - `carries servings and tags`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5: Commit** with `feat(catalog): convert catalog recipes to the import shape`.

### Task 5: Keep the catalog out of client bundles

**Files:** Modify `src/components/client-bundle-guard.test.ts`.

- [ ] **Step 1:** Generalize `zodChain(entry, seen)` into
  `chainTo(entry, isTarget: (spec: string, resolved: string | null) => boolean, seen)`.
  Keep the existing zod test calling it with `spec === "zod"`. Add
  `it("keeps the recipe catalog out of every client component's imports")`,
  where the target is a resolved path ending in `src/lib/recipe-catalog/data.ts`.
  Keep the existing failure-message format, which prints the chain.
- [ ] **Step 2:** Prove that it catches a violation. Temporarily add `import { RECIPE_CATALOG } from "@/lib/recipe-catalog/data";` to a client component and run `npx vitest run src/components/client-bundle-guard.test.ts`. Expect FAIL, with the chain printed. Then revert the import.
- [ ] **Step 3:** Run it. Expect PASS.
- [ ] **Step 4: Commit** with `test: guard the recipe catalog out of client bundles`.

### Task 6: Discover Server Actions

**Files:**
- Create: `src/app/dashboard/meal-planning/discover-actions.ts` (`"use server"`)
- Create: `src/lib/recipe-catalog/pantry.ts` (`loadDiscoverContext`, shared with `page.tsx` and Task 10)
- Test: `src/app/dashboard/meal-planning/discover-actions.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4; `requireHousehold`, `getLocale`, `getExpiryStatus(expiresAt, now)`, `parseRecipeTags`, `prisma`.
- Produces:
  ```ts
  // pantry.ts
  export async function loadDiscoverContext(householdId: string, now: number):
    Promise<{ pantry: PantryEntry[]; savedNames: string[] }>;
  // inventoryItem.findMany({ where: { householdId }, select: { name, quantity, expiresAt } })
  // recipe.findMany({ where: { householdId }, select: { name } })
  // expiring = getExpiryStatus(expiresAt, now) !== null  ("expired" and "soon" both count)
  // discover-actions.ts
  export type DiscoverSearchResult = { results?: CatalogResult[]; error?: string };
  export async function searchRecipeCatalogAction(input: { query: string; tags: string[] }): Promise<DiscoverSearchResult>;
  export type DiscoverRecipeResult = { recipe?: FileRecipe; haves?: boolean[]; error?: string };
  export async function getCatalogRecipeAction(id: string): Promise<DiscoverRecipeResult>;
  ```
  Validation is hand-written, not Zod, so the action module's types stay
  client-importable: `query` is a string sliced to 100 characters (a non-string
  becomes `""`); `tags` goes through `parseRecipeTags` (a non-array becomes `[]`);
  `id` must be a string of ≤ 100 characters. Error strings come from `dict.mealPlanning.discover`
  (`errorLoad`, `errorNotFound`), added in Task 8. Add the keys now with
  placeholder-free final copy in both `en.ts` and `sv.ts`.

- [ ] **Step 1: Write the tests.** Mock `@/lib/prisma`, `@/lib/session`
  and `@/lib/i18n/get-dictionary`/`getLocale` the way
  `recipe-photo-actions.test.ts` does.
  - `requires a household`: when `requireHousehold` rejects, the action rejects. Run this for both actions.
  - `scopes both queries by the session household`: assert that the `findMany` calls' `where` is exactly `{ householdId: "h1" }`.
  - `cleans input`: `{query: 42, tags: ["vegan","bogus"]}` ranks with query `""` and tags `["vegan"]` (spy on the result: every result is tagged vegan).
  - `counts expired items as expiring`: an item with `expiresAt` yesterday and quantity 1 shows up in a result's `expiringMatches`.
  - `returns errorLoad when the inventory query throws`.
  - `getCatalogRecipeAction returns the recipe and haves`: for a known catalog id, `recipe.name` is in the mocked locale and `haves.length === recipe.ingredients.length`.
  - `getCatalogRecipeAction returns errorNotFound for an unknown or non-string id`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement. Pass `Date.now()` from inside the action.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5: Commit** with `feat(discover): server actions for catalog search and preview`.

### Task 7: Recipe form accepts a pre-filled recipe and reports the created id

**Files:**
- Modify: `src/app/dashboard/meal-planning/recipe-actions.ts` (around `createRecipeAction`, lines 670–729)
- Modify: `src/components/meal-planning/recipe-form-dialog.tsx` (props around 215–245; success branch around 376–400; `applyImportedRecipe` around 420)
- Test: `src/app/dashboard/meal-planning/recipe-actions.test.ts`

**Interfaces:**
- Produces:
  - `createRecipeAction` returns `{ createdId: string }` on success (an `ActionState.createdId` that already exists).
  - `RecipeFormDialog` gets new optional props: `initialRecipe?: FileRecipe` (applied by `applyImportedRecipe` each time the dialog opens while it's set, plus servings) and `onCreated?: (recipeId: string) => void` (called after a successful create, after `setOpen(false)`).

- [ ] **Step 1: Write the failing test** `createRecipeAction returns the new recipe id` in `recipe-actions.test.ts`. Mock `tx.recipe.create` to resolve `{ id: "r-new" }` and expect `result.createdId === "r-new"`.
- [ ] **Step 2:** Run `npx vitest run src/app/dashboard/meal-planning/recipe-actions.test.ts`. Expect FAIL.
- [ ] **Step 3:** Capture the created id inside the transaction and return it.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Wire up the dialog props. `applyImportedRecipe` also sets servings when it's given a `FileRecipe` (`setServings(String(recipe.servings))`). The pre-fill runs from the same open-change handler that fills `prefillImportUrl` (line ~520), so a close and reopen without `initialRecipe` gives the blank create state. That's what Review Focus 3 needs. It doesn't prove anything on its own, though; Task 8's e2e does.
- [ ] **Step 6:** Run `npm run typecheck`. Expect it to be clean.
- [ ] **Step 7: Commit** with `feat(recipes): let the recipe form start from a given recipe and report its id`.

### Task 8: Discover sheet, preview, entry points, copy, e2e

**Files:**
- Create: `src/components/meal-planning/discover-sheet.tsx` (`"use client"`)
- Create: `src/components/meal-planning/discover-preview.tsx` (`"use client"`)
- Modify: `src/components/meal-planning/lazy-dialogs.ts` (add `loadDiscoverSheet`)
- Modify: `src/components/meal-planning/recipe-manager.tsx` (button beside New recipe/imports, ~line 200–260; empty state ~258)
- Modify: `src/app/dashboard/meal-planning/page.tsx` (initial results, ~line 387 beside `computeUseItUpSuggestions`)
- Modify: `src/lib/i18n/dictionaries/en.ts`, `sv.ts` (`mealPlanning.discover`)
- Test: `e2e/recipe-discover.spec.ts`

**Interfaces:**
- Consumes: Task 6's actions, Task 7's form props, `AddToPlanDialog` (`recipeId`, `handle`), `ChipScroller`, `RECIPE_TAGS` + `mealPlanning.recipeTags` labels.
- Produces:
  - `page.tsx` passes `discoverInitial: CatalogResult[]` into `RecipeManager`, computed with `loadDiscoverContext` + `rankCatalogRecipes` (empty query, no tags).
  - `DiscoverSheet({ dict, handle, initialResults, onSave(recipe: FileRecipe), onAddToPlan(recipe: FileRecipe), aiAvailable? })`. `aiAvailable` is not rendered until Task 11.
  - `RecipeManager` owns one extra `RecipeFormDialog` (create mode) for Discover saves. It's opened with `initialRecipe` and, for Add to plan, an `onCreated` that opens `AddToPlanDialog` for that id.
- Dictionary keys (`mealPlanning.discover`): `open` ("Discover"), `title`, `searchLabel`, `searchPlaceholder`, `goodWithWhatYouHave`, `results`, `haveCount` `{one, other}` ("You have {count} of {total}"), `usesExpiring` ("Uses {items} (expiring)"), `empty` ("No recipes match. Try fewer filters."), `emptyRecipesAction` ("Find a recipe to start with"), `haveIt`, `missing`, `save` ("Save to my recipes"), `addToPlan`, `back`, `errorLoad`, `errorNotFound` ("This recipe is no longer available"), `retry`. Write the Swedish copy naturally, not as a literal translation.

- [ ] **Step 1: Write the failing e2e test `e2e/recipe-discover.spec.ts`.** Use `openRecipesTab`, `expectHydrated` before every click on a React control, `waitForDialogHistory` before reloads, and `expectNoHorizontalOverflow`. Clean up by deleting the saved recipe through the UI (row Delete via `clickRowAction` + `waitForUndoableDelete`). Pick a catalog recipe the seed doesn't have; import its English name from `RECIPE_CATALOG` in the spec instead of hardcoding it. Tests:
  - `discover shows pantry-based suggestions`: open Discover, then the heading "Good with what you have" is visible and at least one row is listed.
  - `search and tag filter narrow the list`: type the chosen recipe's name and it's the first row. Press a tag chip the recipe lacks and the empty message appears. Press it again to unpress it.
  - `shows results for the last query typed`: `fill("pasta")` then immediately `fill(<chosen name>)`, then within 5 s every visible row name contains the chosen name.
  - `save a catalog recipe through the form`: preview shows "Have it"/"Missing" markers, then Save, then the form's Name field has the chosen name. Go through the ingredient review (choose "Create new" defaults), save, reload, and the recipe is in the Recipes list. Reopen Discover, search the name, and it's not listed.
  - `add to plan saves then opens the plan dialog`: Add to plan, save the form, and the Add-to-plan dialog for that recipe opens.
  - `new recipe is blank after a cancelled discover save`: Save opens the pre-filled form, close it with Escape, then **New recipe** shows an empty Name field.
  - `sheet fits a phone`: open Discover, then `expectNoHorizontalOverflow(page)` and `expectTouchTargets` on the sheet.
- [ ] **Step 2:** `npm run build && npx playwright test e2e/recipe-discover.spec.ts`. Expect FAIL (no Discover button).
- [ ] **Step 3: Implement the sheet.** Search runs in `useTransition`, debounced 250 ms, with a `useRef` request counter. Drop any answer whose counter isn't the latest (Review Focus 4). While pending, keep the previous rows with `aria-busy` and dim them; don't swap in a spinner. On error, show the inline `errorLoad` with a Retry. Full height on phones, as in the existing sheets.
- [ ] **Step 4: Implement the preview.** It loads with `getCatalogRecipeAction`. Mark each ingredient with an icon and the text "Have it"/"Missing", never colour alone. Put the sticky action bar (Save, Add to plan) at the bottom on phones (M2). On `errorNotFound`, toast and go back to the list.
- [ ] **Step 5: Add the entry points.** Put the Discover button in `RecipeManager`'s action row, preloaded on intent like the file import. Put the empty-state secondary action (`emptyRecipesAction`) next to New recipe.
- [ ] **Step 6: Run the e2e spec on both projects.** Expect PASS. Then run `npx playwright test smoke` and expect PASS, because the meal-planning page still renders cleanly in en/sv.
- [ ] **Step 7: Commit** with `feat(discover): discover sheet with pantry suggestions, search, preview and save`.

### Task 9: Docs and PR 1

**Files:** `REQUIREMENTS.md` (new `### Recipe discovery (catalog)` under `## Meal planning`, after "Use it up"), the spec's "Pantry match" bullet (both languages, see Deviation), and the PR body.

- [ ] **Step 1:** Write the REQUIREMENTS.md section. Cover the catalog location and rules, the ranking and its constants, the both-language matching, the actions and tenancy, the save/plan hand-off, and the bundle guard. Write it in the surrounding style, which explains *why*.
- [ ] **Step 2:** Run `npm run check && npm run build && npm run test:e2e`. Everything should be green. Fix any failure at its root.
- [ ] **Step 3:** Run the `self-review` skill against `git diff origin/next...` and fix what it finds.
- [ ] **Step 4: Commit and push.** Commit with `docs: document recipe discovery`, then push and open a PR into `next` titled `feat: discover recipes from a built-in catalog`. Fill in the template, including a release note in en and sv, and say which spec and plan it follows. Mention the both-language deviation.

### Task 10: AI recipe ideas — module and action (PR 2, branch off `next` after PR 1 merges)

**Files:**
- Create: `src/lib/recipe-ideas/ai.ts`, Test: `src/lib/recipe-ideas/ai.test.ts`
- Modify: `src/app/dashboard/meal-planning/discover-actions.ts`, `discover-actions.test.ts`
- Modify: `en.ts`/`sv.ts` (`discover.ideas*` keys)

**Interfaces:**
- Consumes: `runProviderChain`, `resolveAttempts`, and `DEFAULT_ANTHROPIC_MODEL` the way `recipe-photo-actions.ts` uses them; `checkRateLimit`; `loadDiscoverContext` (Task 6); `normalizeForSearch` (Task 3).
- Produces:
  ```ts
  // ai.ts
  export const recipeIdeasSchema: z.ZodType<{ recipes: IdeaAnswer[] }>; // loose: arrays of raw objects
  export const RECIPE_IDEAS_SYSTEM_PROMPT: string;
  export const RECIPE_IDEAS_GEMINI_SCHEMA: unknown;
  export const RECIPE_IDEAS_TOOL: { name: string; description: string; input_schema: unknown };
  export function recipeIdeasUserText(input: { pantry: string[]; tags: RecipeTag[]; locale: Locale; savedNames: string[] }): string;
  export function mapRecipeIdeas(answer: { recipes: IdeaAnswer[] }, savedNames: string[]): FileRecipe[];
  // discover-actions.ts
  export type RecipeIdeasResult = { ideas?: FileRecipe[]; error?: string };
  export async function suggestRecipeIdeasAction(input: { tags: string[] }): Promise<RecipeIdeasResult>;
  ```
  `recipeIdeasUserText` lists pantry names expiring first, capped at 60, and
  saved names capped at 50. It asks for exactly 3 recipes in the locale's
  language, using metric units and plain ingredient words.
  `mapRecipeIdeas` validates each recipe on its own: name ≤ 120 characters,
  1–30 ingredients, quantity > 0, instructions ≤ 4 000 characters; tags through
  `parseRecipeTags`; unit through `normalizeUnit`, falling back to
  `"pcs"` when `unitKind` is null. It drops invalid recipes and those
  whose `normalizeForSearch(name)` equals a normalized saved name.
  Error keys: `ideasNotConfigured`, `ideasRateLimited`, `ideasBusy`,
  `ideasFailed`, `ideasNone`.

- [ ] **Step 1: Write the `ai.test.ts` tests.**
  - `user text lists expiring items first and caps at 60`.
  - `user text contains only names`: no quantities or prices.
  - `drops invalid ideas and keeps valid ones`: one valid recipe, one with 0 ingredients and one with quantity 0 map to 1 result.
  - `falls back unknown units to pcs`.
  - `drops ideas that match a saved recipe name`: `"  Köttbullar "` against the saved `"köttbullar"`.
- [ ] **Step 2: Write the `discover-actions.test.ts` tests.**
  - `ideas: not configured without a key` (unset `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`).
  - `ideas: requires a household`.
  - `ideas: rate limited per household`: expect `checkRateLimit` to be called with `("recipe-ideas:h1", 20, 3600000)`.
  - `ideas: busy and failed map to their errors`.
  - `ideas: zero valid ideas returns ideasNone`.
  - `ideas: returns mapped ideas`.
- [ ] **Step 3:** Run both test files. Expect FAIL.
- [ ] **Step 4:** Implement, copying `importRecipeFromPhotoAction`'s structure without the image: `feature: "AI recipe ideas"`, `timeoutMs: 50_000`, `fallbackOn: "busy"`, `failureLevel: "error"`.
- [ ] **Step 5:** Run both files. Expect PASS. Run `npx vitest run src/components/client-bundle-guard.test.ts` too. Expect PASS, since zod stays out of client components (the sheet imports only the action and types).
- [ ] **Step 6: Commit** with `feat(discover): AI recipe ideas action`.

### Task 11: AI ideas UI, privacy page, docs, PR 2

**Files:**
- Modify: `discover-sheet.tsx` (render `aiAvailable`), `recipe-manager.tsx`/`page.tsx` (pass `aiAvailable` from the same `Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)` as `photoImportConfigured`), `src/app/privacy/page.tsx` (Third parties, Gemini/Anthropic list near line 186), `en.ts`/`sv.ts`, `REQUIREMENTS.md`.
- Test: `e2e/recipe-discover.spec.ts`

- [ ] **Step 1:** Add the failing e2e test `ask for ideas is hidden without an AI key`: open Discover, then the "Ask for ideas" button has count 0. The e2e environment has no key.
- [ ] **Step 2:** Run it. It passes trivially before the change, which is fine because it's a guard. Note that in the commit.
- [ ] **Step 3: Implement the UI.** When `aiAvailable` is set, show an "Ask for ideas" button that calls the action in a transition with the selected tags. Show ideas above the catalog rows, labelled "AI idea", and open them in the same preview from the in-memory `FileRecipe`, which has no `haves` and no markers. Show errors inline. Clear the ideas when the sheet closes.
- [ ] **Step 4: Update the privacy page.** Add a **Recipe ideas** item saying that only pantry item names and recipe names are sent, only when you press the button, and nothing is stored. Add it in both languages, if that page is translated by then (UX-66). Otherwise follow the page's current pattern.
- [ ] **Step 5:** Add a REQUIREMENTS.md subsection called "AI recipe ideas". Run `npm run check && npm run build && npm run test:e2e` and the `self-review` skill.
- [ ] **Step 6: Commit, push and open the PR** titled `feat: ask for recipe ideas when AI is configured`, with an en/sv release note.
