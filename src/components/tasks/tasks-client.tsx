"use client";

// Household Tasks v1 (see docs/archive/JOY_GAP_BACKLOG.md item 6b) — one shared task list
// per household. Mirrors ShoppingListClient's shape: an add-task form, a
// flat list split into an open section and a completed section. Creating and
// editing a task both go through the shared TaskFormDialog (see
// task-form-dialog.tsx) rather than delete-and-re-add.

import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Trash2, Repeat, Pencil, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useTickFeedback } from "@/lib/tick-feedback";
import { Badge } from "@/components/ui/badge";
import { deleteTaskAction, skipTaskAction, toggleTaskCompletedAction, unskipTaskAction } from "@/app/dashboard/tasks/actions";
import { getNextDueDate, isUpcoming, withLocalSkip } from "@/app/dashboard/tasks/recurrence";
import { WEEKDAY_KEYS, recurrenceText } from "@/app/dashboard/tasks/recurrence-label";
import { daysOverdue, getTaskUrgency, sortByUrgency, todayDayNumber } from "@/app/dashboard/tasks/task-due";
import { TaskOverdueBadge } from "@/components/tasks/overdue-badge";
import { isOlderCompletedOneOff } from "@/app/dashboard/tasks/older-completed";
import { TaskFormDialog, type PantryItemOption } from "@/components/tasks/task-form-dialog";
import { usedToastText } from "@/components/tasks/used-toast";
import { useUnitLabel } from "@/components/units-provider";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { SwipeRow } from "@/components/shared/swipe-row";
import { useLocalPreference } from "@/components/shared/use-local-preference";
import { filterTasks, parseTaskFilter, type TaskFilter } from "@/app/dashboard/tasks/task-filter";
import { TASKS_FILTER_STORAGE_KEY } from "@/lib/cookie-inventory";
import { startUndoableDelete } from "@/components/shared/start-undoable-delete";
import { TasksWeeklyRecap } from "@/components/tasks/tasks-weekly-recap";
import { applyLocalRowChanges, settleDelete, useLocalRowChanges } from "@/components/shared/local-row-changes";
import { useFlipList } from "@/components/shared/use-flip-list";
import { computeWeeklyTaskRecap } from "@/app/dashboard/tasks/weekly-recap-calc";
import { withLocalCompletion } from "@/lib/task-rotation";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { MascotEmptyState, MascotMark } from "@/components/brand/mascot-empty-state";

type MemberOption = { id: string; displayName: string };

type TaskRow = {
  id: string;
  title: string;
  /** GAP-73: plain-text detail, or null. */
  notes: string | null;
  assignedToMemberId: string | null;
  completedByMemberId: string | null;
  completed: boolean;
  recurrenceIntervalDays: number | null;
  completedAt: Date | null;
  createdAt: Date;
  recurrenceAnchorAt: Date | null;
  /** The weekday (0 Sunday … 6 Saturday) a whole-weeks repeat falls on, else null. */
  recurrenceWeekday: number | null;
  /** GAP-60: the end of a "Skip this time", when there is one. */
  skippedUntil: Date | null;
  /** GAP-60: closed by a skip that is still running (not by a tick). */
  skipped: boolean;
  /** UX-133: the local day it is due (days since 1970-01-01), or null. */
  dueDay: number | null;
  /** UX-133: a one-off's chosen date as YYYY-MM-DD, for the edit form. */
  dueDate: string | null;
  rotationMemberIds: string[];
  /** GAP-38: who's up after the current turn; null unless the task rotates. */
  nextInRotationMemberId: string | null;
  /** GAP-87: the pantry item a tick uses up, and how much; null for none. */
  consumesItemId: string | null;
  consumesQuantity: number | null;
};

type TasksDict = Dictionary["tasks"];

export function TasksClient({
  dict,
  members,
  pantryItems,
  currentMemberId,
  tasks: serverTasks,
  now,
  timeZone,
  locale,
  emptyAction,
}: {
  dict: TasksDict;
  /** UX-50: the page's "Add task" trigger, passed only while the household
   * has no tasks so the empty state can hold it (the header leaves its own
   * out then). */
  emptyAction?: ReactNode;
  members: MemberOption[];
  /** GAP-87: what the edit sheet's "Uses up" picker offers. */
  pantryItems: PantryItemOption[];
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
  const unitLabel = useUnitLabel();

  // UX-33: a tick or a delete shows, and moves its row, at tap time (see
  // local-row-changes.ts); the weekly recap above follows it too. Each save
  // settles on its own, outside any transition, so ticking several chores
  // in a row never waits on (or greys out behind) an earlier save (UX-14),
  // and a failed one moves its row back at once, with a toast.
  const local = useLocalRowChanges(serverTasks);
  const allTasks = applyLocalRowChanges(serverTasks, local.changes, (task, completed, change) => {
    // GAP-60: a skip, and unticking a skipped task (which only undoes the
    // skip), leave completedAt and its completer alone.
    if (change.skipped || (!completed && task.skipped)) return withLocalSkip(task, completed && !!change.skipped, new Date());
    return withLocalCompletion(task, completed, currentMemberId, new Date());
  });
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
    let toastId: string | number | undefined;
    let undone = false;
    const doneText = format(dict.doneToast, { title: task.title });
    const doneOptions = {
      duration: 5000,
      action: {
        label: dict.swipe.undo,
        onClick: () => {
          undone = true;
          toggleCompleted({ ...task, completed: true });
        },
      },
    };
    if (completing) {
      // The row leaves for "Completed" below the fold, so say what
      // happened and offer the way back (M5, User control). Undo is the
      // same toggle, from the state this tick left the task in.
      toastId = toast(doneText, doneOptions);
    }
    void (async () => {
      const result = await settleOptimisticAction(() => toggleTaskCompletedAction(task.id), dict.saveFailedToast);
      settle(result !== null);
      // GAP-87: the same toast names what the tick took off the pantry, once
      // the server says how much (less than asked when stock ran out). Its
      // Undo puts that back too. Not after an Undo, which closed it.
      if (toastId !== undefined && result?.used && !undone) {
        toast(doneText, {
          ...doneOptions,
          id: toastId,
          description: usedToastText(dict.usedToast, result.used, locale, unitLabel),
        });
      }
    })();
  };
  // GAP-60: "Skip this time" moves the row to "Completed" at tap time like a
  // tick, but writes no completion. Undo puts back what the column held, which
  // for a task that was open is null or a moment already past.
  const skipTask = (task: TaskRow) => {
    const previousSkippedUntil = task.skippedUntil;
    const settle = local.markSkipped(task.id, true);
    toast(format(dict.skippedToast, { title: task.title }), {
      duration: 5000,
      action: {
        label: dict.swipe.undo,
        onClick: () => {
          const settleUndo = local.markSkipped(task.id, false);
          void (async () => {
            const result = await settleOptimisticAction(
              () => unskipTaskAction(task.id, previousSkippedUntil),
              dict.saveFailedToast,
            );
            settleUndo(result !== null);
          })();
        },
      },
    });
    void (async () => {
      const result = await settleOptimisticAction(() => skipTaskAction(task.id), dict.saveFailedToast);
      settle(result !== null);
    })();
  };
  // UX-49: every delete (the swipe, the trash icon, the sheet's Delete)
  // takes the row out at tap time, like a tick, and the server hears of it
  // when the Undo toast closes. Out of the list rather than hidden in the
  // row, so the section counts follow at once instead of five seconds later.
  const deleteTask = (task: TaskRow) => {
    const settle = local.markDeleted(task.id);
    startUndoableDelete({
      run: async () => {
        const result = await settleDelete(settle, deleteTaskAction(task.id), dict.saveFailedToast);
        if (result.error) toast.error(result.error);
        return !result.error;
      },
      restore: () => settle(false),
      message: format(dict.swipe.deletedToast, { name: task.title }),
      undoLabel: dict.swipe.undo,
    });
  };
  const containerRef = useFlipList<HTMLDivElement>();

  // UX-133: overdue, then today, then later, then undated. Each tier keeps
  // its oldest-first order, so a list with no dates reads as before.
  const today = todayDayNumber(now, timeZone);
  // Weekly days: a repeat whose first day is still ahead waits under
  // "Upcoming", soonest first. Worked out from the row, not a server flag, so
  // ticking it early (and undoing that) moves it at tap time like any tick.
  const upcoming = (t: TaskRow) => !t.completed && isUpcoming(t, now, timeZone);
  const openTasks = sortByUrgency(
    tasks.filter((t) => !t.completed && !upcoming(t)),
    today,
  );
  const upcomingTasks = sortByUrgency(tasks.filter(upcoming), today);
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
        // UX-153: a segmented track, not two buttons. The active choice is
        // a view switch, so it must not read as a second solid primary beside
        // "Add task".
        <Tabs
          className="-mb-2"
          tabs={[
            { value: "everyone", label: dict.filterEveryone },
            { value: "mine", label: dict.filterMine },
          ]}
          value={filter}
          onChange={setStoredFilter}
        />
      )}

      {/* Keyed too, so the list glides down when the recap above grows. */}
      <div data-flip-key="tasks" className="relative flex flex-col gap-2">
        {allTasks.length === 0 ? (
          <MascotEmptyState alt={dict.mascotAlt} action={emptyAction}>
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
                pantryItems={pantryItems}
                memberNameById={memberNameById}
                onToggleCompleted={toggleCompleted}
                onDelete={deleteTask}
                onSkip={skipTask}
                dict={dict}
                locale={locale}
                timeZone={timeZone}
                today={today}
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
            {upcomingTasks.length > 0 && (
              <p data-flip-key="label:upcoming" className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                {dict.upcomingSectionLabel}
              </p>
            )}
            {upcomingTasks.map((task) => (
              <TaskItemRow
                key={task.id}
                task={task}
                upcoming
                members={members}
                pantryItems={pantryItems}
                memberNameById={memberNameById}
                onToggleCompleted={toggleCompleted}
                onDelete={deleteTask}
                onSkip={skipTask}
                dict={dict}
                locale={locale}
                timeZone={timeZone}
                today={today}
              />
            ))}
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
                pantryItems={pantryItems}
                memberNameById={memberNameById}
                onToggleCompleted={toggleCompleted}
                onDelete={deleteTask}
                onSkip={skipTask}
                dict={dict}
                locale={locale}
                timeZone={timeZone}
                today={today}
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
  upcoming = false,
  members,
  pantryItems,
  memberNameById,
  onToggleCompleted,
  onDelete,
  onSkip,
  dict,
  locale,
  timeZone,
  today,
}: {
  task: TaskRow;
  /** Weekly days: never done and its first day still ahead (see TasksClient). */
  upcoming?: boolean;
  members: MemberOption[];
  pantryItems: PantryItemOption[];
  memberNameById: Map<string, string>;
  onToggleCompleted: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => void;
  onSkip: (task: TaskRow) => void;
  dict: TasksDict;
  locale: Locale;
  timeZone: string;
  /** Today's local day number, for how late a task is. */
  today: number;
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

  const assigneeName = task.assignedToMemberId ? memberNameById.get(task.assignedToMemberId) : undefined;
  const completerName = task.completedByMemberId ? memberNameById.get(task.completedByMemberId) : undefined;
  const nextInRotationName = task.nextInRotationMemberId
    ? memberNameById.get(task.nextInRotationMemberId)
    : undefined;
  const repeatText = task.recurrenceIntervalDays
    ? recurrenceText(task.recurrenceIntervalDays, dict.recurrenceBadge, dict.recurrenceNamedBadge)
    : null;
  // Weekly days: "Repeats every 7 days on Saturdays".
  const recurrenceLabel =
    repeatText && task.recurrenceWeekday !== null
      ? format(dict.recurrenceOnWeekday, {
          repeat: repeatText,
          day: dict.weekdayBadge[WEEKDAY_KEYS[task.recurrenceWeekday] ?? "mon"],
        })
      : repeatText;
  // Only meaningful while the task is still shown completed — a recurring
  // task's `completedAt` also sticks around once it's auto-reopened past its
  // interval (see recurrence.ts), at which point "next due" would be a date
  // in the past, which isn't worth surfacing.
  const nextDueAt = task.completed ? getNextDueDate(task, timeZone) : null;
  // GAP-84: a yearly chore's next due falls on today's date next year, so a
  // date in another year than today's names the year; "Next due 19 Nov"
  // would read as today.
  const nextDueInOtherYear =
    nextDueAt !== null &&
    Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(nextDueAt)) !==
      new Date(today * 24 * 60 * 60 * 1000).getUTCFullYear();
  const nextDueLabel = nextDueAt
    ? format(dict.nextDueLabel, {
        date: new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          ...(nextDueInOtherYear && { year: "numeric" }),
          timeZone,
        }).format(nextDueAt),
      })
    : null;

  // UX-133: a late open task says how late; a one-off with a date says when
  // it is due. A repeat's own due day is its schedule, which the Repeat badge
  // already names, so it only ever shows as overdue.
  const urgency = task.completed ? "none" : getTaskUrgency(task.dueDay, today);
  const overdueDays = urgency === "overdue" ? daysOverdue(task.dueDay, today) : 0;
  // A calendar day, not an instant: format it in UTC so no zone shifts it.
  const dayText = (day: number) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(day * 24 * 60 * 60 * 1000),
    );
  // Weekly days: an upcoming repeat says when it starts.
  const startsLabel = upcoming && task.dueDay !== null ? format(dict.startsLabel, { date: dayText(task.dueDay) }) : null;
  const dueLabel =
    task.completed || urgency === "overdue" || task.dueDate === null || task.dueDay === null
      ? null
      : urgency === "today"
        ? dict.dueTodayLabel
        : format(dict.dueLabel, { date: dayText(task.dueDay) });

  const hasDetails =
    overdueDays > 0 ||
    dueLabel !== null ||
    startsLabel !== null ||
    recurrenceLabel !== null ||
    nextDueLabel !== null ||
    nextInRotationName !== undefined ||
    task.completed ||
    completerName !== undefined;
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const skipButtonRef = useRef<HTMLButtonElement>(null);
  // Nothing to skip before an upcoming repeat has started.
  const canSkip = !task.completed && !upcoming && task.recurrenceIntervalDays !== null;

  return (
    <SwipeRow
      className="list-bleed rounded-md"
      flipKey={task.id}
      primaryLabel={completed ? dict.swipe.reopen : dict.swipe.complete}
      primaryIcon={<Check className="size-4" />}
      editLabel={dict.swipe.edit}
      deleteLabel={dict.swipe.delete}
      onDelete={() => onDelete(task)}
    >
      <div data-shortcut-row className="flex items-center gap-3 rounded-md border px-3 py-1 sm:py-2">
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
          {/* GAP-73: one truncated line of detail; the full text is in the
              sheet the title opens. Plain text, so a pasted link stays text. */}
          {task.notes && (
            <p className="truncate pb-1 text-xs text-muted-foreground sm:pb-0" title={task.notes}>
              {task.notes}
            </p>
          )}
          {hasDetails && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pb-1 text-xs text-muted-foreground sm:pb-0">
              {overdueDays > 0 && <TaskOverdueBadge days={overdueDays} label={dict.overdueLabel} />}
              {dueLabel && <span>{dueLabel}</span>}
              {startsLabel && <span>{startsLabel}</span>}
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
              {task.skipped && <span>{dict.skippedLabel}</span>}
              {task.completed && !task.skipped && (
                <span>{format(dict.completedByLabel, { name: completerName ?? dict.unassignedBadge })}</span>
              )}
              {/* An open task can still carry a completedByMemberId from before it
                  was reopened (manually, or automatically once its recurrence
                  interval elapsed — see toggleTaskCompletedAction/recurrence.ts):
                  that's real "last done by" history, not stale data, so surface it
                  rather than letting it silently disappear once the task reopens. */}
              {(!task.completed || task.skipped) && completerName && (
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
            pantryItems={pantryItems}
            dict={dict}
            onDelete={() => deleteButtonRef.current?.click()}
            onSkip={canSkip ? () => skipButtonRef.current?.click() : undefined}
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
          {/* GAP-60: only a repeating task that is open can be skipped. From sm
              up it is this icon; on a phone the edit sheet carries the button
              (same hand-off as Delete), so the row stays one line. */}
          {canSkip && (
            <Button
              ref={skipButtonRef}
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground max-sm:hidden"
              aria-label={format(dict.skipTaskAriaLabel, { title: task.title })}
              onClick={() => onSkip(task)}
            >
              <SkipForward className="size-3.5" />
            </Button>
          )}
          {/* UX-49: removes at once with the same Undo toast as the swipe,
              not a "can't be undone" confirm for a task that is one tap to
              add back. */}
          <Button
            ref={deleteButtonRef}
            variant="ghost"
            size="icon"
            data-row-delete
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive max-sm:hidden"
            aria-label={format(dict.deleteTaskAriaLabel, { title: task.title })}
            onClick={() => onDelete(task)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </SwipeRow>
  );
}
