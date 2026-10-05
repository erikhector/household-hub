"use client";

import { useActionState, useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, Link2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/inventory/combo-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createRecipeAction,
  importRecipeFromUrlAction,
  previewIngredientMatchesAction,
  updateRecipeAction,
  type ImportRecipeState,
  type IngredientPreview,
} from "@/app/dashboard/meal-planning/recipe-actions";
import {
  IngredientReviewStep,
  reviewRowError,
  UNIT_CHOICE_RESET,
  type ReviewRow,
  type ReviewState,
} from "@/components/meal-planning/ingredient-review-step";
import type { RecipeData } from "@/components/meal-planning/types";
import { rowUnitChoice } from "@/lib/recipes/unit-choice";
import {
  defaultNewItemUnit,
  ingredientBaseName,
  ingredientNeedsReview,
} from "@/lib/recipes/ingredient-match";
import { format, plural } from "@/lib/i18n/format";
import { RECIPE_TAGS, type RecipeTag } from "@/lib/recipe-tags";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};
// Same caps as recipe-actions.ts's ingredient rawText/note (MATCH-2).
const MAX_RAW_TEXT_LENGTH = 300;
const MAX_NOTE_LENGTH = 200;
const initialImportState: ImportRecipeState = {};

// `unitTouched` tracks whether the user has explicitly set the unit for a
// row, so picking an ingredient name can preselect its usual unit (from
// ingredientUnits) without ever overwriting a unit the user chose on
// purpose. Rows that already carry a real unit (loaded from a saved recipe
// or a URL import) start touched — flipping the name there swaps out the
// ingredient, not its already-deliberate unit.
//
// `linkedItemId`/`linkedName` (MATCH-1): the item a saved row is linked to
// and the name it had when the dialog opened. The link is carried to the
// matcher only while the name is still that name, so editing a recipe
// never re-matches a row the user didn't touch, and renaming one does.
// `untracked` (MATCH-2) is carried the same way for a "Don't track" row.
//
// `rawText`/`note` (MATCH-2): an imported row's original line and its prep
// note, saved with the row. The note is shown under the row; the original
// line is dropped once the row is edited, since it no longer describes it.
type IngredientRow = {
  uid: string;
  name: string;
  quantity: string;
  unit: string;
  unitTouched: boolean;
  linkedItemId: string | null;
  untracked: boolean;
  linkedName: string;
  rawText: string;
  note: string;
};

function blankRow(): IngredientRow {
  return {
    uid: crypto.randomUUID(),
    name: "",
    quantity: "1",
    unit: "pcs",
    unitTouched: false,
    linkedItemId: null,
    untracked: false,
    linkedName: "",
    rawText: "",
    note: "",
  };
}

function rowsFromRecipe(recipe: RecipeData | undefined): IngredientRow[] {
  if (!recipe || recipe.ingredients.length === 0) return [blankRow()];
  return recipe.ingredients.map((ingredient) => ({
    uid: ingredient.id,
    name: ingredient.name,
    quantity: String(ingredient.quantity),
    unit: ingredient.unit,
    unitTouched: true,
    linkedItemId: ingredient.inventoryItemId,
    untracked: ingredient.untracked,
    linkedName: ingredient.name,
    rawText: ingredient.rawText ?? "",
    note: ingredient.note ?? "",
  }));
}

const nameUnchanged = (row: IngredientRow) => row.name.trim() === row.linkedName.trim();

function currentLink(row: IngredientRow): string | null {
  return row.linkedItemId && nameUnchanged(row) ? row.linkedItemId : null;
}

// Turns a preview into the review step's rows. A row the user already
// decided on in an earlier pass (they went Back and pressed Save again)
// keeps that decision as long as its name and unit are unchanged.
function buildReview(
  rows: IngredientRow[],
  preview: IngredientPreview,
  previous: ReviewState | null,
): ReviewState {
  const reviewRows = rows.map((row, index): ReviewRow => {
    const name = row.name.trim();
    const unit = row.unit.trim() || "pcs";
    const label = [row.quantity.trim(), unit, name].filter(Boolean).join(" ");
    const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : 1;
    const earlier = previous?.rows.find((r) => r.uid === row.uid && r.name === name && r.unit === unit);
    // The quantity may have changed while the decision still stands.
    if (earlier) return { ...earlier, label, quantity };
    const match = preview.matches[index];
    const newName = ingredientBaseName(name);
    return {
      uid: row.uid,
      label,
      name,
      quantity,
      unit,
      status: match.status,
      needsReview: ingredientNeedsReview(match),
      defaultUntracked: match.untracked,
      mode: match.untracked ? "untracked" : match.itemId ? "existing" : "new",
      selectedId: match.itemId ?? "",
      candidateIds: match.candidateIds,
      newName,
      newCategory: preview.guessedCategories[index] ?? "",
      newUnit: defaultNewItemUnit(unit),
      newUnitTouched: false,
      ...UNIT_CHOICE_RESET,
    };
  });
  return { rows: reviewRows, items: preview.items, categories: preview.categories };
}

// The per-row decision fields the save action reads, appended in the same
// order as the ingredient inputs already in the form (blank rows included,
// so the parallel arrays line up).
function appendDecisions(formData: FormData, rows: IngredientRow[], review: ReviewState | null) {
  for (const row of rows) {
    formData.append("ingredientRawText", row.rawText);
    formData.append("ingredientNote", row.note);
    const decided = review?.rows.find((r) => r.uid === row.uid);
    const isNew = decided?.mode === "new";
    formData.append("ingredientDecision", decided ? decided.mode : "");
    formData.append("ingredientItemId", decided?.mode === "existing" ? decided.selectedId : "");
    formData.append("ingredientNewName", isNew ? decided.newName.trim() : "");
    formData.append("ingredientNewCategory", isNew ? decided.newCategory.trim() : "");
    formData.append("ingredientNewUnit", isNew ? decided.newUnit.trim() : "");
    // MATCH-3: what to do about a unit the item can't convert.
    const choice = decided && review && decided.mode !== "untracked" ? rowUnitChoice(decided, review.items) : null;
    formData.append("ingredientUnitAction", choice?.action ?? "");
    formData.append("ingredientUnitFactor", choice?.action === "remember" ? String(choice.factor ?? "") : "");
    formData.append(
      "ingredientOverrideQuantity",
      choice?.action === "override" ? String(choice.overrideQuantity ?? "") : "",
    );
  }
}

type ComponentRow = { uid: string; componentRecipeId: string; quantity: string };

function componentRowsFromRecipe(recipe: RecipeData | undefined): ComponentRow[] {
  if (!recipe) return [];
  return recipe.components.map((component) => ({
    uid: component.id,
    componentRecipeId: component.componentRecipeId,
    quantity: String(component.quantity),
  }));
}

export function RecipeFormDialog({
  dict,
  mode,
  recipe,
  allRecipes,
  ingredientNames,
  ingredientUnits,
  trigger,
  startAtReview = false,
}: {
  dict: MealPlanningDict;
  mode: "create" | "edit";
  recipe?: RecipeData;
  allRecipes: RecipeData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
  trigger: ReactElement;
  /** "Review ingredient matches" (MATCH-5): open an existing recipe
   * straight at step 2, with every row's current link as its decision. */
  startAtReview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 4));
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() => rowsFromRecipe(recipe));
  const [components, setComponents] = useState<ComponentRow[]>(() => componentRowsFromRecipe(recipe));
  // GAP-29: a Set for the toggle logic; rendered in RECIPE_TAGS order below
  // regardless of click order, and posted as one hidden `tags` input each.
  const [tags, setTags] = useState<Set<RecipeTag>>(() => new Set(recipe?.tags ?? []));
  const toggleTag = (tag: RecipeTag) =>
    setTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  const [importUrl, setImportUrl] = useState("");
  const hasNutrition = (r: RecipeData | undefined) =>
    r != null &&
    (r.caloriesPerServing != null ||
      r.proteinGramsPerServing != null ||
      r.carbsGramsPerServing != null ||
      r.fatGramsPerServing != null);
  const [showNutrition, setShowNutrition] = useState(() => hasNutrition(recipe));
  const [caloriesPerServing, setCaloriesPerServing] = useState(
    recipe?.caloriesPerServing != null ? String(recipe.caloriesPerServing) : "",
  );
  const [proteinGramsPerServing, setProteinGramsPerServing] = useState(
    recipe?.proteinGramsPerServing != null ? String(recipe.proteinGramsPerServing) : "",
  );
  const [carbsGramsPerServing, setCarbsGramsPerServing] = useState(
    recipe?.carbsGramsPerServing != null ? String(recipe.carbsGramsPerServing) : "",
  );
  const [fatGramsPerServing, setFatGramsPerServing] = useState(
    recipe?.fatGramsPerServing != null ? String(recipe.fatGramsPerServing) : "",
  );

  // Every other household recipe can be added as a sub-recipe — a brand-new
  // recipe (no `recipe.id` yet) can't be anyone's own descendant, so nothing
  // needs excluding beyond itself in edit mode. The server re-validates for
  // real (see wouldCreateCycle in actions.ts); this only drives the picker.
  const componentCandidates = allRecipes.filter((candidate) => candidate.id !== recipe?.id);

  // MATCH-1: Save first previews the ingredient matches, and only shows
  // step 2 ("Match ingredients") when some row isn't confident.
  const [step, setStep] = useState<"recipe" | "review">("recipe");
  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const updateReviewRow = (uid: string, patch: Partial<ReviewRow>) =>
    setReview((current) =>
      current && { ...current, rows: current.rows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)) },
    );
  const resetReview = () => {
    setStep("recipe");
    setReview(null);
    setReviewAttempted(false);
  };

  // Keyboard and screen-reader users get told when the dialog changes under
  // them: a step change scrolls the form back to the top and focuses the
  // new title, and a blocked Save focuses the first row that needs a choice.
  // Requested from the action (or a click), and carried out once React has
  // rendered the result. `id` makes a repeated request for the same target
  // run again. A server error is focused from the action's result instead
  // (below): it only renders once the action has returned, so a request
  // made inside the action ran before the error existed.
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: "title" | "invalid"; id: number } | null>(null);
  const requestFocus = (target: "title" | "invalid") =>
    setFocusRequest((current) => ({ target, id: (current?.id ?? 0) + 1 }));
  const goBack = () => {
    setStep("recipe");
    requestFocus("title");
  };
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.target === "title") {
      formRef.current?.scrollTo({ top: 0 });
      titleRef.current?.focus();
      return;
    }
    const target = formRef.current?.querySelector<HTMLElement>('input[aria-invalid="true"]');
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  }, [focusRequest]);

  // True only while the read-only preview runs, so the button says
  // "Checking ingredients…" then, and "Saving…" during the save itself.
  const [checking, setChecking] = useState(false);

  const action = mode === "create" ? createRecipeAction : updateRecipeAction;
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    // useActionState always runs the action from the latest committed
    // render, so `step`, `review` and `ingredients` here are current.
    const rows = ingredients;
    const filledRows = rows.filter((row) => row.name.trim());
    let decided = review;
    if (step === "recipe") {
      setChecking(true);
      const preview = await previewIngredientMatchesAction(
        filledRows.map((row) => ({
          name: row.name.trim(),
          unit: row.unit.trim(),
          linkedItemId: currentLink(row),
          untracked: row.untracked && nameUnchanged(row),
        })),
      );
      setChecking(false);
      if ("error" in preview) return { error: preview.error };
      decided = buildReview(filledRows, preview, review);
      if (decided.rows.some((row) => row.needsReview)) {
        setReview(decided);
        setReviewAttempted(false);
        setStep("review");
        requestFocus("title");
        return {};
      }
    } else if (review?.rows.some((row) => reviewRowError(row, review.items, dict.ingredientReview))) {
      setReviewAttempted(true);
      requestFocus("invalid");
      return {};
    }
    appendDecisions(formData, rows, decided);

    const result = await action(prevState, formData);
    if (!result.error) {
      // Rows the save can actually link: a chosen item, or a new item with
      // a name (the server leaves anything else unlinked).
      const linked =
        decided?.rows.filter((row) =>
          row.mode === "existing" ? row.selectedId : row.mode === "new" ? row.newName.trim() : false,
        ).length ?? 0;
      if (linked > 0) {
        toast.success(format(plural(linked, dict.ingredientReview.savedLinked), { count: linked }));
      }
      setOpen(false);
      resetReview();
      if (mode === "create") {
        setName("");
        setServings("4");
        setInstructions("");
        setIngredients([blankRow()]);
        setComponents([]);
        setTags(new Set());
        setImportUrl("");
        setShowNutrition(false);
        setCaloriesPerServing("");
        setProteinGramsPerServing("");
        setCarbsGramsPerServing("");
        setFatGramsPerServing("");
      }
    }
    return result;
  }, initialState);

  useEffect(() => {
    if (!state.error) return;
    errorRef.current?.scrollIntoView({ block: "center" });
    errorRef.current?.focus();
  }, [state]);

  // Pre-fills the manual fields from a successful import, for the user to
  // review/edit before saving — never auto-saves. Mirrors the main form's
  // action wrapper above: state updates happen right after the action
  // resolves, not in a useEffect (which would set state synchronously
  // during a render pass).
  const [importState, importFormAction, importPending] = useActionState(async (
    prevState: ImportRecipeState,
    formData: FormData,
  ) => {
    const result = await importRecipeFromUrlAction(prevState, formData);
    if (result.recipe) {
      if (result.recipe.name) setName(result.recipe.name);
      if (result.recipe.instructions) setInstructions(result.recipe.instructions);
      if (result.recipe.ingredients.length > 0) {
        setIngredients(
          // The parser splits the prep note off the name (MATCH-4) and
          // hands it over as `note`, which the row keeps as its own field.
          result.recipe.ingredients.map((ingredient) => ({
            uid: crypto.randomUUID(),
            name: ingredient.name,
            quantity: String(ingredient.quantity),
            unit: ingredient.unit,
            unitTouched: true,
            linkedItemId: null,
            untracked: false,
            linkedName: "",
            // Clamped to the save action's caps, so an unusually long
            // imported line can't make the whole save fail.
            rawText: (ingredient.rawText ?? "").slice(0, MAX_RAW_TEXT_LENGTH),
            note: (ingredient.note ?? "").slice(0, MAX_NOTE_LENGTH),
          })),
        );
      }
      // Only ever adds: a page's own diet claim (GAP-29) pre-ticks chips
      // for review, but never un-ticks one the user already chose.
      if (result.recipe.tags.length > 0) {
        const imported = result.recipe.tags;
        setTags((current) => new Set([...current, ...imported]));
      }
    }
    return result;
  }, initialImportState);

  // MATCH-5: "Review ingredient matches" runs the same read-only preview
  // Save does, over the rows as saved. A linked row is sent with its link
  // and a Don't-track row as untracked, so the matcher keeps both exactly
  // as they are (source "linked") and only a row with no link at all (its
  // item was deleted) is matched afresh. Saving then goes through the
  // normal save with these decisions, so a moved link is saved and learned
  // as in any edit, and an untouched row is saved as it was. `loadId`
  // drops a preview that returns after the dialog was closed or reopened.
  const loadId = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const openAtReview = async (rows: IngredientRow[]) => {
    const id = ++loadId.current;
    const filledRows = rows.filter((row) => row.name.trim());
    setStep("review");
    setLoadError(null);
    const preview = await previewIngredientMatchesAction(
      filledRows.map((row) => ({
        name: row.name.trim(),
        unit: row.unit.trim(),
        linkedItemId: row.linkedItemId,
        untracked: row.untracked,
      })),
    );
    if (id !== loadId.current) return;
    if ("error" in preview) {
      setLoadError(preview.error);
      return;
    }
    setReview(buildReview(filledRows, preview, null));
    requestFocus("title");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    loadId.current++;
    if (next) {
      resetReview();
      setName(recipe?.name ?? "");
      setServings(String(recipe?.servings ?? 4));
      setInstructions(recipe?.instructions ?? "");
      setIngredients(rowsFromRecipe(recipe));
      setComponents(componentRowsFromRecipe(recipe));
      setTags(new Set(recipe?.tags ?? []));
      setImportUrl("");
      setShowNutrition(hasNutrition(recipe));
      setCaloriesPerServing(recipe?.caloriesPerServing != null ? String(recipe.caloriesPerServing) : "");
      setProteinGramsPerServing(
        recipe?.proteinGramsPerServing != null ? String(recipe.proteinGramsPerServing) : "",
      );
      setCarbsGramsPerServing(
        recipe?.carbsGramsPerServing != null ? String(recipe.carbsGramsPerServing) : "",
      );
      setFatGramsPerServing(recipe?.fatGramsPerServing != null ? String(recipe.fatGramsPerServing) : "");
      if (startAtReview && recipe) void openAtReview(rowsFromRecipe(recipe));
    }
  };

  const addRow = () => setIngredients((rows) => [...rows, blankRow()]);
  const removeRow = (uid: string) =>
    setIngredients((rows) => (rows.length > 1 ? rows.filter((r) => r.uid !== uid) : rows));
  const updateRow = (uid: string, field: "name" | "quantity" | "unit", value: string) =>
    setIngredients((rows) =>
      rows.map((row) => {
        if (row.uid !== uid) return row;
        const r = { ...row, rawText: "" };
        if (field === "unit") return { ...r, unit: value, unitTouched: true };
        if (field === "name") {
          const matchedUnit = ingredientUnits[value.trim().toLowerCase()];
          if (!r.unitTouched && matchedUnit) return { ...r, name: value, unit: matchedUnit };
          return { ...r, name: value };
        }
        return { ...r, [field]: value };
      }),
    );

  // A fresh row always starts pointed at a real, not-yet-used recipe (never
  // an empty selection) — addComponentRow is a no-op once every candidate is
  // already in use, and the "Add sub-recipe" button is disabled to match.
  const usedComponentIds = new Set(components.map((c) => c.componentRecipeId));
  const hasAvailableComponentRecipe = componentCandidates.some((c) => !usedComponentIds.has(c.id));
  const addComponentRow = () => {
    const next = componentCandidates.find((c) => !usedComponentIds.has(c.id));
    if (!next) return;
    setComponents((rows) => [...rows, { uid: crypto.randomUUID(), componentRecipeId: next.id, quantity: "1" }]);
  };
  const removeComponentRow = (uid: string) =>
    setComponents((rows) => rows.filter((r) => r.uid !== uid));
  const updateComponentRow = (uid: string, field: "componentRecipeId" | "quantity", value: string) =>
    setComponents((rows) => rows.map((r) => (r.uid === uid ? { ...r, [field]: value } : r)));
  const optionsForComponentRow = (row: ComponentRow) =>
    componentCandidates.filter(
      (c) => c.id === row.componentRecipeId || !components.some((other) => other.uid !== row.uid && other.componentRecipeId === c.id),
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="sm:max-w-md"
        initialFocus={(interactionType) =>
          interactionType === "touch" ? null : nameInputRef.current
        }
      >
        <DialogHeader>
          {step === "review" ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={dict.ingredientReview.back}
                onClick={goBack}
                disabled={pending}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
                {dict.ingredientReview.title}
              </DialogTitle>
            </div>
          ) : (
            <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
              {mode === "create" ? dict.newRecipeDialogTitle : dict.editRecipeDialogTitle}
            </DialogTitle>
          )}
        </DialogHeader>
        {/* A sibling form, not nested inside the create/edit form below (HTML
            forms can't nest) — importing just populates the manual fields'
            state for review, it never saves anything itself. */}
        <form
          action={importFormAction}
          hidden={step === "review"}
          className="flex flex-col gap-2 rounded-md border border-dashed p-3"
        >
          <Label htmlFor="recipe-import-url">{dict.importUrlLabel}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="recipe-import-url"
              name="url"
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder={dict.importUrlPlaceholder}
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="outline" disabled={importPending || !importUrl.trim()}>
              <Link2 className="size-3.5" />
              {importPending ? dict.importing : dict.importButton}
            </Button>
          </div>
          {importState.error && <p className="text-sm text-destructive">{importState.error}</p>}
          {/* Only a JSON-LD import is the site's own structured data; the
              Microdata and heading-heuristic fallbacks (GAP-31) are guesses,
              so they get a louder, explicit "review before saving" notice
              instead of the plain success line. */}
          {!importState.error && importState.recipe && importState.recipe.source === "jsonld" && (
            <p className="text-sm text-success">{dict.importSuccess}</p>
          )}
          {!importState.error && importState.recipe && importState.recipe.source !== "jsonld" && (
            <p
              role="status"
              className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 p-2 text-sm text-warning"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {dict.importLowConfidence}
            </p>
          )}
        </form>

        {/* Not its own scroll container: DialogContent already scrolls, and
            a second scroller nested inside it (with the import form above
            pushing it past the sheet's height) left iOS Safari stuck — a
            swipe on the form never hands over to the sheet, so the bottom
            of the form and the save button couldn't be reached. */}
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          {mode === "edit" && recipe && (
            <input type="hidden" name="recipeId" value={recipe.id} />
          )}

          {step === "review" && review && (
            <IngredientReviewStep
              review={review}
              dict={dict}
              attempted={reviewAttempted}
              onRowChange={updateReviewRow}
              expandMatched={startAtReview}
            />
          )}
          {step === "review" && !review && (
            <p role={loadError ? "alert" : "status"} className={loadError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {loadError ?? dict.ingredientReview.checking}
            </p>
          )}

          {/* Step 1 stays mounted (only hidden) while step 2 shows, so its
              fields are still part of the form that Save submits. */}
          <div hidden={step === "review"} className="flex flex-col gap-4">

          <div className="flex gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor="recipe-name">{dict.recipeNameLabel}</Label>
              <Input
                ref={nameInputRef}
                id="recipe-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="flex w-24 shrink-0 flex-col gap-2">
              <Label htmlFor="recipe-servings">{dict.servingsLabel}</Label>
              <Input
                id="recipe-servings"
                name="servings"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                step={1}
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                required
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{dict.servingsHint}</p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="recipe-instructions">{dict.instructionsLabel}</Label>
            <Textarea
              id="recipe-instructions"
              name="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={dict.instructionsPlaceholder}
              maxLength={4000}
              rows={4}
            />
          </div>

          {/* GAP-29: toggle chips (same look as the starter pickers) rather
              than checkboxes — the set is small enough to show whole. The
              hidden inputs are what's actually posted; the server re-parses
              them against RECIPE_TAGS, so these buttons are just UI. */}
          <div className="flex flex-col gap-2">
            <Label id="recipe-tags-label">{dict.recipeTagsLabel}</Label>
            <div role="group" aria-labelledby="recipe-tags-label" className="flex flex-wrap gap-1.5">
              {RECIPE_TAGS.map((tag) => {
                const isSelected = tags.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    {dict.recipeTags[tag]}
                  </button>
                );
              })}
            </div>
            {RECIPE_TAGS.filter((tag) => tags.has(tag)).map((tag) => (
              <input key={tag} type="hidden" name="tags" value={tag} />
            ))}
            <p className="text-xs text-muted-foreground">{dict.recipeTagsHint}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>{dict.ingredientsLabel}</Label>
              <Button type="button" variant="outline" size="xs" onClick={addRow}>
                <Plus className="size-3" />
                {dict.addIngredient}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {ingredients.map((row) => (
                <div key={row.uid} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <ComboField
                        id={`ingredient-name-${row.uid}`}
                        name="ingredientName"
                        items={ingredientNames}
                        value={row.name}
                        onValueChange={(value) => updateRow(row.uid, "name", value)}
                        placeholder={dict.ingredientNamePlaceholder}
                        maxLength={120}
                        dict={dict}
                      />
                    </div>
                    <Input
                      name="ingredientQuantity"
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      max={1000000}
                      step="any"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.uid, "quantity", e.target.value)}
                      placeholder={dict.ingredientQuantityPlaceholder}
                      className="w-16 shrink-0"
                    />
                    <Input
                      name="ingredientUnit"
                      value={row.unit}
                      onChange={(e) => updateRow(row.uid, "unit", e.target.value)}
                      placeholder={dict.ingredientUnitPlaceholder}
                      maxLength={20}
                      className="w-16 shrink-0"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={dict.removeIngredientAriaLabel}
                      onClick={() => removeRow(row.uid)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  {row.note && <p className="px-1 text-xs break-words text-muted-foreground">{row.note}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>{dict.componentsLabel}</Label>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={addComponentRow}
                disabled={!hasAvailableComponentRecipe}
              >
                <Plus className="size-3" />
                {dict.addComponent}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{dict.componentsHint}</p>
            {components.length === 0 && !hasAvailableComponentRecipe && (
              <p className="text-sm text-muted-foreground">{dict.noAvailableComponentRecipes}</p>
            )}
            <div className="flex flex-col gap-2">
              {components.map((row) => {
                const options = optionsForComponentRow(row);
                return (
                  <div key={row.uid} className="flex items-center gap-1.5">
                    <Select
                      value={row.componentRecipeId}
                      onValueChange={(v) => updateComponentRow(row.uid, "componentRecipeId", String(v))}
                    >
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue>
                          {(v: string) => options.find((o) => o.id === v)?.name ?? v}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input type="hidden" name="componentRecipeId" value={row.componentRecipeId} />
                    <Input
                      name="componentQuantity"
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      max={1000}
                      step="any"
                      value={row.quantity}
                      onChange={(e) => updateComponentRow(row.uid, "quantity", e.target.value)}
                      placeholder={dict.componentQuantityPlaceholder}
                      className="w-20 shrink-0"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={dict.removeComponentAriaLabel}
                      onClick={() => removeComponentRow(row.uid)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {!showNutrition ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="self-start"
                onClick={() => setShowNutrition(true)}
              >
                <Plus className="size-3" />
                {dict.addNutritionInfo}
              </Button>
            ) : (
              <>
                <Label>{dict.nutritionSectionLabel}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="recipe-calories" className="text-xs font-normal text-muted-foreground">
                      {dict.caloriesPerServingLabel}
                    </Label>
                    <Input
                      id="recipe-calories"
                      name="caloriesPerServing"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={caloriesPerServing}
                      onChange={(e) => setCaloriesPerServing(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="recipe-protein" className="text-xs font-normal text-muted-foreground">
                      {dict.proteinGramsPerServingLabel}
                    </Label>
                    <Input
                      id="recipe-protein"
                      name="proteinGramsPerServing"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={proteinGramsPerServing}
                      onChange={(e) => setProteinGramsPerServing(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="recipe-carbs" className="text-xs font-normal text-muted-foreground">
                      {dict.carbsGramsPerServingLabel}
                    </Label>
                    <Input
                      id="recipe-carbs"
                      name="carbsGramsPerServing"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={carbsGramsPerServing}
                      onChange={(e) => setCarbsGramsPerServing(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="recipe-fat" className="text-xs font-normal text-muted-foreground">
                      {dict.fatGramsPerServingLabel}
                    </Label>
                    <Input
                      id="recipe-fat"
                      name="fatGramsPerServing"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={fatGramsPerServing}
                      onChange={(e) => setFatGramsPerServing(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          </div>

          {state.error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive outline-none">
              {state.error}
            </p>
          )}
          <DialogFooter>
            {step === "review" && (
              <Button type="button" variant="outline" onClick={goBack} disabled={pending}>
                {dict.ingredientReview.back}
              </Button>
            )}
            {/* Nothing to save until the review has loaded: without its
                decisions the save would treat every row as undecided. */}
            <Button type="submit" disabled={pending || (step === "review" && !review)}>
              {pending
                ? checking
                  ? dict.ingredientReview.checking
                  : mode === "create"
                    ? dict.creating
                    : dict.saving
                : step === "recipe" && review?.rows.some((row) => row.needsReview)
                  ? dict.ingredientReview.next
                  : mode === "create"
                    ? dict.create
                    : dict.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
