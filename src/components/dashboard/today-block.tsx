"use client";

// UX-70: Home's "what needs me now?" block, first on the page. On a phone
// the first screen used to be a greeting, the setup card and two cards,
// with tasks as plain text you couldn't tick and no sign of tonight's
// dinner. UX-HOME-3 made dinner its lead, so it now holds
//
// - tonight's dinner as the hero line, in the heading face, with "Start
//   cooking" (the recipe's cook mode) when a recipe with steps is planned,
//   "Plan dinner" when nothing is, and what the recipe needs that the
//   pantry hasn't got, with "Add N" to the shopping list;
// - leftovers and prep batches with portions left (they are tonight's
//   options too; this used to be a separate Meal prep card);
// - the open tasks that are yours or nobody's ("Anyone"), each with a tick
//   that saves in the background (the same optimistic pattern as the task
//   list: the row shows ticked at tap time and goes back, with a toast, if
//   the save fails; it stays in place, struck through, so nothing jumps
//   under the thumb, M5).
//
// The household's safe to spend moved to its own card beside the user's
// (SafeToSpendTiles) and the expiring count became Shopping & pantry's "Use
// soon" chips. Everything is worked out on the server
// (src/app/dashboard/page.tsx) and passed in as plain values; this
// component only owns the ticks.

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, ChefHat, ChevronRight, CookingPot, ShoppingBasket } from "lucide-react";
import { toast } from "sonner";
import { TaskOverdueBadge } from "@/components/tasks/overdue-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AddMissingButton, type MissingRow } from "@/components/dashboard/home-add-buttons";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleTaskCompletedAction } from "@/app/dashboard/tasks/actions";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type TodayTask = {
  id: string;
  title: string;
  /** Nobody is assigned: shown as "Anyone", since it's the household's. */
  unassigned: boolean;
  /** UX-133: whole days past due; 0 when it is not late. */
  overdueDays: number;
};

export type TodayDinner = {
  /** Tonight's planned dinner(s), already named and joined. */
  name: string;
  /** "4 portions" for a planned recipe; null for a freeform meal. */
  detail: string | null;
  /** The recipe's cook mode; null when no planned recipe has steps. */
  cookHref: string | null;
};

export type TodayMissing = {
  /** "Missing lime and coriander". */
  text: string;
  rows: MissingRow[];
  /** The list "Add N" fills; null starts a new one. */
  target: { id: string; name: string } | null;
  newListName: string;
};

export type TodayLeftover = { id: string; name: string; detail: string };

// Rows that link somewhere keep a 44 px target on phones (M3).
const FACT_ROW =
  "flex min-h-9 items-center gap-3 rounded-md px-1 text-sm hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-11 pointer-coarse:min-h-11";

export function TodayBlock({
  tasks,
  moreTaskCount,
  dinner,
  missing,
  leftovers,
  dict,
  missingDict,
  taskDict,
}: {
  tasks: TodayTask[];
  /** Open tasks beyond the ones listed. */
  moreTaskCount: number;
  /** Null when nothing is planned for dinner tonight. */
  dinner: TodayDinner | null;
  /** What tonight's recipes need from the shop; null when nothing. */
  missing: TodayMissing | null;
  /** Prep batches with portions left, soonest eat-by first. */
  leftovers: TodayLeftover[];
  dict: Dictionary["dashboard"]["today"];
  missingDict: { addedToast: Dictionary["mealPlanning"]["missingIngredientsAddedToast"]; alreadyOnListToast: string; openList: string };
  taskDict: Pick<Dictionary["tasks"], "toggleCompleteAriaLabel" | "toggleIncompleteAriaLabel" | "doneToast"> & {
    undo: string;
    saveFailedToast: string;
    overdueLabel: Dictionary["tasks"]["overdueLabel"];
  };
}) {
  // What this visit has ticked, by task id, with the row's place in the
  // list. Completing a task revalidates the page, so the server soon sends
  // a list without it (MAINT-25: the row used to vanish a moment after the
  // tick, which also made the e2e check flaky). The ticked row has to stay,
  // struck through, so nothing jumps under the thumb (M5): it is kept here
  // and put back where it was whenever the server list no longer holds it.
  // Unticking (or Undo) keeps the entry with done: false, because by then
  // the server list has usually dropped the task and the un-complete save
  // hasn't revalidated yet: deleting the entry would make the row vanish at
  // once (M5). It is only dropped once the server list holds the task again.
  const [ticked, setTicked] = useState<ReadonlyMap<string, { task: TodayTask; index: number; done: boolean }>>(
    () => new Map(),
  );

  // Dropping happens while rendering (React's "adjust state on a prop
  // change" pattern), so the row never flashes between the two lists.
  const serverIds = new Set(tasks.map((t) => t.id));
  if ([...ticked].some(([id, entry]) => !entry.done && serverIds.has(id))) {
    setTicked((current) => {
      const next = new Map(current);
      for (const [id, entry] of current) if (!entry.done && serverIds.has(id)) next.delete(id);
      return next;
    });
  }

  const toggle = (task: TodayTask, completing: boolean, index: number) => {
    const set = (done: boolean) =>
      setTicked((current) => {
        const next = new Map(current);
        next.set(task.id, { task, index, done });
        return next;
      });
    set(completing);
    if (completing) {
      // Undo is the same toggle, from the state this tick left behind.
      toast(format(taskDict.doneToast, { title: task.title }), {
        duration: 5000,
        action: { label: taskDict.undo, onClick: () => toggle(task, false, index) },
      });
    }
    void (async () => {
      const result = await settleOptimisticAction(() => toggleTaskCompletedAction(task.id), taskDict.saveFailedToast);
      if (result === null) set(!completing);
    })();
  };

  const shownTasks = [...tasks];
  for (const { task, index } of [...ticked.values()].sort((a, b) => a.index - b.index)) {
    if (!shownTasks.some((t) => t.id === task.id)) shownTasks.splice(Math.min(index, shownTasks.length), 0, task);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-base font-semibold text-foreground">{dict.title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <section aria-labelledby="today-tonight" className="flex flex-col gap-3">
          <div className="flex min-w-0 flex-col">
            <h3 id="today-tonight" className="text-sm text-muted-foreground">
              {dict.tonight}
            </h3>
            {dinner ? (
              <>
                <p className="font-heading text-2xl leading-tight font-semibold break-words text-foreground">
                  {dinner.name}
                </p>
                {dinner.detail && <p className="text-sm text-muted-foreground">{dinner.detail}</p>}
              </>
            ) : (
              <p className="text-sm text-foreground">{dict.nothingPlanned}</p>
            )}
          </div>
          {missing && (
            // flex-wrap + the text's min width: a long "Missing …" line pushes
            // "Add N" onto its own line rather than wrapping into a narrow
            // column beside it.
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-warning/10 py-1.5 pr-1.5 pl-3 dark:bg-warning/20">
              <ShoppingBasket className="size-4 shrink-0 text-warning" aria-hidden />
              <p className="min-w-44 flex-1 text-sm font-medium break-words text-pretty">{missing.text}</p>
              <AddMissingButton
                rows={missing.rows}
                target={missing.target}
                label={format(dict.addMissing, { count: missing.rows.length })}
                ariaLabel={format(plural(missing.rows.length, dict.addMissingAriaLabel), {
                  count: missing.rows.length,
                })}
                dict={{ ...missingDict, newListName: missing.newListName }}
              />
            </div>
          )}
          {dinner?.cookHref && (
            <Button variant="outline" className="self-start" render={<Link href={dinner.cookHref} />}>
              <CookingPot className="size-4" />
              {dict.startCooking}
            </Button>
          )}
          {!dinner && (
            <Button variant="outline" className="self-start" render={<Link href="/dashboard/meal-planning" />}>
              <CalendarPlus className="size-4" />
              {dict.planDinner}
            </Button>
          )}
          {leftovers.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label={dict.leftoversAriaLabel}>
              {leftovers.map((batch) => (
                <li key={batch.id}>
                  <Link href="/dashboard/meal-planning?tab=prep" className={FACT_ROW}>
                    <ChefHat className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-2 font-medium break-words">{batch.name}</span>
                      <span className="text-muted-foreground tabular-nums">{batch.detail}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {shownTasks.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t pt-3" aria-label={dict.tasksAriaLabel}>
            {shownTasks.map((task, index) => {
              const done = ticked.get(task.id)?.done ?? false;
              return (
                <li key={task.id} className="flex items-center gap-3 px-1 max-sm:min-h-11">
                  <Checkbox
                    checked={done}
                    aria-label={format(
                      done ? taskDict.toggleIncompleteAriaLabel : taskDict.toggleCompleteAriaLabel,
                      { title: task.title },
                    )}
                    onChange={() => toggle(task, !done, index)}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`line-clamp-2 break-words text-sm ${done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {task.title}
                    </span>
                    {(task.overdueDays > 0 || task.unassigned) && (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {task.overdueDays > 0 && !done && (
                          <TaskOverdueBadge days={task.overdueDays} label={taskDict.overdueLabel} />
                        )}
                        {task.unassigned && <span>{dict.anyone}</span>}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-t pt-3 text-sm text-muted-foreground">{dict.noTasks}</p>
        )}
        <Link
          href="/dashboard/tasks"
          className="touch-target inline-flex items-center gap-1 self-start rounded-md text-sm font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {moreTaskCount > 0
            ? format(plural(moreTaskCount, dict.moreTasks), { count: moreTaskCount })
            : dict.viewTasks}
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
