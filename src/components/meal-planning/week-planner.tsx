"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, BookmarkPlus, CalendarPlus, ChefHat, CheckCircle2, ChevronRight, Copy, CookingPot, LayoutTemplate, ListChecks, ListPlus, Loader2, MoreHorizontal, Pencil, Plus, Trash2, Unlink, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUndoableDelete } from "@/components/shared/use-undoable-delete";
import { createDeferredDelete, type DeferredDelete } from "@/components/shared/deferred-delete";
import { Checkbox } from "@/components/ui/checkbox";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogHandle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PeriodSwitcher } from "@/components/period-switcher";
import { PrimaryAction } from "@/components/dashboard/primary-action";
import { LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import {
  loadAddToPlanDialog,
  loadCookModeDialog,
  loadFillEmptyDaysDialog,
  loadSaveWeekTemplateDialog,
  loadPlanFromTemplateDialog,
  loadMarkCookedDialog,
  loadMealEntryDialog,
  loadMissingIngredientsDialog,
  loadMoveMealDialog,
} from "@/components/meal-planning/lazy-dialogs";
import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import type { PlanLeftoversRequest } from "@/components/meal-planning/mark-cooked-dialog";
import { MealPlanSearch } from "@/components/meal-planning/meal-plan-search";
import { BulkMealBar } from "@/components/meal-planning/bulk-meal-bar";
import { bulkEditMealEntriesAction } from "@/app/dashboard/meal-planning/bulk-meal-actions";
import {
  copyWeekAction,
  deleteMealEntryAction,
  undoCopyWeekAction,
} from "@/app/dashboard/meal-planning/planner-actions";
import { unassignBatchPortionAction } from "@/app/dashboard/meal-planning/prep-actions";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { addDays, getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { format, plural } from "@/lib/i18n/format";
import type {
  ActiveShoppingListOption,
  MealPlanEntryData,
  PlanTemplateSummary,
  PreparedBatchData,
  RecipeData,
} from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";

type MealPlanningDict = Dictionary["mealPlanning"];

const weekdayKeys = [
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
  "weekdaySun",
] as const satisfies readonly (keyof MealPlanningDict)[];

type MealTypeLabelKey = "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack";

const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

// The desktop grid (`auto-fit,minmax(16rem,1fr)`) shows every day side by
// side, but on a phone-width viewport the same grid stacks into one column,
// so today's card used to be several screens below the fold (D8 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md). UX-21 replaced the "Jump to
// today" button with scrolling there on load.
const TODAY_CARD_ID = "meal-planner-today-card";

// GAP-23: only offered on an empty week, which is exactly when a household
// sitting down to plan would reach for it. On a partly filled week the
// action would still work (it skips filled slots), but a menu item that
// silently copies "around" existing meals is harder to predict. The Undo
// takes back exactly the entries this copy wrote, by id.
function copyLastWeek(
  dict: MealPlanningDict,
  weekStartKey: string,
  prevWeekKey: string,
  startTransition: (callback: () => Promise<void>) => void,
) {
  startTransition(async () => {
    const result = await copyWeekAction(prevWeekKey, weekStartKey);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const entryIds = result.entryIds ?? [];
    if (entryIds.length === 0) {
      toast(dict.copyLastWeekNothingToast);
      return;
    }
    toast.success(format(plural(entryIds.length, dict.copyLastWeekToast), { count: entryIds.length }), {
      duration: 8000,
      action: {
        label: dict.copyLastWeekUndo,
        onClick: () => {
          void undoCopyWeekAction(entryIds).then((undoResult) => {
            if (undoResult.error) toast.error(undoResult.error);
            else toast.success(dict.copyLastWeekUndoneToast);
          });
        },
      },
    });
  });
}

export function WeekPlanner({
  dict,
  locale,
  weekStartKey,
  recipes,
  recipeCooked,
  entries: allEntries,
  activeShoppingLists,
  batches,
  missingCount,
  planTemplates,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  weekStartKey: string;
  recipes: RecipeData[];
  // UX-96: orders the add-meal sheet's recipe list.
  recipeCooked: Record<string, RecipeCookedStats>;
  entries: MealPlanEntryData[];
  activeShoppingLists: ActiveShoppingListOption[];
  // GAP-49: active meal-prep batches, for the add-meal dialog's
  // "From meal prep" source.
  batches: PreparedBatchData[];
  // UX-91: how many ingredients the planned week still needs, counted on
  // the server (same diff as the review dialog's first preview). Zero on an
  // empty week or a fully stocked one, which hides the primary action.
  missingCount: number;
  // GAP-52: the household's saved week templates, for "Plan from template".
  planTemplates: PlanTemplateSummary[];
}) {
  // GAP-39: the "Plan leftovers" toast action's dialog. Held here, not in the
  // cooked row, because that row stops rendering MarkCookedDialog the moment
  // the meal counts as cooked.
  const [leftoversPlan, setLeftoversPlan] = useState<PlanLeftoversRequest | null>(null);
  // GAP-56: Select mode. The selection is ids, resolved against what's on
  // screen below, so a week change or a meal cooked elsewhere can't leave a
  // stale row selected. A bulk Remove hides its rows at once (hiddenIds) and
  // sends the delete when its Undo toast closes, like a single Remove meal.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const pendingRemovals = useRef<DeferredDelete[]>([]);
  const entries = allEntries.filter((entry) => !hiddenIds.has(entry.id));
  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.id) && !entry.consumedAt);
  const weekStart = parseDateKey(weekStartKey);
  const weekEnd = addDays(weekStart, 6);
  // UX-15: "28 sep.–4 okt. 2026" in sv, "Sep 28 – Oct 4, 2026" in en —
  // formatRange drops the repeated month/year itself. parseDateKey gives UTC
  // midnight, so formatting in UTC names the same days on the server and in
  // every browser (no hydration mismatch, no off-by-one west of Greenwich).
  // The spacing around the dash is engine-specific: Node's ICU writes thin
  // spaces ("Oct 12\u2009–\u200918") where Safari writes plain ones, which
  // made every English planner load a hydration mismatch on iPhones (caught
  // by the WebKit `iphone` e2e project, UX-32). Plain spaces on both sides.
  const weekRange = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
    .formatRange(weekStart, weekEnd)
    .replace(/[\u2009\u202f]/g, " ");
  const todayKey = toDateKey(new Date());

  const prevWeekKey = toDateKey(addDays(weekStart, -7));
  const nextWeekKey = toDateKey(addDays(weekStart, 7));

  const isCurrentWeek = weekStartKey === toDateKey(getWeekStart(new Date()));
  const [copyPending, startCopy] = useTransition();
  // The "Add missing ingredients" dialog is mounted only while open: a Dialog
  // inside the ⋯ menu would unmount with the menu, so it lives beside it.
  const [missingOpen, setMissingOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  // GAP-52: the template dialogs, mounted only while open like the two above.
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [pickTemplateOpen, setPickTemplateOpen] = useState(false);

  // Leaving the page ends a bulk Remove's Undo window: send the delete now
  // rather than lose it (same as useUndoableDelete).
  useEffect(() => {
    // The array is only ever pushed to, never replaced, so this is the one
    // the cleanup needs too.
    const pending = pendingRemovals.current;
    const flush = () => {
      if (document.visibilityState === "hidden") pending.forEach((d) => d.commit());
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      pending.forEach((d) => d.commit());
    };
  }, []);

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removeSelected() {
    const ids = selectedEntries.map((entry) => entry.id);
    if (ids.length === 0) return;
    setHiddenIds((prev) => new Set([...prev, ...ids]));
    exitSelectMode();
    const deferred = createDeferredDelete({
      run: async () => {
        const result = await settleOptimisticAction(
          () => bulkEditMealEntriesAction({ op: "remove", entryIds: ids }),
          dict.prepConnectionError,
        );
        return result !== null;
      },
      restore: () =>
        setHiddenIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        }),
    });
    pendingRemovals.current.push(deferred);
    toast(format(plural(ids.length, dict.bulkRemovedToast), { count: ids.length }), {
      duration: 5000,
      action: { label: dict.undoDelete, onClick: deferred.undo },
      onAutoClose: deferred.commit,
      onDismiss: deferred.commit,
    });
  }

  // UX-21: on a phone the week is one column and today can be several
  // screens down, so bring it into view on load. Only when it isn't already
  // fully visible (the desktop grid shows it in the first row), and never
  // when the planner tab is hidden (its rect is empty).
  useEffect(() => {
    // querySelectorAll, not getElementById: take the rendered card, not a
    // hidden duplicate (e.g. streamed content not yet swapped in).
    const card = [...document.querySelectorAll<HTMLElement>(`#${TODAY_CARD_ID}`)].find(
      (el) => el.getBoundingClientRect().height > 0,
    );
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) card.scrollIntoView({ block: "start" });
  }, [weekStartKey]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateKey = toDateKey(date);
    return {
      dateKey,
      dayOfMonth: date.getUTCDate(),
      weekdayLabel: dict[weekdayKeys[i]],
      isToday: dateKey === todayKey,
    };
  });

  const entriesByDay = new Map<string, MealPlanEntryData[]>();
  for (const entry of entries) {
    const list = entriesByDay.get(entry.date) ?? [];
    list.push(entry);
    entriesByDay.set(entry.date, list);
  }

  // GAP-45: days with nothing planned that haven't passed yet (filling
  // Monday on a Thursday would plan a dinner nobody can cook), and the
  // recipes already on the plan so a proposal never repeats one.
  const emptyDays = days
    .filter((day) => !entriesByDay.has(day.dateKey) && day.dateKey >= todayKey)
    .map((day) => ({ dateKey: day.dateKey, label: `${day.weekdayLabel} ${day.dayOfMonth}` }));
  // UX-50: where an empty week's "Add your first dinner" lands: today, or
  // the next day this week, or Monday of a week already over.
  const firstOpenDay = days.find((day) => day.dateKey >= todayKey) ?? days[0];
  const plannedRecipeIds = [...new Set(entries.flatMap((e) => (e.recipeId ? [e.recipeId] : [])))];

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky on phones, so the week and its arrows stay in view down a
          week of day cards, and when the page opens scrolled to today
          (UX-21) — the same frosted bar as the shopping list's add bar. */}
      <div className="flex items-center gap-2 max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:-mx-4 max-sm:bg-background/85 max-sm:px-4 max-sm:py-2 max-sm:backdrop-blur-sm">
        <PeriodSwitcher
          className="min-w-0 flex-1"
          label={weekRange}
          prevHref={`/dashboard/meal-planning?week=${prevWeekKey}`}
          nextHref={`/dashboard/meal-planning?week=${nextWeekKey}`}
          currentHref="/dashboard/meal-planning"
          isCurrent={isCurrentWeek}
          dict={{ previous: dict.previousWeek, next: dict.nextWeek, current: dict.thisWeek }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" size="icon-sm" aria-label={dict.morePlannerActions}>
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {entries.length === 0 && (
              <DropdownMenuItem
                disabled={copyPending}
                onClick={() => copyLastWeek(dict, weekStartKey, prevWeekKey, startCopy)}
              >
                <Copy className="size-4" />
                {dict.copyLastWeek}
              </DropdownMenuItem>
            )}
            {emptyDays.length > 0 && (
              <DropdownMenuItem onClick={() => setFillOpen(true)}>
                <CalendarPlus className="size-4" />
                {dict.fillEmptyDays}
              </DropdownMenuItem>
            )}
            {entries.length > 0 && (
              <DropdownMenuItem onClick={() => setSaveTemplateOpen(true)}>
                <BookmarkPlus className="size-4" />
                {dict.templates.saveMenuItem}
              </DropdownMenuItem>
            )}
            {planTemplates.length > 0 && (
              <DropdownMenuItem onClick={() => setPickTemplateOpen(true)}>
                <LayoutTemplate className="size-4" />
                {dict.templates.pickMenuItem}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setMissingOpen(true)}>
              <ListPlus className="size-4" />
              {dict.addMissingIngredients}
            </DropdownMenuItem>
            {entries.some((entry) => !entry.consumedAt) && !selectMode && (
              <DropdownMenuItem onClick={() => setSelectMode(true)}>
                <ListChecks className="size-4" />
                {dict.bulkSelectAction}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* GAP-59: below the sticky week bar, not in it, so the bar stays one
          row on a phone. */}
      <MealPlanSearch dict={dict} locale={locale} />
      {/* PERF-26: both dialogs load on first use. They stay mounted only
          while open (the proposal and the preview are made fresh each time). */}
      <LazyDialog loader={loadFillEmptyDaysDialog} open={fillOpen} onLoadError={() => setFillOpen(false)}>
        {(FillEmptyDays) =>
          fillOpen && (
            <FillEmptyDays
              dict={dict}
              weekStartKey={weekStartKey}
              emptyDays={emptyDays}
              recipes={recipes}
              plannedRecipeIds={plannedRecipeIds}
              onClose={() => setFillOpen(false)}
            />
          )
        }
      </LazyDialog>
      <LazyDialog
        loader={loadSaveWeekTemplateDialog}
        open={saveTemplateOpen}
        onLoadError={() => setSaveTemplateOpen(false)}
      >
        {(SaveWeekTemplate) =>
          saveTemplateOpen && (
            <SaveWeekTemplate
              dict={dict.templates}
              weekStartKey={weekStartKey}
              onClose={() => setSaveTemplateOpen(false)}
            />
          )
        }
      </LazyDialog>
      <LazyDialog
        loader={loadPlanFromTemplateDialog}
        open={pickTemplateOpen}
        onLoadError={() => setPickTemplateOpen(false)}
      >
        {(PlanFromTemplate) =>
          pickTemplateOpen && (
            <PlanFromTemplate
              dict={dict.templates}
              weekStartKey={weekStartKey}
              templates={planTemplates}
              onClose={() => setPickTemplateOpen(false)}
            />
          )
        }
      </LazyDialog>
      <LazyDialog loader={loadMissingIngredientsDialog} open={missingOpen} onLoadError={() => setMissingOpen(false)}>
        {(MissingIngredients) =>
          missingOpen && (
            <MissingIngredients
              dict={dict}
              weekStartKey={weekStartKey}
              activeShoppingLists={activeShoppingLists}
              onClose={() => setMissingOpen(false)}
            />
          )
        }
      </LazyDialog>

      {entries.length === 0 ? (
        // UX-50 / M6: a week with nothing planned is one empty state with
        // one next step, not seven identical "+ Add meal" cards. The step is
        // the first dinner (the dialog offers the household's recipes);
        // "Copy last week" and "Fill empty days" stay in the ⋯ menu, which
        // the copy names.
        <MascotEmptyState
          alt={dict.mascotAlt}
          action={
            <AddMealSlot
              key="first-dinner"
              dict={dict}
              weekStartKey={weekStartKey}
              dateKey={firstOpenDay.dateKey}
              dayLabel={`${firstOpenDay.weekdayLabel} ${firstOpenDay.dayOfMonth}`}
              mealType="DINNER"
              recipes={recipes}
              recipeCooked={recipeCooked}
              batches={batches}
              firstDinner
            />
          }
        >
          <p className="text-sm text-muted-foreground">
            {recipes.length > 0 ? dict.plannerEmpty : dict.plannerEmptyNoRecipes}
          </p>
        </MascotEmptyState>
      ) : (
      <div className="list-bleed grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-3">
        {days.map((day) => {
          // A day lists only what's planned, slot by slot, then one
          // "+ Add meal" that asks for the slot (UX-21's empty-day row, now
          // on every day). Four slot headers per day, three of them "Add
          // meal", made a phone week four screens long (DESIGN.md M6).
          const dayEntries = [...(entriesByDay.get(day.dateKey) ?? [])].sort(
            (a, b) => MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType),
          );
          // The add dialog preselects dinner, or the first slot still empty
          // once dinner is planned.
          const openSlot = dayEntries.some((e) => e.mealType === "DINNER")
            ? (MEAL_TYPES.find((type) => !dayEntries.some((e) => e.mealType === type)) ?? "DINNER")
            : "DINNER";
          return (
            <Card
              key={day.dateKey}
              id={day.isToday ? TODAY_CARD_ID : undefined}
              aria-current={day.isToday ? "date" : undefined}
              className={day.isToday ? "scroll-mt-2 ring-2 ring-primary/50 max-sm:scroll-mt-18" : undefined}
            >
              <CardHeader>
                <CardTitle className="flex items-baseline justify-between">
                  <span>{day.weekdayLabel}</span>
                  <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                    {/* UX-99: today is said in words, not only by the ring
                        (DESIGN.md Accessibility: never colour alone). */}
                    {day.isToday && <Badge>{dict.todayBadge}</Badge>}
                    {day.dayOfMonth}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {dayEntries.map((entry) => (
                  <MealEntryRow
                    key={entry.id}
                    dict={dict}
                    locale={locale}
                    entry={entry}
                    dayLabel={`${day.weekdayLabel} ${day.dayOfMonth}`}
                    recipes={recipes}
                    weekStartKey={weekStartKey}
                    onPlanLeftovers={setLeftoversPlan}
                    selectMode={selectMode}
                    selected={selectedIds.has(entry.id)}
                    onToggleSelected={toggleSelected}
                  />
                ))}
                {!selectMode && (
                  <AddMealSlot
                    key={openSlot}
                    dict={dict}
                    weekStartKey={weekStartKey}
                    dateKey={day.dateKey}
                    dayLabel={`${day.weekdayLabel} ${day.dayOfMonth}`}
                    mealType={openSlot}
                    recipes={recipes}
                    recipeCooked={recipeCooked}
                    batches={batches}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}
      {/* UX-91: turning the week into a shopping list is the planner's
          primary action (DESIGN.md Hierarchy, M2), so it is a labelled
          button at the bottom, floating above the bottom bar on phones,
          not just the ⋯ menu's last item. It opens the same review dialog,
          so nothing lands on a list unseen. Hidden when there is nothing
          to add. */}
      {entries.length > 0 && missingCount > 0 && !selectMode && (
        <PrimaryAction>
          <Button type="button" onClick={() => setMissingOpen(true)}>
            <ListPlus className="size-4" />
            {format(dict.addMissingToShoppingList, { count: missingCount })}
          </Button>
        </PrimaryAction>
      )}
      {selectMode && (
        <BulkMealBar
          dict={dict}
          selected={selectedEntries}
          onDone={exitSelectMode}
          onRemove={removeSelected}
          onChanged={exitSelectMode}
        />
      )}
      <LazyDialog loader={loadAddToPlanDialog} open={leftoversPlan !== null} onLoadError={() => setLeftoversPlan(null)}>
        {(AddToPlan) =>
          leftoversPlan && (
            <AddToPlan
              key={leftoversPlan.batchId}
              dict={dict}
              recipeId={leftoversPlan.recipeId}
              recipeName={leftoversPlan.recipeName}
              defaultPortions={leftoversPlan.servings}
              plannerWeekStartKey={weekStartKey}
              defaultDate={leftoversPlan.date}
              hint={dict.planLeftoversHint}
              preparedBatchId={leftoversPlan.batchId}
              controlled={{
                open: true,
                onOpenChange: (next) => {
                  if (!next) setLeftoversPlan(null);
                },
              }}
            />
          )
        }
      </LazyDialog>
    </div>
  );
}

// One planned meal: a single tappable row (slot, name, portions, status)
// that opens a sheet of labelled actions. It used to carry five unlabelled
// 44 px icon buttons on a second line, delete right beside "mark cooked"
// (DESIGN.md M2, M6). The sheet hands off to each action's own dialog
// through a handle, the same way the shopping list's ⋯ menu does, so those
// dialogs live beside the sheet rather than inside it.
function MealEntryRow({
  dict,
  locale,
  entry,
  dayLabel,
  recipes,
  weekStartKey,
  onPlanLeftovers,
  selectMode,
  selected,
  onToggleSelected,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  entry: MealPlanEntryData;
  dayLabel: string;
  recipes: RecipeData[];
  weekStartKey: string;
  onPlanLeftovers: (request: PlanLeftoversRequest) => void;
  // GAP-56: in Select mode the row is a checkbox instead of a sheet opener.
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}) {
  const label = entry.recipeName ?? entry.freeformName ?? "";
  const slotLabel = dict[mealTypeDictKey[entry.mealType]];
  const linkedRecipe = entry.recipeId ? recipes.find((recipe) => recipe.id === entry.recipeId) : undefined;
  const cookRecipe = linkedRecipe?.instructions?.trim() ? linkedRecipe : null;
  // Portions only mean something next to a linked recipe — a freeform entry
  // has nothing to scale (see MealPlanEntryData.portions' doc comment).
  const portionsLabel = entry.recipeId
    ? format(plural(entry.portions, dict.entryPortionsCount), { count: entry.portions })
    : null;
  const cooked = entry.consumedAt !== null;
  const prepped = entry.preparedBatchId !== null;
  const [unassignPending, startUnassign] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  // UX-49: Remove meal hides the row at once with an Undo toast (the delete
  // goes out when it closes), not a "can't be undone" confirm.
  const { hidden, remove } = useUndoableDelete({
    run: async () =>
      (await settleOptimisticAction(() => deleteMealEntryAction(entry.id), dict.prepConnectionError)) !== null,
    message: format(dict.mealRemovedToast, { meal: label }),
    undoLabel: dict.undoDelete,
  });
  const [dialogs] = useState(() => ({
    cook: createDialogHandle(),
    markCooked: createDialogHandle(),
    edit: createDialogHandle(),
    move: createDialogHandle(),
  }));

  // The sheet closes as the chosen action's dialog opens over the page, so
  // closing that dialog lands back on the planner, not on a stale sheet.
  function openFromSheet(handle: DialogHandle) {
    setSheetOpen(false);
    openLazyDialog(handle);
  }

  // GAP-49: "Don't use prep" gives the slot's portions back to its batch and
  // keeps the meal planned, to cook fresh.
  function unassign() {
    startUnassign(async () => {
      let result;
      try {
        result = await unassignBatchPortionAction(entry.id);
      } catch (error) {
        // A dropped connection rejects the call; say so rather than hitting
        // the error boundary (M8), as the Plan portions dialog does.
        unstable_rethrow(error);
        toast.error(dict.prepConnectionError);
        return;
      }
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(dict.prepUnassignedToast);
      setSheetOpen(false);
      // No router.refresh(): the action revalidated the page and its
      // response already carries the re-render.
    });
  }

  if (hidden) return null;

  const rowBody = (
    <>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-xs font-medium uppercase text-muted-foreground">{slotLabel}</span>{" "}
      <span className="break-words">
        <span>{label}</span>
        {portionsLabel && <span className="text-muted-foreground"> · {portionsLabel}</span>}
      </span>
    </span>
    {/* Words, not just a colour or an icon, so the state reads the
        same to everyone (GAP-49's badge, the cooked tick). */}
    {prepped && (
      <Badge variant="outline" className="shrink-0">
        {dict.prepPreppedBadge}
      </Badge>
    )}
    {/* A prepped meal was cooked at prep time, so what this records is
        that it was eaten (as its "Mark as eaten" button says). */}
    {cooked && (
      <span className="flex shrink-0 items-center gap-1 text-xs text-success">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        {prepped ? dict.mealEatenBadgeLabel : dict.mealCookedBadgeLabel}
      </span>
    )}
    </>
  );

  if (selectMode) {
    if (cooked) {
      // Cooked meals aren't selectable: their day, slot and portions record
      // what was eaten (see bulk-meal-actions.ts). Said in words, not only
      // by being dimmed.
      return (
        <div className="flex min-h-11 w-full items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-sm text-muted-foreground">
          {rowBody}
          <span className="sr-only">{prepped ? dict.bulkEatenLocked : dict.bulkCookedLocked}</span>
        </div>
      );
    }
    return (
      <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md bg-muted px-2 py-1.5 text-sm transition-colors has-[:checked]:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
        <Checkbox checked={selected} onChange={() => onToggleSelected(entry.id)} />
        {rowBody}
      </label>
    );
  }

  return (
    <>
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-left text-sm transition-[background-color,scale] outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
            />
          }
        >
          {rowBody}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words">{label}</DialogTitle>
            <DialogDescription>
              {[slotLabel, dayLabel, portionsLabel].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {/* Cooking it is what a planned meal is waiting for, so it's the
                sheet's one primary action. Custom (non-recipe) meals have no
                ingredients to take off, so they say why instead (D4 in
                docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md). */}
            {!cooked && entry.recipeId && (
              <Button type="button" className="justify-start" onClick={() => openFromSheet(dialogs.markCooked)}>
                {prepped ? <Utensils className="size-4" /> : <ChefHat className="size-4" />}
                {prepped ? dict.prepEatenAction : dict.markCookedAriaLabel}
              </Button>
            )}
            {/* GAP-42: the cook view scaled to this entry's portions. Not
                gated on cooked: reading a recipe again is harmless. */}
            {cookRecipe && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => openFromSheet(dialogs.cook)}
              >
                <CookingPot className="size-4" />
                {dict.cookModeButton}
              </Button>
            )}
            {/* GAP-30: hidden once cooked. A cooked entry's day and slot
                record when it was actually eaten, so moveMealEntryAction
                refuses to move it (see its doc comment). */}
            {!cooked && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => openFromSheet(dialogs.edit)}
                >
                  <Pencil className="size-4" />
                  {dict.editMealAriaLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => openFromSheet(dialogs.move)}
                >
                  <ArrowRightLeft className="size-4" />
                  {dict.moveMealAriaLabel}
                </Button>
              </>
            )}
            {prepped && !cooked && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={unassignPending}
                onClick={unassign}
              >
                {unassignPending ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                {dict.prepUnassignAction}
              </Button>
            )}
            {!entry.recipeId && (
              <p className="text-sm text-muted-foreground">{dict.markCookedUnavailableForCustomMeal}</p>
            )}
          </div>
          {/* M2: the destructive action sits apart, under a rule, never
              next to the primary one. */}
          <div className="border-t pt-4">
            <Button
              type="button"
              variant="destructive"
              className="w-full justify-start"
              onClick={() => {
                setSheetOpen(false);
                // After the sheet has closed, so it unmounts shut.
                requestAnimationFrame(remove);
              }}
            >
              <Trash2 className="size-4" />
              {dict.removeMealAriaLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* PERF-26: each row's dialogs load on first use. */}
      {cookRecipe && (
        <LazyDialog loader={loadCookModeDialog} handle={dialogs.cook}>
          {(CookMode) => (
            <CookMode
              dict={dict}
              locale={locale}
              recipe={cookRecipe}
              portions={entry.portions}
              handle={dialogs.cook}
              onDone={!cooked && entry.recipeId ? () => openLazyDialog(dialogs.markCooked) : undefined}
            />
          )}
        </LazyDialog>
      )}
      {!cooked && entry.recipeId && (
        <LazyDialog loader={loadMarkCookedDialog} handle={dialogs.markCooked}>
          {(MarkCooked) => (
            <MarkCooked dict={dict} entry={entry} onPlanLeftovers={onPlanLeftovers} handle={dialogs.markCooked} />
          )}
        </LazyDialog>
      )}
      {!cooked && (
        <>
          <LazyDialog loader={loadMealEntryDialog} handle={dialogs.edit}>
            {(MealEntry) => <MealEntry dict={dict} recipes={recipes} mode="edit" entry={entry} handle={dialogs.edit} />}
          </LazyDialog>
          <LazyDialog loader={loadMoveMealDialog} handle={dialogs.move}>
            {(MoveMeal) => (
              <MoveMeal
                dict={dict}
                entry={entry}
                label={label}
                plannerWeekStartKey={weekStartKey}
                handle={dialogs.move}
              />
            )}
          </LazyDialog>
        </>
      )}
    </>
  );
}

// PERF-26: a day's "+ Add meal" (or an empty week's "Add your first dinner")
// and the meal form behind it. The button stays in the planner's own chunk;
// the form loads on first use, warmed on pointer-enter or focus.
function AddMealSlot({
  dict,
  weekStartKey,
  dateKey,
  dayLabel,
  mealType,
  recipes,
  recipeCooked,
  batches,
  firstDinner = false,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  dateKey: string;
  dayLabel: string;
  mealType: MealType;
  recipes: RecipeData[];
  recipeCooked: Record<string, RecipeCookedStats>;
  batches: PreparedBatchData[];
  /** The empty week's one next step: a primary button, not the day's row. */
  firstDinner?: boolean;
}) {
  const [handle] = useState(() => createDialogHandle());
  const open = () => openLazyDialog(handle);
  const intent = preloadOnIntent(loadMealEntryDialog);
  return (
    <>
      {firstDinner ? (
        <Button type="button" aria-haspopup="dialog" onClick={open} {...intent}>
          <Plus className="size-4" />
          {dict.addFirstDinner}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          aria-label={format(dict.addMealAriaLabel, { day: dayLabel })}
          aria-haspopup="dialog"
          className="h-9 w-full justify-start gap-1 px-2 text-sm text-muted-foreground max-sm:h-11"
          onClick={open}
          {...intent}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {dict.addMeal}
        </Button>
      )}
      <LazyDialog loader={loadMealEntryDialog} handle={handle}>
        {(MealEntry) => (
          <MealEntry
            dict={dict}
            weekStartKey={weekStartKey}
            dateKey={dateKey}
            dayLabel={dayLabel}
            mealType={mealType}
            recipes={recipes}
            recipeCooked={recipeCooked}
            batches={batches}
            handle={handle}
          />
        )}
      </LazyDialog>
    </>
  );
}
