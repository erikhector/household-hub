"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import {
  fetchRecipeHtml,
  parseRecipeFromHtml,
  type FetchRecipeError,
  type RecipeImportSource,
} from "@/lib/recipe-import";
// GAP-29: the `tags` checkboxes arrive as repeated FormData values and are
// run through the closed-set parser on every create/update — unknown keys
// are dropped, so nothing outside RECIPE_TAGS can reach Recipe.tags no
// matter what the client posts.
import { parseRecipeTags, type RecipeTag } from "@/lib/recipe-tags";
import { wouldCreateCycle } from "@/app/dashboard/meal-planning/recipe-components";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

type MealPlanningDict = Awaited<ReturnType<typeof getDictionary>>["mealPlanning"];

type IngredientRow = { name: string; quantity: number; unit: string };

// Mirrors recipeSchema's own bounds (name: 120, kept modest since ingredient
// names/units are always short words/phrases, never freeform prose) — every
// row is validated here rather than via a zod array schema because rows
// arrive as parallel FormData.getAll() arrays, not a single JSON payload.
const MAX_INGREDIENT_NAME_LENGTH = 120;
const MAX_INGREDIENT_UNIT_LENGTH = 20;
const MAX_INGREDIENT_QUANTITY = 1_000_000;

async function parseIngredientRows(
  formData: FormData,
  householdId: string,
): Promise<{ data: (IngredientRow & { inventoryItemId: string })[] } | { error: string }> {
  const names = formData.getAll("ingredientName").map((v) => String(v).trim());
  const quantities = formData.getAll("ingredientQuantity").map((v) => String(v).trim());
  const units = formData.getAll("ingredientUnit").map((v) => String(v).trim());

  const rows: IngredientRow[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    if (name.length > MAX_INGREDIENT_NAME_LENGTH) {
      return { error: `Ingredient names must be ${MAX_INGREDIENT_NAME_LENGTH} characters or fewer` };
    }

    const unit = units[i] || "pcs";
    if (unit.length > MAX_INGREDIENT_UNIT_LENGTH) {
      return { error: `Ingredient units must be ${MAX_INGREDIENT_UNIT_LENGTH} characters or fewer` };
    }

    const quantity = Number(quantities[i] || "1");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_INGREDIENT_QUANTITY) {
      return { error: "Ingredient quantities must be greater than 0" };
    }

    rows.push({ name, quantity, unit });
  }

  if (rows.length === 0) return { data: [] };

  // Batched find-or-create (SCALE-B): one case-insensitive lookup across
  // every distinct ingredient name, one createMany for the names that
  // don't already exist, instead of N parallel findFirst/create pairs.
  const uniqueNames = Array.from(new Set(rows.map((row) => row.name)));
  const existingItems = await prisma.inventoryItem.findMany({
    where: { householdId, name: { in: uniqueNames, mode: "insensitive" } },
  });
  const existingByLowerName = new Map(existingItems.map((item) => [item.name.toLowerCase(), item]));

  // Dedupe by lowercase too, so two rows differing only in case ("Milk" /
  // "milk") don't try to create the same item twice.
  const namesToCreate = Array.from(
    new Map(
      uniqueNames
        .filter((name) => !existingByLowerName.has(name.toLowerCase()))
        .map((name) => [name.toLowerCase(), name]),
    ).values(),
  );
  // Each brand-new ingredient gets a real guessed category (AUTO-2b) — the
  // same household-memory-then-dictionary resolver the inventory and
  // shopping-list create paths already use — instead of the "Uncategorized"
  // placeholder. createCategoryResolver loads the household's inventory on
  // its own first call below and memoizes it for the rest, so resolving
  // every name in namesToCreate costs one extra query for the whole batch,
  // not one per ingredient, and it's never invoked at all when nothing
  // needs creating.
  const resolveCategory = createCategoryResolver(householdId);
  const categoryByName = new Map<string, string>();
  // AUTO-2b(a): names neither tier recognized go to the optional AI
  // fallback once they've been created below, same as every other
  // InventoryItem create path.
  const aiCandidates: string[] = [];
  for (const name of namesToCreate) {
    const guessed = await resolveCategory(name);
    if (!guessed) aiCandidates.push(name);
    categoryByName.set(name, guessed || "Uncategorized");
  }

  const createdItems =
    namesToCreate.length > 0
      ? await prisma.inventoryItem.createManyAndReturn({
          data: namesToCreate.map((name) => ({
            householdId,
            name,
            category: categoryByName.get(name)!,
            quantity: 0,
            lowStockThreshold: 0,
          })),
        })
      : [];
  // The rows are committed by now, so the background patch can't race their
  // creation. A no-op when no AI provider key is configured.
  if (aiCandidates.length > 0) scheduleAiCategoryFallback(householdId, aiCandidates);
  const itemByLowerName = new Map(
    [...existingItems, ...createdItems].map((item) => [item.name.toLowerCase(), item]),
  );

  // Preserves the original row order in the returned array.
  const data = rows.map((row) => ({
    ...row,
    inventoryItemId: itemByLowerName.get(row.name.toLowerCase())!.id,
  }));

  return { data };
}

// Optional, manual-entry-only nutrition fields (see Recipe's doc comment in
// schema.prisma) — each arrives from the form as "" when left blank, which
// must become `null` (not `undefined`) so an update can actually clear a
// previously-set value, mirroring InventoryItem.expiresAt's optional-string
// -> null transform in src/app/dashboard/inventory/actions.ts.
const optionalNonNegativeNumber = z
  .string()
  .optional()
  .transform((value) => (value ? Number(value) : null))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
    message: "Nutrition values can't be negative",
  });

// Same as above but rounded to a whole number, matching
// `caloriesPerServing Int?` in schema.prisma (a fractional calorie count
// would otherwise reject at the database layer).
const optionalNonNegativeInt = optionalNonNegativeNumber.transform((value) =>
  value === null ? null : Math.round(value),
);

const recipeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  instructions: z.string().trim().max(4000).optional(),
  servings: z.coerce.number().int().min(1, "Servings must be at least 1").max(1_000),
  caloriesPerServing: optionalNonNegativeInt,
  proteinGramsPerServing: optionalNonNegativeNumber,
  carbsGramsPerServing: optionalNonNegativeNumber,
  fatGramsPerServing: optionalNonNegativeNumber,
});

type ComponentRow = { componentRecipeId: string; quantity: number };

// Mirrors parseIngredientRows: rows arrive as parallel FormData.getAll()
// arrays. `parentRecipeId` is undefined for a brand-new recipe — it can't
// be anyone's descendant yet, so the cycle check is skipped entirely rather
// than trivially passing on every candidate.
const MAX_COMPONENT_QUANTITY = 1_000;

async function parseComponentRows(
  formData: FormData,
  householdId: string,
  parentRecipeId: string | undefined,
  dict: MealPlanningDict,
): Promise<{ data: ComponentRow[] } | { error: string }> {
  const ids = formData.getAll("componentRecipeId").map((v) => String(v).trim());
  const quantities = formData.getAll("componentQuantity").map((v) => String(v).trim());

  const seen = new Set<string>();
  const candidates: ComponentRow[] = [];
  for (let i = 0; i < ids.length; i++) {
    const componentRecipeId = ids[i];
    if (!componentRecipeId || seen.has(componentRecipeId)) continue;
    seen.add(componentRecipeId);

    const quantity = Number(quantities[i] || "1");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_COMPONENT_QUANTITY) {
      return { error: dict.componentQuantityError };
    }

    candidates.push({ componentRecipeId, quantity });
  }

  if (candidates.length === 0) return { data: [] };

  // Batched existence check (SCALE-B): one findMany for every candidate id
  // instead of a findFirst per row. wouldCreateCycle stays per-row — it's a
  // graph check, not a flat lookup.
  const foundRecipes = await prisma.recipe.findMany({
    where: { id: { in: candidates.map((c) => c.componentRecipeId) }, householdId },
    select: { id: true },
  });
  const foundIds = new Set(foundRecipes.map((r) => r.id));

  const rows: ComponentRow[] = [];
  for (const candidate of candidates) {
    if (!foundIds.has(candidate.componentRecipeId)) return { error: dict.componentNotFoundError };

    if (parentRecipeId && (await wouldCreateCycle(parentRecipeId, candidate.componentRecipeId))) {
      return { error: dict.componentCycleError };
    }

    rows.push(candidate);
  }

  return { data: rows };
}

export async function createRecipeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = await getDictionary();

  const parsed = recipeSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
    servings: formData.get("servings") || 4,
    caloriesPerServing: formData.get("caloriesPerServing") || undefined,
    proteinGramsPerServing: formData.get("proteinGramsPerServing") || undefined,
    carbsGramsPerServing: formData.get("carbsGramsPerServing") || undefined,
    fatGramsPerServing: formData.get("fatGramsPerServing") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ingredients = await parseIngredientRows(formData, household.id);
  if ("error" in ingredients) return { error: ingredients.error };

  const components = await parseComponentRows(formData, household.id, undefined, dict.mealPlanning);
  if ("error" in components) return { error: components.error };

  await prisma.recipe.create({
    data: {
      householdId: household.id,
      name: parsed.data.name,
      instructions: parsed.data.instructions || null,
      servings: parsed.data.servings,
      caloriesPerServing: parsed.data.caloriesPerServing,
      proteinGramsPerServing: parsed.data.proteinGramsPerServing,
      carbsGramsPerServing: parsed.data.carbsGramsPerServing,
      fatGramsPerServing: parsed.data.fatGramsPerServing,
      tags: parseRecipeTags(formData.getAll("tags")),
      ingredients: { create: ingredients.data },
      components: { create: components.data },
    },
  });

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export async function updateRecipeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = await getDictionary();

  const recipeId = String(formData.get("recipeId") ?? "");
  const parsed = recipeSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
    servings: formData.get("servings") || 4,
    caloriesPerServing: formData.get("caloriesPerServing") || undefined,
    proteinGramsPerServing: formData.get("proteinGramsPerServing") || undefined,
    carbsGramsPerServing: formData.get("carbsGramsPerServing") || undefined,
    fatGramsPerServing: formData.get("fatGramsPerServing") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, householdId: household.id },
  });
  if (!recipe) return { error: "Recipe not found" };

  const ingredients = await parseIngredientRows(formData, household.id);
  if ("error" in ingredients) return { error: ingredients.error };

  const components = await parseComponentRows(formData, household.id, recipe.id, dict.mealPlanning);
  if ("error" in components) return { error: components.error };

  await prisma.$transaction([
    prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } }),
    prisma.recipeComponent.deleteMany({ where: { parentRecipeId: recipe.id } }),
    prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        name: parsed.data.name,
        instructions: parsed.data.instructions || null,
        servings: parsed.data.servings,
        caloriesPerServing: parsed.data.caloriesPerServing,
        proteinGramsPerServing: parsed.data.proteinGramsPerServing,
        carbsGramsPerServing: parsed.data.carbsGramsPerServing,
        fatGramsPerServing: parsed.data.fatGramsPerServing,
        // Replaced wholesale, like ingredients/components — an edit that
        // un-ticks every chip sends no `tags` at all and clears them.
        tags: parseRecipeTags(formData.getAll("tags")),
        ingredients: { create: ingredients.data },
        components: { create: components.data },
      },
    }),
  ]);

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export async function deleteRecipeAction(recipeId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = await getDictionary();

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, householdId: household.id },
  });
  if (!recipe) return {};

  // Blocking here (rather than letting the RESTRICT foreign key throw) gives
  // a clear, translated error naming the recipe that still depends on it —
  // see RecipeComponent's doc comment in schema.prisma.
  const usedAsComponent = await prisma.recipeComponent.findFirst({
    where: { componentRecipeId: recipe.id },
    include: { parentRecipe: { select: { name: true } } },
  });
  if (usedAsComponent) {
    return {
      error: format(dict.mealPlanning.deleteRecipeInUseError, {
        recipeName: usedAsComponent.parentRecipe.name,
      }),
    };
  }

  await prisma.recipe.delete({ where: { id: recipe.id } });

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

// Stars/un-stars a recipe (GAP-18). A click action (see AGENTS.md's action
// shapes), called from RecipeRow inside useTransition. The flip is computed
// here from the stored value rather than trusting a desired state from the
// client — same as toggleTaskCompletedAction — and the lookup is scoped to
// the caller's household so a foreign recipe id is a silent no-op, the same
// IDOR guard deleteRecipeAction uses. isFavorite is a household-wide flag,
// not a per-member one, so any member's star is everyone's star.
export async function toggleRecipeFavoriteAction(recipeId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, householdId: household.id },
    select: { id: true, isFavorite: true },
  });
  if (!recipe) return {};

  await prisma.recipe.update({
    where: { id: recipe.id },
    data: { isFavorite: !recipe.isFavorite },
  });

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export type ImportedRecipeIngredient = { name: string; quantity: number; unit: string };
export type ImportRecipeState = ActionState & {
  recipe?: {
    name: string;
    instructions: string;
    ingredients: ImportedRecipeIngredient[];
    // GAP-29: from JSON-LD `suitableForDiet` only; empty for the other
    // tiers. Pre-ticks the form's chips — still only saved on submit.
    tags: RecipeTag[];
    // Which extraction tier found it (GAP-31) — the form shows a "review
    // before saving" notice for anything but "jsonld".
    source: RecipeImportSource;
  };
};

function importErrorMessage(error: FetchRecipeError, dict: MealPlanningDict): string {
  switch (error) {
    case "invalidUrl":
      return dict.importErrorInvalidUrl;
    case "blockedHost":
      return dict.importErrorBlockedHost;
    case "tooLarge":
    case "tooManyRedirects":
    case "fetchFailed":
    default:
      return dict.importErrorFetchFailed;
  }
}

// Fetches a user-supplied recipe URL server-side and extracts its recipe
// (schema.org/Recipe JSON-LD, falling back to Microdata or a heading
// heuristic) to pre-fill RecipeFormDialog's fields — never
// saves anything itself; the user still reviews and submits
// createRecipeAction/updateRecipeAction. requireHousehold() just confirms
// the caller is an authenticated member of a household (this action doesn't
// read/write anything household-scoped), matching the rule that every
// action in this feature re-derives its caller from the session rather than
// trusting the client. See src/lib/recipe-import.ts for the SSRF-guarding
// fetch and the JSON-LD → Microdata → heading-heuristic parsing.
export async function importRecipeFromUrlAction(
  _prevState: ImportRecipeState,
  formData: FormData,
): Promise<ImportRecipeState> {
  await requireHousehold();
  const dict = await getDictionary();

  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: dict.mealPlanning.importErrorInvalidUrl };

  const fetched = await fetchRecipeHtml(url);
  if (!fetched.ok) return { error: importErrorMessage(fetched.error, dict.mealPlanning) };

  const recipe = parseRecipeFromHtml(fetched.html);
  if (!recipe) return { error: dict.mealPlanning.importErrorNoRecipeFound };

  return { recipe };
}
