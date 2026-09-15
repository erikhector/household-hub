import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { MealPlanningView } from "@/components/meal-planning/meal-planning-view";
import { getWeekStart, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { computeMealVarietyRecap } from "@/app/dashboard/meal-planning/meal-variety-calc";
import { getCookableRecipes } from "@/app/dashboard/meal-planning/cookable-recipes";

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
    // Feeds the "variety recap" (see JOY_GAP_BACKLOG.md item 5) — a
    // trailing-30-day window across all weeks, independent of whichever
    // week is currently displayed above.
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id }, date: { gte: varietyWindowStart, lte: now } },
      select: { date: true, recipeId: true },
    }),
    // Feeds the ingredient-name autocomplete in RecipeFormDialog — surfacing
    // the household's existing inventory item names steers users toward
    // reusing "Tomato" instead of typing a near-duplicate like "tomatoes",
    // which findOrCreateInventoryItem's case-insensitive match wouldn't catch.
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { name: true, unit: true },
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
      ingredientNames={ingredientNames}
      ingredientUnits={ingredientUnits}
    />
  );
}
