import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { MealPlanningView } from "@/components/meal-planning/meal-planning-view";
import { getWeekStart, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { computeMealVarietyRecap } from "@/app/dashboard/meal-planning/meal-variety-calc";
import { getCookableRecipes } from "@/app/dashboard/meal-planning/cookable-recipes";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import { getStockStatus } from "@/lib/stock-status";
import { computeUseItUpSuggestions, type FlaggedInventoryItem } from "@/lib/inventory/use-it-up-calc";

export default async function MealPlanningPage(props: PageProps<"/dashboard/meal-planning">) {
  const [{ household }, dict, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    props.searchParams,
  ]);

  const weekParam = searchParams.week;
  const weekParamValue = Array.isArray(weekParam) ? weekParam[0] : weekParam;
  const weekStart = isDateKey(weekParamValue) ? parseDateKey(weekParamValue) : getWeekStart(new Date());

  const now = new Date();
  const varietyWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [recipes, mealPlan, activeShoppingLists, varietyEntries, inventoryItems] = await Promise.all([
    prisma.recipe.findMany({
      where: { householdId: household.id },
      include: {
        ingredients: true,
        components: { include: { componentRecipe: { select: { id: true, name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.mealPlan.findFirst({
      where: { householdId: household.id, weekStartDate: weekStart },
      include: { entries: { include: { recipe: true }, orderBy: { date: "asc" } } },
    }),
    prisma.shoppingList.findMany({
      where: { householdId: household.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    // Feeds the "variety recap" (see docs/archive/JOY_GAP_BACKLOG.md item 5) — a
    // trailing-30-day window across all weeks, independent of whichever
    // week is currently displayed above.
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id }, date: { gte: varietyWindowStart, lte: now } },
      select: { date: true, recipeId: true },
    }),
    // Feeds the ingredient-name autocomplete in RecipeFormDialog (name, unit)
    // and the "use it up" suggestion chips below (id, quantity,
    // lowStockThreshold, expiresAt) — one query covers both rather than
    // fetching the household's inventory twice.
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, unit: true, quantity: true, lowStockThreshold: true, expiresAt: true },
    }),
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

  const { distinctRecipeCount } = computeMealVarietyRecap({ entries: varietyEntries, now });

  // Depends on `recipes` above, so it can't join the Promise.all batch —
  // runs after, one expansion per recipe plus (at most) one inventory query.
  const cookableRecipes = await getCookableRecipes(
    household.id,
    recipes.map((recipe) => ({ id: recipe.id, name: recipe.name })),
  );

  // "Use it up" suggestions (BACKLOG GAP-1) — a read-only nudge distinct from
  // cookableRecipes above: this ranks by overlap with what's expiring/low
  // rather than by "almost everything on hand," so a recipe can appear here
  // while still missing plenty of other ingredients. Reuses the same
  // `inventoryItems` fetch already loaded for the ingredient autocomplete
  // instead of a separate query. `quantity` is passed through (not folded
  // into the pre-filter below) so computeUseItUpSuggestions' reasonFor can
  // gate out zero-quantity items — see its comment for why that gate matters
  // (an ingredient auto-created at quantity 0 is always "out," which is
  // backwards for a "use it up" suggestion). The pre-filter drops them too:
  // item names aren't unique, so a zero-quantity "Milk" left in the list
  // could win the by-name match for an unlinked ingredient and hide an
  // on-hand, expiring "Milk" with the same name.
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
      ingredients: recipe.ingredients.map((ingredient) => ({
        name: ingredient.name,
        inventoryItemId: ingredient.inventoryItemId,
      })),
    })),
    flaggedInventoryItems,
  );

  return (
    <MealPlanningView
      dict={dict.mealPlanning}
      weekStartKey={toDateKey(weekStart)}
      recipes={recipes.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        instructions: recipe.instructions,
        servings: recipe.servings,
        caloriesPerServing: recipe.caloriesPerServing,
        proteinGramsPerServing: recipe.proteinGramsPerServing,
        carbsGramsPerServing: recipe.carbsGramsPerServing,
        fatGramsPerServing: recipe.fatGramsPerServing,
        ingredients: recipe.ingredients.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
        })),
        components: recipe.components.map((component) => ({
          id: component.id,
          componentRecipeId: component.componentRecipeId,
          componentRecipeName: component.componentRecipe.name,
          quantity: component.quantity,
        })),
      }))}
      entries={(mealPlan?.entries ?? []).map((entry) => ({
        id: entry.id,
        date: toDateKey(entry.date),
        mealType: entry.mealType,
        recipeId: entry.recipeId,
        recipeName: entry.recipe?.name ?? null,
        freeformName: entry.freeformName,
        portions: entry.portions,
        consumedAt: entry.consumedAt ? entry.consumedAt.toISOString() : null,
      }))}
      activeShoppingLists={activeShoppingLists}
      varietyCount={distinctRecipeCount}
      cookableRecipes={cookableRecipes}
      useItUpSuggestions={useItUpSuggestions}
      ingredientNames={ingredientNames}
      ingredientUnits={ingredientUnits}
    />
  );
}
