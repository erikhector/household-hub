import { Suspense, cache } from "react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary } from "@/lib/i18n/get-dictionary";
import { MealPlanningView } from "@/components/meal-planning/meal-planning-view";
import { WeekPlanner } from "@/components/meal-planning/week-planner";
import { RecipeManager } from "@/components/meal-planning/recipe-manager";
import { CookNowList } from "@/components/meal-planning/cook-now-list";
import { PrepTab } from "@/components/meal-planning/prep-tab";
import { MealVarietyRecap } from "@/components/meal-planning/meal-variety-recap";
import { MealNutritionRecap } from "@/components/meal-planning/meal-nutrition-recap";
import { getWeekStart, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { computeMealVarietyRecap } from "@/app/dashboard/meal-planning/meal-variety-calc";
import { computeNutritionRecap } from "@/app/dashboard/meal-planning/nutrition-recap-calc";
import { getCookableRecipes } from "@/app/dashboard/meal-planning/cookable-recipes";
import { getRecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import { getActiveBatches } from "@/app/dashboard/meal-planning/prepared-batches";
import { MAX_PREP_DISHES } from "@/app/dashboard/meal-planning/prepared-batch-calc";
import { computeRecipeCost, type RecipeCost, type RecipeCostPurchase } from "@/app/dashboard/meal-planning/recipe-cost";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import { getStockStatus } from "@/lib/stock-status";
import { parseRecipeTags } from "@/lib/recipe-tags";
import { computeUseItUpSuggestions, type FlaggedInventoryItem } from "@/lib/inventory/use-it-up-calc";
import type { ItemUnitConversionLike } from "@/lib/units";
import { PageTitle } from "@/components/dashboard/page-title";

type MealPlanningDict = Dictionary["mealPlanning"];

// SCALE-J: `recipes` is the one dataset every tab needs — Planner for the
// day-slot pickers, Recipes for the recipe list/ingredient autocomplete,
// and Cook for both its own listing and (via getCookableRecipes, called
// separately below since it needs its own extra per-recipe expansion
// queries) what to check against inventory. `mealPlan` (Planner's other
// need) and `inventoryItems` (Recipes'/Cook's other need) are cheap to
// batch in alongside it, so all three Suspense-isolated tab sections below
// share one `cache()`-wrapped fetcher instead of one query each — the same
// convention as getInventoryData on the inventory page. `weekStartKey`
// (not a `Date`) is the cache key, matching every other cached fetcher in
// this app that takes more than a bare id — React's `cache()` matches
// arguments by identity, and two `Date` instances for the same day aren't
// the same reference.
const getMealPlanningCoreData = cache(async (householdId: string, weekStartKey: string) => {
  const weekStart = parseDateKey(weekStartKey);

  const [recipes, mealPlan, activeShoppingLists, inventoryItems] = await Promise.all([
    prisma.recipe.findMany({
      where: { householdId },
      include: {
        ingredients: true,
        components: { include: { componentRecipe: { select: { id: true, name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.mealPlan.findFirst({
      where: { householdId, weekStartDate: weekStart },
      include: {
        entries: {
          // Only what the planner and nutrition recap read — not the
          // recipe's instructions and the rest of its columns, per entry.
          include: {
            recipe: {
              select: {
                name: true,
                caloriesPerServing: true,
                proteinGramsPerServing: true,
                carbsGramsPerServing: true,
                fatGramsPerServing: true,
              },
            },
          },
          orderBy: { date: "asc" },
        },
      },
    }),
    prisma.shoppingList.findMany({
      where: { householdId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    // Feeds the ingredient-name autocomplete in RecipeFormDialog (name, unit)
    // and the "use it up" suggestion chips below (id, quantity,
    // lowStockThreshold, expiresAt) and each recipe's estimated cost
    // (lastKnownPrice, GAP-15) — one query covers all three rather than
    // fetching the household's inventory again for each.
    prisma.inventoryItem.findMany({
      where: { householdId },
      select: {
        id: true,
        name: true,
        unit: true,
        quantity: true,
        lowStockThreshold: true,
        expiresAt: true,
        lastKnownPrice: true,
      },
    }),
  ]);

  // Display shape shared by all three tabs — computed once here rather than
  // in each Suspense-isolated section below.
  const recipeRows = recipes.map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    instructions: recipe.instructions,
    servings: recipe.servings,
    caloriesPerServing: recipe.caloriesPerServing,
    proteinGramsPerServing: recipe.proteinGramsPerServing,
    carbsGramsPerServing: recipe.carbsGramsPerServing,
    fatGramsPerServing: recipe.fatGramsPerServing,
    isFavorite: recipe.isFavorite,
    // GAP-29: re-parsed on read too, so a key since removed from
    // RECIPE_TAGS is dropped here instead of rendering as a raw key.
    tags: parseRecipeTags(recipe.tags),
    ingredients: recipe.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      inventoryItemId: ingredient.inventoryItemId,
      untracked: ingredient.untracked,
      rawText: ingredient.rawText,
      note: ingredient.note,
    })),
    components: recipe.components.map((component) => ({
      id: component.id,
      componentRecipeId: component.componentRecipeId,
      componentRecipeName: component.componentRecipe.name,
      quantity: component.quantity,
    })),
  }));

  const entries = (mealPlan?.entries ?? []).map((entry) => ({
    id: entry.id,
    date: toDateKey(entry.date),
    mealType: entry.mealType,
    recipeId: entry.recipeId,
    recipeName: entry.recipe?.name ?? null,
    freeformName: entry.freeformName,
    portions: entry.portions,
    consumedAt: entry.consumedAt ? entry.consumedAt.toISOString() : null,
    preparedBatchId: entry.preparedBatchId,
  }));

  // Feeds the "nutrition recap" (BACKLOG GAP-2) — scoped to just the
  // currently-displayed week's entries (mealPlan.entries above, already
  // filtered by weekStartDate), unlike the variety recap's independent
  // trailing-30-day window. Reuses the recipe fields already joined onto
  // each entry via `include: { recipe: true }` rather than a separate query.
  const nutritionRecapTotals = computeNutritionRecap(
    (mealPlan?.entries ?? []).map((entry) => ({
      recipeId: entry.recipeId,
      portions: entry.portions,
      caloriesPerServing: entry.recipe?.caloriesPerServing ?? null,
      proteinGramsPerServing: entry.recipe?.proteinGramsPerServing ?? null,
      carbsGramsPerServing: entry.recipe?.carbsGramsPerServing ?? null,
      fatGramsPerServing: entry.recipe?.fatGramsPerServing ?? null,
    })),
  );

  return { recipes, recipeRows, entries, activeShoppingLists, inventoryItems, nutritionRecapTotals };
});

// SCALE-J: a trailing-30-day window across all weeks, independent of
// whichever week is currently displayed — see
// docs/archive/JOY_GAP_BACKLOG.md item 5. Rendered by PlannerTabSection, so
// it reveals together with the planner (see there).
async function MealVarietyRecapSection({
  householdId,
  dict,
}: {
  householdId: string;
  dict: MealPlanningDict;
}) {
  const now = new Date();
  const varietyWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const varietyEntries = await prisma.mealPlanEntry.findMany({
    where: { mealPlan: { householdId }, date: { gte: varietyWindowStart, lte: now } },
    select: { date: true, recipeId: true },
  });
  const { distinctRecipeCount } = computeMealVarietyRecap({ entries: varietyEntries, now });
  if (distinctRecipeCount === 0) return null;
  return <MealVarietyRecap count={distinctRecipeCount} dict={dict} />;
}

// GAP-2: week-scoped, so unlike MealVarietyRecapSection it reads from the
// shared core fetch rather than running its own query. Rendered by
// PlannerTabSection like the variety recap.
async function MealNutritionRecapSection({
  householdId,
  dict,
  weekStartKey,
}: {
  householdId: string;
  dict: MealPlanningDict;
  weekStartKey: string;
}) {
  const { nutritionRecapTotals } = await getMealPlanningCoreData(householdId, weekStartKey);
  if (nutritionRecapTotals.contributingEntryCount === 0) return null;
  return <MealNutritionRecap totals={nutritionRecapTotals} weekStartKey={weekStartKey} dict={dict} />;
}

async function PlannerTabSection({
  householdId,
  dict,
  weekStartKey,
}: {
  householdId: string;
  dict: MealPlanningDict;
  weekStartKey: string;
}) {
  const [{ recipeRows, entries, activeShoppingLists }, batches, locale] = await Promise.all([
    getMealPlanningCoreData(householdId, weekStartKey),
    getActiveBatches(householdId),
    getLocale(),
  ]);
  // The two recaps sit below the week (on a phone the week bar and today
  // come first, DESIGN.md M6), inside the planner's Suspense boundary
  // rather than each in their own. With their own boundaries they streamed
  // in above the tab bar after the first paint: a fixed-height skeleton
  // (UX-21) kept a recap that arrived from pushing the planner down, but
  // an empty or dismissed one (the usual case) still collapsed its slot
  // and pulled the tabs and the planner up, which pushed /meal-planning
  // over UX-42's CLS budget on a slow CPU (e2e/cls.spec.ts). Here the
  // planner skeleton is swapped for recaps + planner in one go, so nothing
  // already on screen moves. The async recaps are siblings, so their
  // queries still run in parallel with this one's.
  return (
    <div className="flex flex-col gap-6">
      <WeekPlanner
        dict={dict}
        locale={locale}
        weekStartKey={weekStartKey}
        recipes={recipeRows}
        entries={entries}
        activeShoppingLists={activeShoppingLists}
        batches={batches}
      />
      <MealVarietyRecapSection householdId={householdId} dict={dict} />
      <MealNutritionRecapSection householdId={householdId} dict={dict} weekStartKey={weekStartKey} />
    </div>
  );
}

function PlannerTabSkeleton({ label }: { label: string }) {
  return (
    <div className="list-bleed grid animate-pulse gap-3 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]" role="status" aria-label={label}>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="h-48 rounded-lg border bg-muted/40" />
      ))}
    </div>
  );
}

async function RecipesTabSection({
  householdId,
  currencyCode,
  dict,
  weekStartKey,
}: {
  householdId: string;
  // GAP-13: labels the recipe cost lines; null keeps plain numbers.
  currencyCode: string | null;
  dict: MealPlanningDict;
  weekStartKey: string;
}) {
  // GAP-46: its own groupBy, only run on this tab, like the cost inputs below.
  const [{ recipes, recipeRows, inventoryItems }, locale, recipeCooked] = await Promise.all([
    getMealPlanningCoreData(householdId, weekStartKey),
    getLocale(),
    getRecipeCookedStats(householdId),
  ]);

  const ingredientNames = [...new Set(inventoryItems.map((item) => item.name))].sort();
  // Lets the ingredient row preselect a unit once the name matches a known
  // inventory item — keyed case-insensitively since the combo field also
  // accepts free-typed names that may not match an option's exact casing.
  const ingredientUnits: Record<string, string> = {};
  for (const item of inventoryItems) {
    const key = item.name.toLowerCase();
    if (!(key in ingredientUnits)) ingredientUnits[key] = item.unit;
  }

  // "Use it up" suggestions (BACKLOG GAP-1) — a read-only nudge distinct from
  // the Cook tab's cookable-recipe list: this ranks by overlap with what's
  // expiring/low rather than by "almost everything on hand," so a recipe can
  // appear here while still missing plenty of other ingredients. Reuses the
  // same `inventoryItems` fetch already loaded above (via getMealPlanningCoreData's
  // cache()) instead of a separate query. `quantity` is passed through (not
  // folded into the pre-filter below) so computeUseItUpSuggestions' reasonFor
  // can gate out zero-quantity items — see its comment for why that gate
  // matters (an ingredient auto-created at quantity 0 is always "out," which
  // is backwards for a "use it up" suggestion). The pre-filter drops them
  // too: item names aren't unique, so a zero-quantity "Milk" left in the
  // list could win the by-name match for an unlinked ingredient and hide an
  // on-hand, expiring "Milk" with the same name.
  const now = new Date();
  const flaggedInventoryItems: FlaggedInventoryItem[] = inventoryItems
    .map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      expiryStatus: getExpiryStatus(item.expiresAt, now.getTime()),
      stockStatus: getStockStatus(item.quantity, item.lowStockThreshold),
    }))
    .filter(
      (item) =>
        item.quantity > 0 &&
        (item.expiryStatus !== null || item.stockStatus !== "in"),
    );
  const useItUpSuggestions = computeUseItUpSuggestions(
    recipes.map((recipe) => ({
      recipeId: recipe.id,
      recipeName: recipe.name,
      isFavorite: recipe.isFavorite,
      // A "Don't track" row (MATCH-2) is never something to use up.
      ingredients: recipe.ingredients
        .filter((ingredient) => !ingredient.untracked)
        .map((ingredient) => ({
          name: ingredient.name,
          inventoryItemId: ingredient.inventoryItemId,
        })),
    })),
    flaggedInventoryItems,
  );

  // GAP-15: an estimated cost per recipe from each linked ingredient's
  // lastKnownPrice, joined in memory against the same cached inventory fetch
  // rather than a nested include on the recipe query (which the Planner and
  // Cook tabs would pay for too). lastKnownPrice is the price of one
  // purchased shopping-list line, not of one unit, so computeRecipeCost
  // also needs the purchased lines themselves to divide it by the quantity
  // it bought — see its doc comment. That's the one extra query here, only
  // run on this tab, and narrowed to the inventory items some recipe
  // actually links to (and that have a price at all) so it doesn't pull
  // the household's whole purchase history. Newest-first so
  // unitPriceFromLastPurchase picks the most recent matching line.
  // Keyed by recipe id and only holding recipes where at least one
  // ingredient could be priced, so RecipeManager simply shows nothing for
  // the rest. Only a recipe's own ingredients count, not its sub-recipes',
  // same as the nutrition line it sits under.
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  const pricedLinkedItemIds = [
    ...new Set(
      recipes.flatMap((recipe) =>
        recipe.ingredients
          .map((ingredient) => ingredient.inventoryItemId)
          .filter((id): id is string => id !== null && inventoryById.get(id)?.lastKnownPrice != null),
      ),
    ),
  ];
  // MATCH-3: the same priced items' saved unit conversions, fetched once
  // alongside, so "300 g" of flour counted in pcs can still be priced.
  const [purchasedLines, unitConversions] =
    pricedLinkedItemIds.length > 0
      ? await Promise.all([
          prisma.shoppingListItem.findMany({
            where: {
              shoppingList: { householdId },
              inventoryItemId: { in: pricedLinkedItemIds },
              purchased: true,
              estimatedPrice: { not: null },
            },
            select: { inventoryItemId: true, quantity: true, unit: true, estimatedPrice: true },
            orderBy: { createdAt: "desc" },
          }),
          prisma.itemUnitConversion.findMany({
            where: { inventoryItemId: { in: pricedLinkedItemIds }, inventoryItem: { householdId } },
            select: { inventoryItemId: true, fromUnit: true, factor: true },
          }),
        ])
      : [[], []];
  const conversionsByItemId = new Map<string, ItemUnitConversionLike[]>();
  for (const conversion of unitConversions) {
    const list = conversionsByItemId.get(conversion.inventoryItemId) ?? [];
    list.push(conversion);
    conversionsByItemId.set(conversion.inventoryItemId, list);
  }
  const purchasesByItemId = new Map<string, RecipeCostPurchase[]>();
  for (const line of purchasedLines) {
    if (line.inventoryItemId === null || line.estimatedPrice === null) continue;
    const list = purchasesByItemId.get(line.inventoryItemId) ?? [];
    list.push({ quantity: line.quantity, unit: line.unit, price: line.estimatedPrice });
    purchasesByItemId.set(line.inventoryItemId, list);
  }

  const recipeCosts: Record<string, RecipeCost> = {};
  for (const recipe of recipes) {
    const cost = computeRecipeCost(
      recipe.ingredients.map((ingredient) => {
        const item = ingredient.inventoryItemId ? inventoryById.get(ingredient.inventoryItemId) : undefined;
        return {
          untracked: ingredient.untracked,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          inventoryItem: item
            ? {
                unit: item.unit,
                lastKnownPrice: item.lastKnownPrice,
                purchases: purchasesByItemId.get(item.id) ?? [],
                conversions: conversionsByItemId.get(item.id) ?? [],
              }
            : null,
        };
      }),
      recipe.servings,
    );
    if (cost) recipeCosts[recipe.id] = cost;
  }

  return (
    <RecipeManager
      dict={dict}
      locale={locale}
      currencyCode={currencyCode}
      recipes={recipeRows}
      recipeCosts={recipeCosts}
      recipeCooked={recipeCooked}
      useItUpSuggestions={useItUpSuggestions}
      ingredientNames={ingredientNames}
      ingredientUnits={ingredientUnits}
    />
  );
}

function RecipesTabSkeleton({ label }: { label: string }) {
  return (
    <div className="list-bleed flex animate-pulse flex-col gap-2" role="status" aria-label={label}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 rounded-md border bg-muted/40" />
      ))}
    </div>
  );
}

// SCALE-J: getCookableRecipes depends on `recipes` (from the shared core
// fetch above) and then runs its own extra per-recipe expansion against
// inventory (one query per recipe, plus a loose-name fallback lookup — see
// its doc comment in cookable-recipes.ts), which can't join the core
// Promise.all above since it needs `recipes` already resolved. Isolating it
// in its own Suspense boundary keeps that extra round trip from delaying
// the Planner/Recipes tabs, which have no such dependency.
async function CookTabSection({
  householdId,
  dict,
  weekStartKey,
}: {
  householdId: string;
  dict: MealPlanningDict;
  weekStartKey: string;
}) {
  const { recipes, recipeRows } = await getMealPlanningCoreData(householdId, weekStartKey);
  const cookableRecipes = await getCookableRecipes(
    householdId,
    recipes.map((recipe) => ({ id: recipe.id, name: recipe.name, isFavorite: recipe.isFavorite })),
  );
  return (
    <CookNowList
      dict={dict}
      cookableRecipes={cookableRecipes}
      recipes={recipeRows}
      plannerWeekStartKey={weekStartKey}
    />
  );
}

function CookTabSkeleton({ label }: { label: string }) {
  return (
    <div className="list-bleed flex animate-pulse flex-col divide-y rounded-md border" role="status" aria-label={label}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 bg-muted/40" />
      ))}
    </div>
  );
}

// GAP-49: the active meal-prep batches are their own query (not part of the
// shared core fetch the other tabs wait on), so the Prep tab gets its own
// Suspense boundary like Cook now. The recipes come from the core fetch for
// the Record prep dialog's recipe picker.
async function PrepTabSection({
  householdId,
  dict,
  inventoryDict,
  weekStartKey,
}: {
  householdId: string;
  dict: MealPlanningDict;
  inventoryDict: Dictionary["inventory"];
  weekStartKey: string;
}) {
  const [{ recipeRows }, batches, locale] = await Promise.all([
    getMealPlanningCoreData(householdId, weekStartKey),
    getActiveBatches(householdId),
    getLocale(),
  ]);
  return (
    <PrepTab
      dict={dict}
      inventoryDict={inventoryDict}
      locale={locale}
      batches={batches}
      recipes={recipeRows}
      maxDishes={MAX_PREP_DISHES}
    />
  );
}

// The heading, the full-width Record prep button and a few batch cards.
function PrepTabSkeleton({ label }: { label: string }) {
  return (
    <div className="flex animate-pulse flex-col gap-3" role="status" aria-label={label}>
      <div className="h-14 rounded-md bg-muted/40" />
      <div className="h-11 rounded-lg border bg-muted/40" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="list-bleed h-36 rounded-xl border bg-muted/40" />
      ))}
    </div>
  );
}

export default async function MealPlanningPage(props: PageProps<"/dashboard/meal-planning">) {
  const [{ household }, dict, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    props.searchParams,
  ]);

  const weekParam = searchParams.week;
  const weekParamValue = Array.isArray(weekParam) ? weekParam[0] : weekParam;
  const weekStart = isDateKey(weekParamValue) ? parseDateKey(weekParamValue) : getWeekStart(new Date());
  const weekStartKey = toDateKey(weekStart);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>{dict.mealPlanning.title}</PageTitle>
        <p className="text-sm text-muted-foreground">{dict.mealPlanning.subtitle}</p>
      </div>

      <MealPlanningView
        dict={dict.mealPlanning}
        plannerTab={
          <Suspense key="planner-tab" fallback={<PlannerTabSkeleton label={dict.common.loading} />}>
            <PlannerTabSection householdId={household.id} dict={dict.mealPlanning} weekStartKey={weekStartKey} />
          </Suspense>
        }
        recipesTab={
          <Suspense key="recipes-tab" fallback={<RecipesTabSkeleton label={dict.common.loading} />}>
            <RecipesTabSection
              householdId={household.id}
              currencyCode={household.currencyCode}
              dict={dict.mealPlanning}
              weekStartKey={weekStartKey}
            />
          </Suspense>
        }
        cookTab={
          <Suspense key="cook-tab" fallback={<CookTabSkeleton label={dict.common.loading} />}>
            <CookTabSection householdId={household.id} dict={dict.mealPlanning} weekStartKey={weekStartKey} />
          </Suspense>
        }
        prepTab={
          <Suspense key="prep-tab" fallback={<PrepTabSkeleton label={dict.common.loading} />}>
            <PrepTabSection
              householdId={household.id}
              dict={dict.mealPlanning}
              inventoryDict={dict.inventory}
              weekStartKey={weekStartKey}
            />
          </Suspense>
        }
      />
    </div>
  );
}
