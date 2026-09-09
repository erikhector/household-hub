import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { MealPlanningView } from "@/components/meal-planning/meal-planning-view";
import { getWeekStart, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

export default async function MealPlanningPage(props: PageProps<"/dashboard/meal-planning">) {
  const [{ household }, dict, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    props.searchParams,
  ]);

  const weekParam = searchParams.week;
  const weekParamValue = Array.isArray(weekParam) ? weekParam[0] : weekParam;
  const weekStart = isDateKey(weekParamValue) ? parseDateKey(weekParamValue) : getWeekStart(new Date());

  const [recipes, mealPlan, activeShoppingLists] = await Promise.all([
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
  ]);

  return (
    <MealPlanningView
      dict={dict.mealPlanning}
      weekStartKey={toDateKey(weekStart)}
      recipes={recipes.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        instructions: recipe.instructions,
        servings: recipe.servings,
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
    />
  );
}
