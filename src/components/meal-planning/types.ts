import type { MealType } from "@/app/dashboard/meal-planning/meal-types";
import type { RecipeTag } from "@/lib/recipe-tags";
import type { PickFreshness, Weekday } from "@/lib/week-picks-spread";

export type RecipeIngredientData = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  // The linked InventoryItem, carried through RecipeFormDialog so an edit
  // keeps the link instead of re-matching by name (MATCH-1). Null when the
  // row isn't linked (never matched, or its item was deleted).
  inventoryItemId: string | null;
  // MATCH-2: "Don't track" on purpose (carried through an edit like the
  // link), the imported line, and the prep note shown after the name.
  untracked: boolean;
  rawText: string | null;
  note: string | null;
};

// A sub-recipe this recipe includes (e.g. a lasagna's bolognese +
// béchamel) — see RecipeComponent in schema.prisma.
export type RecipeComponentData = {
  id: string;
  componentRecipeId: string;
  componentRecipeName: string;
  quantity: number;
};

export type RecipeData = {
  id: string;
  name: string;
  instructions: string | null;
  // How many portions the ingredient amounts above make — see Recipe.servings'
  // doc comment in schema.prisma. Used to scale ingredient totals down to
  // however many portions a given meal-plan entry (MealPlanEntryData.portions
  // below) is actually cooking.
  servings: number;
  // Optional, manual-entry-only per-serving nutrition info — see Recipe's
  // doc comment in schema.prisma. Null means "not entered."
  caloriesPerServing: number | null;
  proteinGramsPerServing: number | null;
  carbsGramsPerServing: number | null;
  fatGramsPerServing: number | null;
  // Recipe.isFavorite (GAP-18) — the star on each RecipeManager row. Only a
  // ranking tiebreaker elsewhere, never a filter.
  isFavorite: boolean;
  // Recipe.cookSoonAt (GAP-51) as an ISO string: set while the recipe is on
  // the Recipes tab's "Cook soon" shelf, null otherwise.
  cookSoonAt: string | null;
  // Recipe.tags (GAP-29), already run through parseRecipeTags in page.tsx
  // so only known keys in canonical order ever reach the client.
  tags: RecipeTag[];
  ingredients: RecipeIngredientData[];
  components: RecipeComponentData[];
};

export type MealPlanEntryData = {
  id: string;
  date: string; // yyyy-mm-dd
  mealType: MealType;
  recipeId: string | null;
  recipeName: string | null;
  freeformName: string | null;
  // How many portions of the linked recipe this slot is for — see
  // MealPlanEntry.portions' doc comment in schema.prisma. Meaningless when
  // recipeId is null (a freeform entry has no recipe to scale).
  portions: number;
  // ISO timestamp once inventory has been decremented for this entry (see
  // MealPlanEntry.consumedAt's doc comment in schema.prisma), else null.
  consumedAt: string | null;
  // GAP-49: the PreparedBatch this slot eats from, or null when it's cooked
  // fresh (MealPlanEntry.preparedBatchId).
  preparedBatchId: string | null;
};

// A week pick in the planner's tray (MealPlanPick, see loadWeekPicks in
// week-picks.ts): a meal chosen for the week, not on a day yet.
export type WeekPickData = {
  id: string;
  recipeId: string | null;
  // The recipe's name, or the custom meal's.
  name: string;
  // Meaningless when recipeId is null, as on MealPlanEntryData.
  portions: number;
  // Moved over from a week that ended with it unplaced ("From last week"):
  // that week's Monday as `yyyy-mm-dd`, or null.
  carriedFromWeek: string | null;
  // Who picked it (a user id), handed back on a place's Undo so the pick
  // returns as it was. Null when unknown.
  createdByUserId: string | null;
  // Another member's display name when they picked it ("Picked by Anna");
  // null when it was the viewer, or unknown.
  pickedBy: string | null;
  // Spread over the week's two signals (week-picks-spread.ts).
  habitWeekday: Weekday | null;
  freshness: PickFreshness | null;
};

// One ingredient the planned week's recipes need more of than the household
// currently has on hand — see previewMissingIngredientsAction.
export type MissingIngredientData = {
  key: string;
  name: string;
  unit: string;
  missingQuantity: number;
  // True when the household does have this ingredient on hand, but in a unit
  // that can't be reconciled with the recipe's required unit (unrecognized,
  // or a different dimension, e.g. grams vs. cups) — so the on-hand quantity
  // couldn't be subtracted and the full required amount is reported missing,
  // same as if there were none on hand at all. Mirrors
  // CookedIngredientData.unitMismatch (Mark Cooked's identical case) so the
  // review dialog can surface it instead of silently treating it as fully
  // missing. See D5 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.
  unitMismatch: boolean;
  // GAP-62: the first recipe ingredient note for this row ("unsalted"), sent
  // along to the shopping list row's own note. Null when none of the recipes
  // that need it has one.
  note: string | null;
  // Week picks: set when only picks (meals not on a day yet) need this
  // row, so the review dialog can list it under "Not on a day yet". Absent
  // when any placed meal needs it too.
  fromPicksOnly?: true;
};

// An ACTIVE shopping list the "add missing ingredients" dialog can add to.
export type ActiveShoppingListOption = {
  id: string;
  name: string;
};

// A recipe the household is close to having everything for (missing at most
// a couple of ingredients, see MAX_MISSING_TO_SURFACE in
// cookable-recipes.ts), for the "Cook now" tab.
export type CookableRecipeData = {
  recipeId: string;
  recipeName: string;
  missingIngredientNames: string[];
};

// One "use it up" match backing a suggestion chip — see
// computeUseItUpSuggestions (src/lib/inventory/use-it-up-calc.ts).
export type UseItUpMatchData = {
  name: string;
  reason: "expiring" | "lowStock";
};

// A recipe that uses at least one ingredient that's expiring soon or
// low/out of stock — a dismissible nudge on the Recipes tab, distinct from
// CookableRecipeData above (this ranks by overlap with what's about to go to
// waste, not by "almost everything on hand").
export type UseItUpSuggestionData = {
  recipeId: string;
  recipeName: string;
  matches: UseItUpMatchData[];
};

// One inventory item a "mark as cooked" confirmation can decrement — see
// previewCookedIngredientsAction and computeCookedIngredients.
export type CookedIngredientData = {
  key: string;
  inventoryItemId: string;
  name: string;
  unit: string;
  onHandQuantity: number;
  suggestedQuantity: number;
  requiredQuantity: number;
  requiredUnit: string;
  unitMismatch: boolean;
};

// GAP-49: one active PreparedBatch on the Prep tab — see getActiveBatches
// (src/app/dashboard/meal-planning/prepared-batches.ts). Dates are ISO
// instants; plannedCount is every uneaten meal-plan entry linked to the batch.
export type PreparedBatchData = {
  id: string;
  recipeId: string;
  recipeName: string;
  totalPortions: number;
  remainingPortions: number;
  cookedAt: string;
  expiryDate: string | null;
  cookedByName: string | null;
  plannedCount: number;
};

// GAP-52: a saved week template as the planner picker lists it.
export type PlanTemplateSummary = { id: string; name: string; entryCount: number };
