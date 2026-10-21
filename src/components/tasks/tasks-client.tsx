"use client";

// Household Tasks v1 (see docs/archive/JOY_GAP_BACKLOG.md item 6b) — one shared task list
// per household. Mirrors ShoppingListClient's shape: an add-task form, a
// flat list split into an open section and a completed section. Creating and
// editing a task both go through the shared TaskFormDialog (see
// task-form-dialog.tsx) rather than delete-and-re-add.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Trash2, Repeat, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTickFeedback } from "@/lib/tick-feedback";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteTaskAction, toggleTaskCompletedAction } from "@/app/dashboard/tasks/actions";
import { getNextDueDate } from "@/app/dashboard/tasks/recurrence";
import { isOlderCompletedOneOff } from "@/app/dashboard/tasks/older-completed";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { SwipeRow } from "@/components/shared/swipe-row";
import { useLocalPreference } from "@/components/shared/use-local-preference";
import { filterTasks, parseTaskFilter, type TaskFilter } from "@/app/dashboard/tasks/task-filter";
import { TASKS_FILTER_STORAGE_KEY } from "@/lib/cookie-inventory";
import { useUndoableDelete } from "@/components/shared/use-undoable-delete";
import { TasksWeeklyRecap } from "@/components/tasks/tasks-weekly-recap";
import { applyLocalRowChanges, settleDelete, useLocalRowChanges } from "@/components/shared/local-row-changes";
import { useFlipList } from "@/components/shared/use-flip-list";
import { computeWeeklyTaskRecap } from "@/app/dashboard/tasks/weekly-recap-calc";
import { withLocalCompletion } from "@/lib/task-rotation";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { MascotEmptyState, MascotMark } from "@/components/brand/mascot-empty-state";

type MemberOption = { id: string; displayName: string };

type TaskRow = {
  id: string;
  title: string;
  assignedToMemberId: string | null;
  completedByMemberId: string | null;
  completed: boolean;
  recurrenceIntervalDays: number | null;
  completedAt: Date | null;
  createdAt: Date;
  recurrenceAnchorAt: Date | null;
  rotationMemberIds: string[];
  /** GAP-38: who's up after the current turn; null unless the task rotates. */
  nextInRotationMemberId: string | null;
};

type TasksDict = Dictionary["tasks"];

export function TasksClient({
  dict,
  members,
  currentMemberId,
  tasks: serverTasks,
  now,
  timeZone,
  locale,
}: {
  dict: TasksDict;
  members: MemberOption[];
  /** Who's ticking, for a completion shown before the server answers. */
  currentMemberId: string | null;
  tasks: TaskRow[];
  /** The server's clock, which sets the weekly recap's week. */
  now: Date;
  /** The visitor's zone: the local day a repeating chore reopens on. */
  timeZone: string;
  locale: Locale;
}) {
  const memberNameById = new Map(members.map((m) => [m.id, m.displayName]));

  // UX-33: a tick or a delete shows, and moves its row, at tap time (see
  // local-row-changes.ts); the weekly recap above follows it too. Each save
  // settles on its own, outside any transition, so ticking several chores
  // in a row never waits on (or greys out behind) an earlier save (UX-14),
  // and a failed one moves its row back at once, with a toast.
  const local = useLocalRowChanges(serverTasks);
  const allTasks = applyLocalRowChanges(serverTasks, local.changes, (task, completed) =>
    withLocalCompletion(task, completed, currentMemberId, new Date()),
  );
  // UX-106: "Mine / Everyone", remembered on this device. It only shows (and
  // only applies) to someone who is in a household with a second person; for
  // a household of one it would filter nothing.
  const [storedFilter, setStoredFilter] = useLocalPreference(TASKS_FILTER_STORAGE_KEY);
  const canFilter = currentMemberId !== null && members.length > 1;
  const filter: TaskFilter = canFilter ? parseTaskFilter(storedFilter) : "everyone";
  const tasks = filterTasks(allTasks, filter, currentMemberId);
  // UX-105: older completed one-offs stay behind "Show N older" until asked.
  const [showOlder, setShowOlder] = useState(false);
  const toggleCompleted = (task: TaskRow) => {
    const completing = !task.completed;
    const settle = local.markDone(task.id, completing);
    if (completing) {
      // The row leaves for "Completed" below the fold, so say what
      // happened and offer the way back (M5, User control). Undo is the
      // same toggle, from the state this tick left the task in.
      toast(format(dict.doneToast, { title: task.title }), {
        duration: 5000,
        action: { label: dict.swipe.undo, onClick: () => toggleCompleted({ ...task, completed: true }) },
      });
    }
    void (async () => {
      const result = await settleOptimisticAction(() => toggleTaskCompletedAction(task.id), dict.saveFailedToast);
      settle(result !== null);
    })();
  };
  // From the row's confirm dialog, which waits on it and toasts an error.
  const deleteTask = async (task: TaskRow) => {
    return settleDelete(local.markDeleted(task.id), deleteTaskAction(task.id), dict.saveFailedToast);
  };
  const containerRef = useFlipList<HTMLDivElement>();

  const openTasks = tasks.filter((t) => !t.completed);
  // UX-105: a one-off ticked over a week ago collapses behind "Show N older".
  const completedTasks = tasks.filter((t) => t.completed);
  const olderTasks = completedTasks.filter((t) => isOlderCompletedOneOff(t, now));
  const shownCompletedTasks = showOlder ? completedTasks : completedTasks.filter((t) => !olderTasks.includes(t));
  // UX-104: worked out once, from the list as the page opened. Following
  // the list live mounted the recap (about 115 px) above the rows on the
  // first tick of the week, so the rows jumped under the thumb (M5). A
  // tick shows in the recap on the next visit.
  const [recapGroups] = useState(() =>
    computeWeeklyTaskRecap({
      tasks: serverTasks
        .filter((t) => t.completedAt !== null)
        .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime()),
      now,
    }).map((group) => ({
      memberName: group.completedByMemberId ? (memberNameById.get(group.completedByMemberId) ?? null) : null,
      titles: group.titles,
    })),
  );

  return (
    <div ref={containerRef} className="relative flex flex-col gap-6">
      {recapGroups.length > 0 && <TasksWeeklyRecap groups={recapGroups} dict={dict} />}

      {canFilter && (
        <div role="group" aria-label={dict.filterLabel} className="-mb-2 flex gap-2">
          {(["everyone", "mine"] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? "default" : "outline"}
              size="sm"
              aria-pressed={filter === value}
              className="max-sm:min-h-11 pointer-coarse:min-h-11"
              onClick={() => setStoredFilter(value)}
            >
              {value === "mine" ? dict.filterMine : dict.filterEveryone}
            </Button>
          ))}
        </div>
      )}

      {/* Keyed too, so the list glides down when the recap above grows. */}
      <div data-flip-key="tasks" className="relative flex flex-col gap-2">
        {allTasks.length === 0 ? (
          <MascotEmptyState alt={dict.mascotAlt}>
            <p className="text-sm text-muted-foreground">{dict.emptyState}</p>
          </MascotEmptyState>
        ) : tasks.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {dict.mineEmpty}
          </p>
        ) : (
          <>
            {openTasks.map((task) => (
              <TaskItemRow
                key={task.id}
                task={task}
                members={members}
                memberNameById={memberNameById}
                onToggleCompleted={toggleCompleted}
                onDelete={deleteTask}
                dict={dict}
                locale={locale}
                timeZone={timeZone}
              />
            ))}
            {openTasks.length === 0 && (
              // UX-104/UX-105: the shopping list's "All done" moment, for
              // chores. It shows whenever nothing is open (after a tick and
              // on a fresh visit), so the page never opens straight on
              // "Completed".
              // The squirrel rises in once and holds still; motion-safe
              // keeps it a static image under prefers-reduced-motion. No
              // count or streak (see "Household tasks": no tallies).
              <div
                role="status"
                className="list-bleed flex flex-col items-center gap-2 rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500"
              >
                <MascotMark
                  alt={dict.mascotAlt}
                  className="size-12 rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:zoom-in-75 motion-safe:duration-700"
                />
                <p className="font-heading text-xl font-semibold">{dict.caughtUpTitle}</p>
              </div>
            )}
            {completedTasks.length > 0 && (
              <p data-flip-key="label:completed" className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                {dict.completedSectionLabel}
              </p>
            )}
            {shownCompletedTasks.map((task) => (
              <TaskItemRow
                key={task.id}
                task={task}
                members={members}
                memberNameById={memberNameById}
                onToggleCompleted={toggleCompleted}
                onDelete={deleteTask}
                dict={dict}
                locale={locale}
                timeZone={timeZone}
              />
            ))}
            {olderTasks.length > 0 && (
              <Button
                variant="ghost"
                data-flip-key="older-toggle"
                className="self-start text-muted-foreground max-sm:min-h-11 pointer-coarse:min-h-11"
                aria-expanded={showOlder}
                onClick={() => setShowOlder((v) => !v)}
              >
                {showOlder ? dict.hideOlder : format(dict.showOlder, { count: olderTasks.length })}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TaskItemRow({
  task,
  members,
  memberNameById,
  onToggleCompleted,
  onDelete,
  dict,
  locale,
  timeZone,
}: {
  task: TaskRow;
  members: MemberOption[];
  memberNameById: Map<string, string>;
  onToggleCompleted: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => Promise<{ error?: string }>;
  dict: TasksDict;
  locale: Locale;
  timeZone: string;
}) {
  // UX-14 and UX-33: the tick shows, and the row moves to "Completed", at
  // tap time; TasksClient owns the save (toggleCompleted).
  const completed = task.completed;
  // UX-54: completing fills the box (with a haptic) before the row moves;
  // reopening is instant.
  const { ticking, tick } = useTickFeedback();
  const handleToggleCompleted = () => {
    const run = () => onToggleCompleted(task);
    if (task.completed) run();
    else tick(run);
  };
  // UX-35: swipe left → Delete hides the row with an Undo toast.
  const { hidden, remove } = useUndoableDelete({
    run: async () => (await settleOptimisticAction(() => deleteTaskAction(task.id), dict.saveFailedToast)) !== null,
    message: format(dict.swipe.deletedToast, { name: task.title }),
    undoLabel: dict.swipe.undo,
  });

  const assigneeName = task.assignedToMemberId ? memberNameById.get(task.assignedToMemberId) : undefined;
  const completerName = task.completedByMemberId ? memberNameById.get(task.completedByMemberId) : undefined;
  const nextInRotationName = task.nextInRotationMemberId
    ? memberNameById.get(task.nextInRotationMemberId)
    : undefined;
  const recurrenceLabel = task.recurrenceIntervalDays
    ? format(plural(task.recurrenceIntervalDays, dict.recurrenceBadge), { count: task.recurrenceIntervalDays })
    : null;
  // Only meaningful while the task is still shown completed — a recurring
  // task's `completedAt` also sticks around once it's auto-reopened past its
  // interval (see recurrence.ts), at which point "next due" would be a date
  // in the past, which isn't worth surfacing.
  const nextDueAt = task.completed ? getNextDueDate(task, timeZone) : null;
  const nextDueLabel = nextDueAt
    ? format(dict.nextDueLabel, {
        date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }).format(nextDueAt),
      })
    : null;

  const hasDetails =
    recurrenceLabel !== null ||
    nextDueLabel !== null ||
    nextInRotationName !== undefined ||
    task.completed ||
    completerName !== undefined;
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  if (hidden) return null;

  return (
    <SwipeRow
      className="list-bleed rounded-md"
      flipKey={task.id}
      primaryLabel={completed ? dict.swipe.reopen : dict.swipe.complete}
      primaryIcon={<Check className="size-4" />}
      editLabel={dict.swipe.edit}
      deleteLabel={dict.swipe.delete}
      onDelete={remove}
    >
      <div className="flex items-center gap-3 rounded-md border px-3 py-1 sm:py-2">
        {/* UX-106: a phone row is one line, checkbox, title, assignee, so
            about eight fit a screen (M6). Whatever else the task carries
            (repeat, next due, whose turn, who last did it) wraps in a small
            line under the title instead of pushing the assignee and the
            actions onto a second and third line. */}
        {/* UX-101: only the tick completes a task (or the right swipe). The
            title is its own button that opens the edit dialog by clicking
            the row's edit button (the same hidden-button hand-off the swipe
            uses), so a stray tap while scrolling can't complete the task
            silently (M5, forgiving). */}
        <Checkbox
          data-swipe-primary
          data-ticking={ticking || undefined}
          checked={completed || ticking}
          aria-label={format(completed ? dict.toggleIncompleteAriaLabel : dict.toggleCompleteAriaLabel, {
            title: task.title,
          })}
          onChange={handleToggleCompleted}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            className={`min-w-0 cursor-pointer rounded-sm text-left line-clamp-2 break-words focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:line-clamp-1 max-sm:min-h-11 pointer-coarse:min-h-11 max-sm:flex max-sm:items-center ${completed ? "text-muted-foreground line-through" : ""}`}
            title={task.title}
            onClick={(e) =>
              e.currentTarget.closest("[data-swipe-row]")?.querySelector<HTMLElement>("[data-swipe-edit]")?.click()
            }
          >
            {task.title}
          </button>
          {hasDetails && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pb-1 text-xs text-muted-foreground sm:pb-0">
              {recurrenceLabel && (
                <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
                  <Repeat className="size-3" />
                  {recurrenceLabel}
                </Badge>
              )}
              {nextDueLabel && <span>{nextDueLabel}</span>}
              {/* Just whose turn is next — never a count or tally of who's
                  done it how often (see REQUIREMENTS.md, "Household tasks"). */}
              {nextInRotationName && <span>{format(dict.rotationNextLabel, { name: nextInRotationName })}</span>}
              {task.completed && <span>{format(dict.completedByLabel, { name: completerName ?? dict.unassignedBadge })}</span>}
              {/* An open task can still carry a completedByMemberId from before it
                  was reopened (manually, or automatically once its recurrence
                  interval elapsed — see toggleTaskCompletedAction/recurrence.ts):
                  that's real "last done by" history, not stale data, so surface it
                  rather than letting it silently disappear once the task reopens. */}
              {!task.completed && completerName && (
                <span>{format(dict.lastCompletedByLabel, { name: completerName })}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!task.completed && (
            // A long name is cut short here (the full one is the tooltip and
            // the edit sheet) so it can't squeeze the title.
            <Badge
              variant={assigneeName ? "secondary" : "outline"}
              className="block max-w-28 truncate sm:max-w-48"
              title={assigneeName}
            >
              {assigneeName ?? dict.unassignedBadge}
            </Badge>
          )}
          {/* Edit and Delete as icons from sm up. On a phone the row's left
              swipe shows them, and the edit sheet (a tap on the title) has
              Delete too, so the row carries neither (M6, M7); these buttons
              stay mounted, hidden, for the swipe and the sheet to click. */}
          <TaskFormDialog
            mode="edit"
            task={task}
            members={members}
            dict={dict}
            onDelete={() => deleteButtonRef.current?.click()}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                data-swipe-edit
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground max-sm:hidden"
                aria-label={format(dict.editTaskAriaLabel, { title: task.title })}
              >
                <Pencil className="size-3.5" />
              </Button>
            }
          />
          <ConfirmDialog
            trigger={
              <Button
                ref={deleteButtonRef}
                variant="ghost"
                size="icon"
                data-row-delete
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive max-sm:hidden"
                aria-label={format(dict.deleteTaskAriaLabel, { title: task.title })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
            title={format(dict.confirmDelete.title, { name: task.title })}
            description={dict.confirmDelete.description}
            cancelLabel={dict.confirmDelete.cancel}
            confirmLabel={dict.confirmDelete.confirm}
            pendingLabel={dict.confirmDelete.confirming}
            // UX-33: the row goes at once and comes back if the delete fails.
            onConfirm={() => onDelete(task)}
          />
        </div>
      </div>
    </SwipeRow>
  );
}
