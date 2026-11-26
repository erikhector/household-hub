"use client";

import { useLayoutEffect, useState, useTransition } from "react";
import { BookmarkPlus, CalendarPlus, Copy, LayoutTemplate, ListChecks, ListPlus, Loader2, MoreHorizontal } from "lucide-react";
import type { RecipeTag } from "@/lib/recipe-tags";
import { Button } from "@/components/ui/button";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PeriodSwitcher } from "@/components/period-switcher";
import { PrimaryAction } from "@/components/dashboard/primary-action";
import { LazyDialog } from "@/components/ui/lazy-dialog";
import {
  loadAddToPlanDialog,
  loadFillEmptyDaysDialog,
  loadSaveWeekTemplateDialog,
  loadPlanFromTemplateDialog,
  loadMissingIngredientsDialog,
} from "@/components/meal-planning/lazy-dialogs";
import { WeekPicksTray } from "@/components/meal-planning/week-picks-tray";
import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import type { PlanLeftoversRequest } from "@/components/meal-planning/mark-cooked-dialog";
import { MealPlanSearch } from "@/components/meal-planning/meal-plan-search";
import { BulkMealBar } from "@/components/meal-planning/bulk-meal-bar";
import { AddMealSlot } from "@/components/meal-planning/add-meal-slot";
import { WeekJump } from "@/components/meal-planning/week-jump";
import { WeekDayCard } from "@/components/meal-planning/week-day-card";
import { WeekPicksDialogs } from "@/components/meal-planning/week-picks-dialogs";
import { useMealSelection } from "@/components/meal-planning/use-meal-selection";
import { usePendingRemovals } from "@/components/meal-planning/use-pending-removals";
import { useWeekPicks } from "@/components/meal-planning/use-week-picks";
import {
  buildWeek,
  copyLastWeek,
  formatWeekRange,
  TODAY_CARD_ID,
  type MealPlanningDict,
} from "@/components/meal-planning/week-planner-helpers";
import { addDays, getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { format } from "@/lib/i18n/format";
import type {
  ActiveShoppingListOption,
  MealPlanEntryData,
  PlanTemplateSummary,
  PreparedBatchData,
  RecipeData,
  WeekPickData,
} from "@/components/meal-planning/types";
import type { Locale } from "@/lib/i18n/locales";

// MAINT-109: the planner's parts live beside it. week-planner-helpers.ts
// has the week's pure maths, use-week-picks.ts the tray's state and its
// place/move/drag actions (with week-picks-dialogs.tsx), use-meal-selection.ts
// Select mode, week-day-card.tsx one day, and meal-entry-row.tsx and
// add-meal-slot.tsx the rows inside it. This file wires them together and
// owns the week bar, its ⋯ menu and the dialogs that menu opens.
export function WeekPlanner({
  dict,
  locale,
  weekStartKey,
  recipes,
  recipeCooked,
  entries: allEntries,
  picks: allPicks,
  hasPlannedMeals,
  carriedCount,
  activeShoppingLists,
  batches,
  missingCount,
  planTemplates,
  requiredTags,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  weekStartKey: string;
  recipes: RecipeData[];
  // GAP-71: Household.requiredTags; a planned recipe lacking one gets a badge.
  requiredTags: RecipeTag[];
  // UX-96: orders the add-meal sheet's recipe list.
  recipeCooked: Record<string, RecipeCookedStats>;
  entries: MealPlanEntryData[];
  // Week picks: the tray's meals, chosen for this week but not on a day.
  picks: WeekPickData[];
  // UX-171: any meal planned in any week; the search field waits for one.
  hasPlannedMeals: boolean;
  // How many picks the carry-over just moved into this week (week-picks.ts),
  // for a one-off toast. Zero on every other load.
  carriedCount: number;
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
  // A bulk Remove's and a removed pick's deletes, sent when their Undo
  // window closes or the page is left.
  const pendingRemovals = usePendingRemovals();
  const selection = useMealSelection(dict, allEntries, pendingRemovals);
  const { entries, selectMode, selectedIds, selectedEntries, exitSelectMode } = selection;
  const weekStart = parseDateKey(weekStartKey);
  const weekRange = formatWeekRange(locale, weekStart);
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

  const planning = useWeekPicks({
    dict,
    locale,
    weekStartKey,
    allPicks,
    carriedCount,
    isCurrentWeek,
    todayKey,
    hideEntry: selection.hideEntry,
    pendingRemovals,
  });
  const { picks, pointer, lifted, setLifted, drag, dropTarget } = planning;
  const wp = dict.weekPicks;
  // A week that's over takes no new picks and sends nothing back to the
  // tray (pick-actions.ts refuses both); its leftovers already moved on.
  const isPastWeek = weekStartKey < toDateKey(getWeekStart(new Date()));

  // UX-21: on a phone the week is one column and today can be several
  // screens down, so bring it into view on load. Only when it isn't already
  // fully visible (the desktop grid shows it in the first row), and never
  // when the planner tab is hidden (its rect is empty).
  //
  // A layout effect, so the jump lands in the commit that hydrates the
  // planner and not in a task after it (MAINT-126). The planner is its own
  // Suspense boundary and often hydrates after the tab bar above it is
  // already live, so as a passive effect the jump could come between a tap
  // being aimed at the Recipes tab and landing: the tap hit whatever the
  // jump scrolled under it, and the tab didn't open. Now "the planner is
  // hydrated" means "the jump is done", which is what e2e/ui.ts's
  // openRecipesTab waits for.
  useLayoutEffect(() => {
    // querySelectorAll, not getElementById: take the rendered card, not a
    // hidden duplicate (e.g. streamed content not yet swapped in).
    const card = [...document.querySelectorAll<HTMLElement>(`#${TODAY_CARD_ID}`)].find(
      (el) => el.getBoundingClientRect().height > 0,
    );
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) card.scrollIntoView({ block: "start" });
  }, [weekStartKey]);

  const { days, entriesByDay, emptyDays, firstOpenDay, plannedRecipeIds, freeDinners, placeDays } = buildWeek(
    dict,
    weekStart,
    todayKey,
    entries,
  );
  const trayDrop = planning.dropZone("tray", drag?.kind === "entry" && !isPastWeek, () => {
    if (drag?.kind === "entry") planning.backToPicks(drag.entry, drag.entry.recipeName ?? drag.entry.freeformName ?? "");
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky on phones, so the week and its arrows stay in view down a
          week of day cards, and when the page opens scrolled to today
          (UX-21). Solid, like the shopping list's add bar: it only sticks
          once the title has collapsed into the opaque top bar, so the two
          read as one bar. It used to be frosted (85% plus a backdrop
          blur), which left a smeared strip of the page under the top bar
          on iOS. */}
      <div className="flex items-center gap-2 max-sm:sticky max-sm:top-[var(--compact-title-overlap,0px)] max-sm:z-10 max-sm:-mx-4 max-sm:bg-background max-sm:px-4 max-sm:py-2">
        <PeriodSwitcher
          className="min-w-0 flex-1"
          label={weekRange}
          labelControl={<WeekJump label={weekRange} weekStartKey={weekStartKey} dict={dict} />}
          prevHref={`/dashboard/meal-planning?week=${prevWeekKey}`}
          nextHref={`/dashboard/meal-planning?week=${nextWeekKey}`}
          currentHref="/dashboard/meal-planning"
          isCurrent={isCurrentWeek}
          dict={{ previous: dict.previousWeek, next: dict.nextWeek, current: dict.thisWeek }}
        />
        <DropdownMenu>
          {/* UX-213: Copy last week's menu item closes on tap, so the copy's
              pending state shows here: a spinner, and no second copy until
              the first one's toast. */}
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={copyPending}
                aria-label={dict.morePlannerActions}
                aria-busy={copyPending || undefined}
              >
                {copyPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <MoreHorizontal className="size-4" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {entries.length === 0 && (
              <DropdownMenuItem onClick={() => copyLastWeek(dict, weekStartKey, prevWeekKey, startCopy)}>
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
              <DropdownMenuItem
                onClick={() => {
                  setLifted(null);
                  selection.setSelectMode(true);
                }}
              >
                <ListChecks className="size-4" />
                {dict.bulkSelectAction}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* GAP-59: below the sticky week bar, not in it, so the bar stays one
          row on a phone. */}
      {(hasPlannedMeals || entries.length > 0) && <MealPlanSearch dict={dict} locale={locale} />}
      {(!isPastWeek || picks.length > 0) && (
      <WeekPicksTray
        dict={wp}
        picks={picks}
        weekHasMeals={entries.length > 0}
        allPlaced={planning.allPlaced}
        canPick={!isPastWeek}
        canSpread={freeDinners.length > 0}
        pointer={pointer}
        lifted={lifted}
        draggingEntry={drag?.kind === "entry"}
        dropActive={dropTarget === "tray"}
        onPickClick={planning.onPickClick}
        onPickDragStart={(pick, event) => planning.startDrag(event, { kind: "pick", pick }, pick.name)}
        onDragEnd={planning.endDrag}
        onOpenPicker={() => planning.setPickerOpen(true)}
        onOpenSpread={() => planning.setSpreadOpen(true)}
        onMoreOptions={(pick) => {
          setLifted(null);
          planning.setPlaceSheet(pick);
        }}
        onCancelLift={() => setLifted(null)}
        onTrayDragOver={trayDrop.onDragOver ?? (() => {})}
        onTrayDragLeave={trayDrop.onDragLeave ?? (() => {})}
        onTrayDrop={trayDrop.onDrop ?? (() => {})}
      />
      )}
      <WeekPicksDialogs
        dict={dict}
        weekRange={weekRange}
        weekStartKey={weekStartKey}
        recipes={recipes}
        recipeCooked={recipeCooked}
        placeDays={placeDays}
        freeDinners={freeDinners}
        planning={planning}
        onPlanLeftovers={setLeftoversPlan}
      />
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
              connectionError={dict.prepConnectionError}
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

      {entries.length === 0 && picks.length === 0 ? (
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
              dayLabel={firstOpenDay.label}
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
          {/* UX-171: offered here, as the secondary next to the one primary,
              rather than only pointed at in the ⋯ menu. With no recipes it
              would have nothing to propose. */}
          {recipes.length > 0 && emptyDays.length > 0 && (
            <Button type="button" variant="outline" onClick={() => setFillOpen(true)}>
              <CalendarPlus className="size-4" />
              {dict.fillEmptyDays}
            </Button>
          )}
        </MascotEmptyState>
      ) : (
      <div className="list-bleed grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-3">
        {days.map((day) => (
          <WeekDayCard
            key={day.dateKey}
            dict={dict}
            locale={locale}
            day={day}
            entries={entriesByDay.get(day.dateKey) ?? []}
            recipes={recipes}
            recipeCooked={recipeCooked}
            batches={batches}
            requiredTags={requiredTags}
            weekStartKey={weekStartKey}
            isPastWeek={isPastWeek}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelected={selection.toggleSelected}
            onPlanLeftovers={setLeftoversPlan}
            planning={planning}
          />
        ))}
      </div>
      )}
      {/* UX-91: turning the week into a shopping list is the planner's
          primary action (DESIGN.md Hierarchy, M2), so it is a labelled
          button at the bottom, floating above the bottom bar on phones,
          not just the ⋯ menu's last item. It opens the same review dialog,
          so nothing lands on a list unseen. Hidden when there is nothing
          to add. */}
      {(entries.length > 0 || picks.length > 0) && missingCount > 0 && !selectMode && (
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
          onRemove={selection.removeSelected}
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
