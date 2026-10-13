"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { checkRateLimit } from "@/lib/rate-limit";
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
import { normalizeItemName } from "@/lib/item-matching";
import {
  defaultNewItemUnit,
  ingredientBaseName,
  matchIngredientRows,
  type IngredientMatch,
} from "@/lib/recipes/ingredient-match";
import { canonicalUnit, classifyUnits, type ItemUnitConversionLike } from "@/lib/units";
import { MAX_UNIT_FACTOR, MIN_UNIT_FACTOR } from "@/lib/recipes/unit-choice";
import type { Prisma } from "@/generated/prisma/client";
import { fail, v, zodFail } from "@/lib/actions/errors";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

// SEC-2: importRecipeFromUrlAction makes this app's server fetch whatever
// URL a household member pastes in, so it's the one action here that can be
// used to hammer arbitrary third-party hosts (or repeatedly probe internal
// ones past the SSRF guard) from our own server. Same limit/window as the
// AI receipt scan's rate limit (src/lib/actions/receipt-scan.ts) — plenty
// for genuine use, tight enough that abusing it isn't worthwhile.
const RECIPE_IMPORT_RATE_LIMIT = 20;
const RECIPE_IMPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

type MealPlanningDict = Awaited<ReturnType<typeof getDictionary>>["mealPlanning"];

type IngredientRow = { name: string; quantity: number; unit: string };

// Mirrors recipeSchema's own bounds (name: 120, kept modest since ingredient
// names/units are always short words/phrases, never freeform prose) — every
// row is validated here rather than via a zod array schema because rows
// arrive as parallel FormData.getAll() arrays, not a single JSON payload.
const MAX_INGREDIENT_NAME_LENGTH = 120;
const MAX_INGREDIENT_UNIT_LENGTH = 20;
const MAX_INGREDIENT_QUANTITY = 1_000_000;
// SEC-7 (recipe part): a hard cap on rows, so one request can't make the
// server resolve, match or create thousands of items. Far above any real
// recipe; the preview action below uses the same cap.
const MAX_INGREDIENT_ROWS = 100;
// Same bound as the category field on the inventory item form.
const MAX_ITEM_CATEGORY_LENGTH = 60;
const MAX_ITEM_ID_LENGTH = 64;
// MATCH-2: the imported line and its prep note. An ingredient line on a
// recipe site is a sentence at most; these only stop a direct POST from
// storing an essay per row.
const MAX_INGREDIENT_RAW_TEXT_LENGTH = 300;
const MAX_INGREDIENT_NOTE_LENGTH = 200;

// MATCH-1: what the "Match ingredients" step decided for one row. `existing`
// links to `ingredientItemId`; `new` creates an item from the
// `ingredientNew*` fields; `untracked` (MATCH-2, "Don't track") saves the
// row with no link on purpose. A row with no decision (an older client, or
// a direct POST) only ever links on an exact name match — it never creates.
const ingredientDecisionSchema = z.enum(["existing", "new", "untracked"]);
type IngredientDecision = z.infer<typeof ingredientDecisionSchema>;

// MATCH-3 (design §3.3/§3.4): what to do about a row whose unit the linked
// item can't convert. `remember` saves `ingredientUnitFactor` as the item's
// own conversion (1 recipe unit = factor × item unit); `override` rewrites
// this row into the item's unit, `ingredientOverrideQuantity` of it, keeping
// the original line in rawText; `defer` (and `none`, or nothing at all)
// leaves it for "Mark as cooked" to ask, as before.
const ingredientUnitActionSchema = z.enum(["none", "remember", "override", "defer"]);
type IngredientUnitAction = z.infer<typeof ingredientUnitActionSchema>;

type ParsedIngredientRow = IngredientRow & {
  rawText: string | null;
  note: string | null;
  decision: IngredientDecision | null;
  itemId: string;
  newName: string;
  newCategory: string;
  newUnit: string;
  unitAction: IngredientUnitAction;
  unitFactor: number | null;
  overrideQuantity: number | null;
};

async function parseIngredientRows(
  formData: FormData,
  dict: MealPlanningDict,
): Promise<{ data: ParsedIngredientRow[] } | { error: string }> {
  const field = (key: string) => formData.getAll(key).map((v) => String(v).trim());
  const names = field("ingredientName");
  const quantities = field("ingredientQuantity");
  const units = field("ingredientUnit");
  const decisions = field("ingredientDecision");
  const itemIds = field("ingredientItemId");
  const newNames = field("ingredientNewName");
  const newCategories = field("ingredientNewCategory");
  const newUnits = field("ingredientNewUnit");
  const rawTexts = field("ingredientRawText");
  const notes = field("ingredientNote");
  const unitActions = field("ingredientUnitAction");
  const unitFactors = field("ingredientUnitFactor");
  const overrideQuantities = field("ingredientOverrideQuantity");

  const rows: ParsedIngredientRow[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    if (rows.length === MAX_INGREDIENT_ROWS) {
      return { error: format(dict.ingredientRowLimitError, { max: MAX_INGREDIENT_ROWS }) };
    }
    if (name.length > MAX_INGREDIENT_NAME_LENGTH) {
      return await fail("ingredientNameTooLong", { max: MAX_INGREDIENT_NAME_LENGTH });
    }

    const unit = units[i] || "pcs";
    if (unit.length > MAX_INGREDIENT_UNIT_LENGTH) {
      return await fail("ingredientUnitTooLong", { max: MAX_INGREDIENT_UNIT_LENGTH });
    }

    const quantity = Number(quantities[i] || "1");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_INGREDIENT_QUANTITY) {
      return await fail("ingredientQuantityPositive");
    }

    const rawText = rawTexts[i] || null;
    const note = notes[i] || null;
    if ((rawText?.length ?? 0) > MAX_INGREDIENT_RAW_TEXT_LENGTH || (note?.length ?? 0) > MAX_INGREDIENT_NOTE_LENGTH) {
      return await fail("invalidInput");
    }

    let decision: IngredientDecision | null = null;
    if (decisions[i]) {
      const parsed = ingredientDecisionSchema.safeParse(decisions[i]);
      if (!parsed.success) return await fail("invalidInput");
      decision = parsed.data;
    }

    const itemId = itemIds[i] ?? "";
    if (decision === "existing" && (!itemId || itemId.length > MAX_ITEM_ID_LENGTH)) {
      return { error: dict.ingredientItemNotFoundError };
    }

    // The default name drops a trailing "(prep note)" — "gul lök
    // (finhackad)" creates "gul lök" (see ingredientBaseName).
    const newName = newNames[i] || ingredientBaseName(name);
    const newCategory = newCategories[i] ?? "";
    const newUnit = newUnits[i] || defaultNewItemUnit(unit);
    if (decision === "new") {
      if (newName.length > MAX_INGREDIENT_NAME_LENGTH) {
        return await fail("ingredientNameTooLong", { max: MAX_INGREDIENT_NAME_LENGTH });
      }
      if (newCategory.length > MAX_ITEM_CATEGORY_LENGTH || newUnit.length > MAX_INGREDIENT_UNIT_LENGTH) {
        return await fail("invalidInput");
      }
    }

    // Only a row linked to an item (existing or new) has a unit to
    // reconcile; anything else sent for another row is ignored.
    let unitAction: IngredientUnitAction = "none";
    let unitFactor: number | null = null;
    let overrideQuantity: number | null = null;
    if (unitActions[i] && (decision === "existing" || decision === "new")) {
      const parsed = ingredientUnitActionSchema.safeParse(unitActions[i]);
      if (!parsed.success) return await fail("invalidInput");
      unitAction = parsed.data;
      if (unitAction === "remember") {
        unitFactor = Number(unitFactors[i] || "NaN");
        if (!Number.isFinite(unitFactor) || unitFactor < MIN_UNIT_FACTOR || unitFactor > MAX_UNIT_FACTOR) {
          return { error: dict.ingredientReview.unitFactorError };
        }
      } else if (unitAction === "override") {
        overrideQuantity = Number(overrideQuantities[i] || "NaN");
        if (!Number.isFinite(overrideQuantity) || overrideQuantity <= 0 || overrideQuantity > MAX_INGREDIENT_QUANTITY) {
          return { error: dict.ingredientReview.overrideQuantityError };
        }
      }
    }

    rows.push({
      name,
      quantity,
      unit,
      rawText,
      note,
      decision,
      itemId,
      newName,
      newCategory,
      newUnit,
      unitAction,
      unitFactor,
      overrideQuantity,
    });
  }

  return { data: rows };
}

type NewIngredientItem = { name: string; category: string; unit: string };

type ResolvedIngredientRow = IngredientRow & {
  rawText: string | null;
  note: string | null;
  untracked: boolean;
  inventoryItemId: string | null;
  newItemKey: string | null;
};

type ResolvedIngredients = {
  rows: ResolvedIngredientRow[];
  // Keyed by normalized name, so two "Create new" rows for the same thing
  // ("Milk" / "milk") create one item.
  newItems: Map<string, NewIngredientItem>;
  // MATCH-2 learning, keyed by the ingredient's normalized name: the item
  // it was linked to (an id, or the key of a new item), or null for "Don't
  // track". Written in the save's transaction.
  aliases: Map<string, IngredientItemTarget | null>;
  // MATCH-3 "Remember for this item": conversions to upsert, keyed by
  // target and unit so the last row about the same pair wins.
  conversions: Map<string, IngredientItemTarget & { fromUnit: string; factor: number }>;
  aiCandidates: string[];
};

// An item a row ends up linked to: one checked against the household, or
// one about to be created for it (keyed like `newItems`).
type IngredientItemTarget = { itemId: string } | { newItemKey: string };

// MATCH-1: turns each row's decision into a link, reading only (the writes
// happen in the caller's transaction). Replaces the old silent
// find-or-create: an item is only ever created for an explicit `new`.
async function resolveIngredientDecisions(
  rows: ParsedIngredientRow[],
  householdId: string,
  dict: MealPlanningDict,
): Promise<ResolvedIngredients | { error: string }> {
  // Every chosen item must belong to this household. An unknown or foreign
  // id is rejected outright, never quietly created or dropped.
  const chosenIds = [...new Set(rows.filter((row) => row.decision === "existing").map((row) => row.itemId))];
  const chosen = new Map<string, { normalizedName: string; unit: string }>();
  if (chosenIds.length > 0) {
    const found = await prisma.inventoryItem.findMany({
      where: { id: { in: chosenIds }, householdId },
      select: { id: true, name: true, unit: true },
    });
    if (found.length !== chosenIds.length) return { error: dict.ingredientItemNotFoundError };
    for (const item of found) chosen.set(item.id, { normalizedName: normalizeItemName(item.name), unit: item.unit });
  }

  // Undecided rows link on an exact (normalized) name, and a `new` row
  // whose name already exists exactly links to that item instead of
  // creating a twin — the same dedupe the old find-or-create did. Only
  // loaded when some row needs it; also seeds the category resolver below.
  const needsInventory = rows.some((row) => row.decision === "new" || row.decision === null);
  const inventory = needsInventory
    ? await prisma.inventoryItem.findMany({
        where: { householdId },
        select: { id: true, name: true, category: true, unit: true },
      })
    : [];
  const unitById = new Map(inventory.map((item) => [item.id, item.unit]));
  const idsByName = new Map<string, string[]>();
  for (const item of inventory) {
    const key = normalizeItemName(item.name);
    idsByName.set(key, [...(idsByName.get(key) ?? []), item.id]);
  }
  // Two items with the same name is a choice only the user can make.
  const exactId = (name: string) => {
    const ids = idsByName.get(normalizeItemName(name));
    return ids?.length === 1 ? ids[0] : null;
  };

  const newItems = new Map<string, NewIngredientItem>();
  const aliases: ResolvedIngredients["aliases"] = new Map();
  const conversions: ResolvedIngredients["conversions"] = new Map();
  const resolved: ResolvedIngredientRow[] = [];

  // MATCH-3 (design §3.3): a row linked to an item whose unit it doesn't
  // reconcile with carries the user's unit choice. Nothing is done for a
  // unit the generic table already handles, so a stale or hand-posted
  // choice can't store a conversion that would never be used, or one from
  // the item's own unit (§4).
  const linkedRow = (row: ParsedIngredientRow, target: IngredientItemTarget, itemUnit: string) => {
    const base = {
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      rawText: row.rawText,
      note: row.note,
      untracked: false,
    };
    if (classifyUnits(row.unit, itemUnit) !== "unknown") return base;
    if (row.unitAction === "remember" && row.unitFactor !== null) {
      const fromUnit = canonicalUnit(row.unit);
      const targetKey = "itemId" in target ? `id:${target.itemId}` : `new:${target.newItemKey}`;
      conversions.set(`${targetKey}::${fromUnit}`, { ...target, fromUnit, factor: row.unitFactor });
    } else if (row.unitAction === "override" && row.overrideQuantity !== null) {
      // "Use 0.15 pcs here only": the row is stored in the item's unit,
      // and the line as the recipe wrote it stays readable to the cook.
      return {
        ...base,
        quantity: row.overrideQuantity,
        unit: itemUnit,
        rawText: row.rawText ?? `${row.quantity} ${row.unit} ${row.name}`,
      };
    }
    return base;
  };

  // A `new` row's unit choice was answered against the unit the user gave
  // the new item. When the row ends up on an item counted in another unit
  // (its name already exists, or an earlier row created the item with a
  // different unit), that answer means nothing for it, and applying it
  // would store a conversion off by orders of magnitude. It's dropped, and
  // the row is left to be decided when cooking.
  const answeredFor = (row: ParsedIngredientRow, itemUnit: string): ParsedIngredientRow =>
    canonicalUnit(row.newUnit) === canonicalUnit(itemUnit) ? row : { ...row, unitAction: "none" };

  for (const row of rows) {
    const base = {
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      rawText: row.rawText,
      note: row.note,
      untracked: false,
    };
    // MATCH-2 learning (design §3.4): linking a name to an item called
    // something else ("eggs" → Egg) remembers it, so the next recipe with
    // "eggs" is confident. A link whose names already agree needs no alias,
    // since it matches exactly anyway. Keyed like the matcher looks it up.
    const aliasKey = normalizeItemName(ingredientBaseName(row.name));
    if (row.decision === "existing") {
      const item = chosen.get(row.itemId)!;
      resolved.push({
        ...linkedRow(row, { itemId: row.itemId }, item.unit),
        inventoryItemId: row.itemId,
        newItemKey: null,
      });
      if (aliasKey && aliasKey !== item.normalizedName) aliases.set(aliasKey, { itemId: row.itemId });
    } else if (row.decision === "untracked") {
      // "Don't track" is always remembered, so the same name defaults to it
      // next time (and water only has to be answered once).
      resolved.push({ ...base, untracked: true, inventoryItemId: null, newItemKey: null });
      if (aliasKey) aliases.set(aliasKey, null);
    } else if (row.decision === "new") {
      const existingId = exactId(row.newName);
      const key = normalizeItemName(row.newName);
      if (existingId) {
        resolved.push({
          ...linkedRow(answeredFor(row, unitById.get(existingId)!), { itemId: existingId }, unitById.get(existingId)!),
          inventoryItemId: existingId,
          newItemKey: null,
        });
        if (aliasKey && aliasKey !== key) aliases.set(aliasKey, { itemId: existingId });
        continue;
      }
      if (!key) {
        resolved.push({ ...base, inventoryItemId: null, newItemKey: null });
        continue;
      }
      if (!newItems.has(key)) {
        newItems.set(key, { name: row.newName, category: row.newCategory, unit: row.newUnit });
      }
      // Two rows for one new item share the first row's unit, since that's
      // the unit the item is created with.
      const newItemUnit = newItems.get(key)!.unit;
      resolved.push({
        ...linkedRow(answeredFor(row, newItemUnit), { newItemKey: key }, newItemUnit),
        inventoryItemId: null,
        newItemKey: key,
      });
      if (aliasKey && aliasKey !== key) aliases.set(aliasKey, { newItemKey: key });
    } else {
      resolved.push({ ...base, inventoryItemId: exactId(ingredientBaseName(row.name)), newItemKey: null });
    }
  }

  // Each new item left without a category gets a real guess (AUTO-2b) —
  // the same household-memory-then-dictionary resolver the inventory and
  // shopping-list create paths use — seeded with the inventory already
  // loaded above, so a batch costs no extra query. A category the user
  // typed is never second-guessed.
  const resolveCategory = createCategoryResolver(householdId, inventory);
  // AUTO-2b(a): names neither tier recognized go to the optional AI
  // fallback once they've been created, same as every other InventoryItem
  // create path.
  const aiCandidates: string[] = [];
  for (const item of newItems.values()) {
    if (item.category) continue;
    const guessed = await resolveCategory(item.name);
    if (!guessed) aiCandidates.push(item.name);
    item.category = guessed || "Uncategorized";
  }

  return { rows: resolved, newItems, aliases, conversions, aiCandidates };
}

// Writes the new items (if any) and the learned aliases with the given
// transaction client and returns the recipe's ingredient rows with every
// link filled in.
async function createIngredientItems(
  tx: Prisma.TransactionClient,
  householdId: string,
  resolved: ResolvedIngredients,
) {
  const created =
    resolved.newItems.size > 0
      ? await tx.inventoryItem.createManyAndReturn({
          data: [...resolved.newItems.values()].map((item) => ({
            householdId,
            name: item.name,
            category: item.category,
            unit: item.unit,
            quantity: 0,
            lowStockThreshold: 0,
          })),
          select: { id: true, name: true },
        })
      : [];
  const createdIdByKey = new Map(created.map((item) => [normalizeItemName(item.name), item.id]));

  // Every id here was checked against the household above or was just
  // created for it. A new item whose id somehow isn't in `created` has no
  // target at all: its alias and conversions are skipped rather than
  // written against nothing — an alias with a null item would mean "Don't
  // track", the opposite of what the user chose.
  const targetId = (target: IngredientItemTarget) =>
    "itemId" in target ? target.itemId : createdIdByKey.get(target.newItemKey);

  // An alias is replaced, not added to: the latest answer for a name wins.
  // One upsert each (INSERT … ON CONFLICT), so two saves teaching the same
  // name at once can't both insert and fail the whole recipe save on the
  // unique index; whichever commits last wins, as with any other edit.
  for (const [normalizedName, target] of resolved.aliases) {
    const inventoryItemId = target === null ? null : targetId(target);
    if (inventoryItemId === undefined) continue;
    await tx.itemAlias.upsert({
      where: { householdId_normalizedName: { householdId, normalizedName } },
      create: { householdId, normalizedName, inventoryItemId },
      update: { inventoryItemId },
    });
  }

  // MATCH-3 "Remember for this item", the same way: the latest factor for
  // an item and unit replaces the old one.
  for (const { fromUnit, factor, ...target } of resolved.conversions.values()) {
    const inventoryItemId = targetId(target);
    if (inventoryItemId === undefined) continue;
    await tx.itemUnitConversion.upsert({
      where: { inventoryItemId_fromUnit: { inventoryItemId, fromUnit } },
      create: { inventoryItemId, fromUnit, factor },
      update: { factor },
    });
  }

  return resolved.rows.map(({ newItemKey, inventoryItemId, ...row }) => ({
    ...row,
    inventoryItemId: newItemKey ? (createdIdByKey.get(newItemKey) ?? null) : inventoryItemId,
  }));
}

const previewRowsSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(MAX_INGREDIENT_NAME_LENGTH),
      unit: z.string().trim().max(MAX_INGREDIENT_UNIT_LENGTH),
      linkedItemId: z.string().max(MAX_ITEM_ID_LENGTH).nullish(),
      untracked: z.boolean().optional(),
    }),
  )
  .max(MAX_INGREDIENT_ROWS);

export type IngredientPreviewRow = z.input<typeof previewRowsSchema>[number];
export type IngredientPreviewItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  /** The item's saved unit conversions (MATCH-3), so the review can tell
   * whether a row's unit is covered after the user picks another item. */
  conversions: ItemUnitConversionLike[];
};
export type IngredientPreview = {
  matches: IngredientMatch[];
  /** The household's items, for each row's "Use existing" picker. */
  items: IngredientPreviewItem[];
  /** Distinct categories in use, for the "Create new" category field. */
  categories: string[];
  /** Per row: a guessed category for "Create new" (AUTO-2b), when the row
   * has no confident match. Null when nothing was guessed. */
  guessedCategories: (string | null)[];
};

// MATCH-1: the read-only first half of saving a recipe. RecipeFormDialog
// calls this when Save is pressed, and either saves straight away (every
// row confident, units reconciled) or shows the "Match ingredients" step
// built from the result. Writes nothing; the household comes from the
// session, and only the household's own items are ever matched against.
export async function previewIngredientMatchesAction(
  rows: IngredientPreviewRow[],
): Promise<IngredientPreview | { error: string }> {
  const { household } = await requireHousehold();

  const parsed = previewRowsSchema.safeParse(rows);
  if (!parsed.success) {
    if (Array.isArray(rows) && rows.length > MAX_INGREDIENT_ROWS) {
      const dict = await getDictionary();
      return { error: format(dict.mealPlanning.ingredientRowLimitError, { max: MAX_INGREDIENT_ROWS }) };
    }
    return await zodFail(parsed.error);
  }

  const [items, aliases] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        unitConversions: { select: { fromUnit: true, factor: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.itemAlias.findMany({
      where: { householdId: household.id },
      select: { normalizedName: true, inventoryItemId: true },
    }),
  ]);

  const previewItems: IngredientPreviewItem[] = items.map(({ unitConversions, ...item }) => ({
    ...item,
    conversions: unitConversions,
  }));
  const matches = matchIngredientRows(
    parsed.data.map((row) => ({
      name: row.name,
      unit: row.unit || "pcs",
      linkedItemId: row.linkedItemId,
      untracked: row.untracked,
    })),
    previewItems,
    aliases,
  );

  // Seeded with the items above, so guessing costs no extra query.
  const resolveCategory = createCategoryResolver(household.id, items);
  const guessedCategories = await Promise.all(
    matches.map((match, index) =>
      match.status === "confident" || match.untracked ? null : resolveCategory(ingredientBaseName(parsed.data[index].name)),
    ),
  );

  const categories = [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
  return { matches, items: previewItems, categories, guessedCategories };
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
    message: v("nutritionNegative"),
  });

// Same as above but rounded to a whole number, matching
// `caloriesPerServing Int?` in schema.prisma (a fractional calorie count
// would otherwise reject at the database layer).
const optionalNonNegativeInt = optionalNonNegativeNumber.transform((value) =>
  value === null ? null : Math.round(value),
);

const recipeSchema = z.object({
  name: z.string().trim().min(1, v("nameRequired")).max(120),
  instructions: z.string().trim().max(4000).optional(),
  servings: z.coerce.number().int().min(1, v("servingsMin")).max(1_000),
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
// Caps both the payload size and, since each unique candidate below runs
// its own wouldCreateCycle graph walk, the number of those walks a single
// request can trigger — a recipe realistically has a handful of sub-recipes.
const MAX_COMPONENT_ROWS = 50;

async function parseComponentRows(
  formData: FormData,
  householdId: string,
  parentRecipeId: string | undefined,
  dict: MealPlanningDict,
): Promise<{ data: ComponentRow[] } | { error: string }> {
  const ids = formData.getAll("componentRecipeId").map((v) => String(v).trim());
  const quantities = formData.getAll("componentQuantity").map((v) => String(v).trim());
  if (ids.length > MAX_COMPONENT_ROWS) {
    return { error: format(dict.componentRowLimitError, { max: MAX_COMPONENT_ROWS }) };
  }

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
    return await zodFail(parsed.error);
  }

  const ingredientRows = await parseIngredientRows(formData, dict.mealPlanning);
  if ("error" in ingredientRows) return { error: ingredientRows.error };

  const components = await parseComponentRows(formData, household.id, undefined, dict.mealPlanning);
  if ("error" in components) return { error: components.error };

  const ingredients = await resolveIngredientDecisions(ingredientRows.data, household.id, dict.mealPlanning);
  if ("error" in ingredients) return { error: ingredients.error };

  // One transaction for the new items and the recipe (MATCH-1), so a
  // failed recipe write never leaves orphaned items behind.
  await prisma.$transaction(async (tx) => {
    const ingredientData = await createIngredientItems(tx, household.id, ingredients);
    await tx.recipe.create({
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
        ingredients: { create: ingredientData },
        components: { create: components.data },
      },
    });
  });
  // The items are committed by now, so the background patch can't race
  // their creation. A no-op when no AI provider key is configured.
  if (ingredients.aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, ingredients.aiCandidates);

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
    return await zodFail(parsed.error);
  }

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, householdId: household.id },
  });
  if (!recipe) return await fail("recipeNotFound");

  const ingredientRows = await parseIngredientRows(formData, dict.mealPlanning);
  if ("error" in ingredientRows) return { error: ingredientRows.error };

  const components = await parseComponentRows(formData, household.id, recipe.id, dict.mealPlanning);
  if ("error" in components) return { error: components.error };

  // Rows are still deleted and recreated, but an already-linked row comes
  // back with its link as an explicit `existing` decision (the dialog
  // carries it through while the name is unchanged), so an edit no longer
  // re-links anything by name (MATCH-1).
  const ingredients = await resolveIngredientDecisions(ingredientRows.data, household.id, dict.mealPlanning);
  if ("error" in ingredients) return { error: ingredients.error };

  await prisma.$transaction(async (tx) => {
    const ingredientData = await createIngredientItems(tx, household.id, ingredients);
    await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    await tx.recipeComponent.deleteMany({ where: { parentRecipeId: recipe.id } });
    await tx.recipe.update({
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
        ingredients: { create: ingredientData },
        components: { create: components.data },
      },
    });
  });
  if (ingredients.aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, ingredients.aiCandidates);

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

// `note` and `rawText` are optional so this stays assignable from the
// parser's ParsedIngredient before and after MATCH-4 adds them (MATCH-2).
export type ImportedRecipeIngredient = {
  name: string;
  quantity: number;
  unit: string;
  note?: string;
  rawText?: string;
};
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
// createRecipeAction/updateRecipeAction. requireHousehold() confirms the
// caller is an authenticated member of a household (this action doesn't
// read/write anything household-scoped) and gives the household id the
// rate limit below is keyed on, matching the rule that every action in
// this feature re-derives its caller from the session rather than trusting
// the client. See src/lib/recipe-import.ts for the SSRF/DNS-rebinding-
// guarding fetch and the JSON-LD → Microdata → heading-heuristic parsing.
export async function importRecipeFromUrlAction(
  _prevState: ImportRecipeState,
  formData: FormData,
): Promise<ImportRecipeState> {
  const { household } = await requireHousehold();
  const dict = await getDictionary();

  // SEC-2: this action makes our server fetch whatever URL is pasted in, so
  // without a limit a household could be used to hammer an arbitrary host
  // (or repeatedly probe internal addresses past the SSRF guard) through
  // us. Keyed per household, not per user, like the other server-side-fetch
  // actions in this codebase (receipt-scan.ts, inventory-scan.ts).
  if (
    !(await checkRateLimit(
      `recipe-import:${household.id}`,
      RECIPE_IMPORT_RATE_LIMIT,
      RECIPE_IMPORT_RATE_LIMIT_WINDOW_MS,
    ))
  ) {
    return { error: dict.mealPlanning.importErrorRateLimited };
  }

  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: dict.mealPlanning.importErrorInvalidUrl };

  const fetched = await fetchRecipeHtml(url);
  if (!fetched.ok) return { error: importErrorMessage(fetched.error, dict.mealPlanning) };

  const recipe = parseRecipeFromHtml(fetched.html);
  if (!recipe) return { error: dict.mealPlanning.importErrorNoRecipeFound };

  return { recipe };
}
