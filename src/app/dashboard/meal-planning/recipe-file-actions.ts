"use server";

// Recipe import from a file (GAP-67): "Import from a file" on the Recipes
// tab (src/components/meal-planning/recipe-file-import-dialog.tsx). Two
// steps, both server-side, both re-reading the same uploaded file:
//   1. previewRecipeFileAction parses it and returns the list for review.
//      Nothing is saved.
//   2. importRecipesFromFileAction receives the file again plus the indexes
//      the user left ticked, parses it again (the parser is deterministic)
//      and saves those. The client never sends recipe content back, so what
//      is saved is always what the parser produced from the file, within
//      the same bounds a hand-typed recipe has.
// Like the URL import it is rate-limited per household and the parser's size
// and count caps are checked before anything is inflated (see
// src/lib/recipe-import/parse-file.ts).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeItemName } from "@/lib/item-matching";
import { parseRecipeFile, RECIPE_FILE_MAX_BYTES, type FileRecipe, type RecipeFileError } from "@/lib/recipe-import";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

// Each file costs two requests (preview, then import), and each one parses up
// to 5 MB, so this is a little looser than the URL import's 20 per hour while
// still bounding what one household can make the server do.
const RECIPE_FILE_RATE_LIMIT = 30;
const RECIPE_FILE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

type MealPlanningDict = Awaited<ReturnType<typeof getDictionary>>["mealPlanning"];

export type RecipeFilePreviewRow = {
  index: number;
  name: string;
  ingredientCount: number;
  /** A recipe with this name is already in the household. */
  exists: boolean;
};
export type PreviewRecipeFileState = ActionState & {
  preview?: { recipes: RecipeFilePreviewRow[]; skipped: number };
};
export type ImportRecipesFromFileState = ActionState & { imported?: number };

function fileErrorMessage(error: RecipeFileError, dict: MealPlanningDict): string {
  switch (error) {
    case "empty":
      return dict.importFileErrorEmpty;
    case "tooLarge":
      return dict.importFileErrorTooLarge;
    case "tooMany":
      return dict.importFileErrorTooMany;
    case "noRecipes":
      return dict.importFileErrorNoRecipes;
    case "unsupported":
    default:
      return dict.importFileErrorUnsupported;
  }
}

/** The uploaded file, parsed; or the message to show. */
async function readUpload(
  formData: FormData,
  dict: MealPlanningDict,
): Promise<{ recipes: FileRecipe[]; skipped: number } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: dict.importFileErrorNoFile };
  // Checked on the declared size first so an oversized upload is never read
  // into memory; parseRecipeFile checks the real byte length again.
  if (file.size > RECIPE_FILE_MAX_BYTES) return { error: dict.importFileErrorTooLarge };
  const result = parseRecipeFile(new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return { error: fileErrorMessage(result.error, dict) };
  return { recipes: result.recipes, skipped: result.skipped };
}

async function limited(householdId: string): Promise<boolean> {
  return !(await checkRateLimit(
    `recipe-file-import:${householdId}`,
    RECIPE_FILE_RATE_LIMIT,
    RECIPE_FILE_RATE_LIMIT_WINDOW_MS,
  ));
}

export async function previewRecipeFileAction(
  _prevState: PreviewRecipeFileState,
  formData: FormData,
): Promise<PreviewRecipeFileState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).mealPlanning;
  if (await limited(household.id)) return { error: dict.importFileErrorRateLimited };

  const parsed = await readUpload(formData, dict);
  if ("error" in parsed) return { error: parsed.error };

  // Names already in this household, so the review can flag a recipe that
  // would become a twin. Compared the way item names are, so "Pancakes " and
  // "pancakes" count as the same.
  const existing = await prisma.recipe.findMany({
    where: { householdId: household.id },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((recipe) => normalizeItemName(recipe.name)));

  return {
    preview: {
      skipped: parsed.skipped,
      recipes: parsed.recipes.map((recipe, index) => ({
        index,
        name: recipe.name,
        ingredientCount: recipe.ingredients.length,
        exists: existingNames.has(normalizeItemName(recipe.name)),
      })),
    },
  };
}

export async function importRecipesFromFileAction(
  _prevState: ImportRecipesFromFileState,
  formData: FormData,
): Promise<ImportRecipesFromFileState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).mealPlanning;
  if (await limited(household.id)) return { error: dict.importFileErrorRateLimited };

  const parsed = await readUpload(formData, dict);
  if ("error" in parsed) return { error: parsed.error };

  // Indexes into the parsed list. Anything that isn't one is ignored, and
  // repeats collapse, so a hand-built POST can't select a recipe twice.
  const selected = [
    ...new Set(
      formData
        .getAll("index")
        .map((value) => Number(value))
        .filter((index) => Number.isInteger(index) && index >= 0 && index < parsed.recipes.length),
    ),
  ];
  if (selected.length === 0) return { error: dict.importFileErrorNoneSelected };

  // An ingredient links to a pantry item only when exactly one item has its
  // (normalized) name, the same rule a recipe saved with no review decision
  // follows. Everything else stays unlinked and is matched by name when it's
  // cooked or shopped for; nothing creates items from an import.
  const items = await prisma.inventoryItem.findMany({
    where: { householdId: household.id },
    select: { id: true, name: true },
  });
  const idsByName = new Map<string, string[]>();
  for (const item of items) {
    const key = normalizeItemName(item.name);
    idsByName.set(key, [...(idsByName.get(key) ?? []), item.id]);
  }
  const linkedId = (name: string) => {
    const ids = idsByName.get(normalizeItemName(name));
    return ids?.length === 1 ? ids[0] : null;
  };

  try {
    // One batched transaction: either every ticked recipe is saved or none.
    await prisma.$transaction(
      selected.map((index) => {
        const recipe = parsed.recipes[index];
        return prisma.recipe.create({
          data: {
            householdId: household.id,
            name: recipe.name,
            instructions: recipe.instructions || null,
            servings: recipe.servings,
            tags: recipe.tags,
            ingredients: {
              create: recipe.ingredients.map((ingredient) => ({
                inventoryItemId: linkedId(ingredient.name),
                name: ingredient.name,
                quantity: ingredient.quantity,
                unit: ingredient.unit,
                rawText: ingredient.rawText ?? null,
                note: ingredient.note ?? null,
              })),
            },
          },
          select: { id: true },
        });
      }),
    );
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  return { imported: selected.length };
}
