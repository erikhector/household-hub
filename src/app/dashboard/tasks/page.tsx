import { Suspense, cache } from "react";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getTimeZone } from "@/lib/get-time-zone";
import { getDictionary, getLocale, type Dictionary, type Locale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TasksClient } from "@/components/tasks/tasks-client";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";
import { formatDueDateInput, getTaskDueDay } from "@/app/dashboard/tasks/task-due";
import { activeRotationMembers, isRotating, nextAssigneeInRotation } from "@/lib/task-rotation";
import { PageTitle } from "@/components/dashboard/page-title";
import { PrimaryAction } from "@/components/dashboard/primary-action";

// The task list (and the member roster the "Add task"/edit dialogs need) is
// the one per-request DB round trip on this page — see getInventoryData in
// the inventory page for the same convention. Wrapped in `cache()` so the
// "Add task" button and the list below (both Suspense-isolated, see
// TasksPage) share one query instead of one each.
const getTasksData = cache(async (householdId: string) => {
  const [tasks, householdMembers] = await Promise.all([
    prisma.householdTask.findMany({
      where: { householdId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.householdMember.findMany({
      where: { householdId },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const memberOptions = householdMembers.map((m) => ({ id: m.id, displayName: m.user.displayName }));
  const activeMemberIds = memberOptions.map((m) => m.id);

  const now = new Date();
  const timeZone = await getTimeZone();

  return {
    timeZone,
    memberOptions,
    memberIdByUserId: new Map(householdMembers.map((m) => [m.userId, m.id])),
    // The weekly recap is worked out in TasksClient (UX-33: so a tick shows
    // in it at tap time), against the server's clock for the week.
    now,
    tasks: tasks.map((t) => {
      const completed = !isTaskOpen(t, now, timeZone);
      // GAP-38: who's up after the current turn. A completed rotating task
      // has already been passed on (toggleTaskCompletedAction advances on
      // completion), so its assignee *is* who's next; an open one is still
      // on its assignee's turn, so "next" is whoever follows them.
      const nextInRotationMemberId = isRotating(t)
        ? completed
          ? t.assignedToMemberId
          : nextAssigneeInRotation({
              rotation: t.rotationMemberIds,
              currentAssigneeId: t.assignedToMemberId,
              activeMemberIds,
            })
        : null;
      return {
        id: t.id,
        title: t.title,
        assignedToMemberId: t.assignedToMemberId,
        completedByMemberId: t.completedByMemberId,
        completed,
        recurrenceIntervalDays: t.recurrenceIntervalDays,
        completedAt: t.completedAt,
        recurrenceAnchorAt: t.recurrenceAnchorAt,
        // UX-133: the local day it is due (stored for a one-off, derived from
        // the schedule for a repeat), and the one-off's date for the edit form.
        dueDay: getTaskDueDay(t, timeZone),
        dueDate: t.recurrenceIntervalDays === null && t.dueDate ? formatDueDateInput(t.dueDate) : null,
        createdAt: t.createdAt,
        // Current members only, so the edit dialog never offers (or
        // re-saves) someone who has left the household.
        rotationMemberIds: activeRotationMembers(t.rotationMemberIds, activeMemberIds),
        nextInRotationMemberId,
      };
    }),
  };
});

function addTaskDialog(memberOptions: { id: string; displayName: string }[],dict: Dictionary["tasks"]) {
  return (
    <TaskFormDialog
      mode="create"
      members={memberOptions}
      dict={dict}
      trigger={
        <Button className="gap-1.5">
          <Plus className="size-4" />
          {/* Visible at every width: on a phone this is the page's one primary
              action, and a lone "+" in a full-width bar names nothing (UX-4). */}
          <span>{dict.addTask}</span>
        </Button>
      }
    />
  );
}

// UX-50: with no tasks at all the empty state below holds "Add task" (see
// TasksClient), so the header leaves it out: one primary on screen, not two.
async function AddTaskButton({ householdId, dict }: { householdId: string; dict: Dictionary["tasks"] }) {
  const { memberOptions, tasks } = await getTasksData(householdId);
  if (tasks.length === 0) return null;
  return <PrimaryAction>{addTaskDialog(memberOptions, dict)}</PrimaryAction>;
}

function TasksListSkeleton({ label }: { label: string }) {
  return (
    <div className="list-bleed flex animate-pulse flex-col gap-2" role="status" aria-label={label}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 rounded-md border bg-muted/40" />
      ))}
    </div>
  );
}

async function TasksSection({
  householdId,
  userId,
  dict,
  locale,
}: {
  householdId: string;
  userId: string;
  dict: Dictionary["tasks"];
  locale: Locale;
}) {
  const { tasks, memberOptions, memberIdByUserId, now, timeZone } = await getTasksData(householdId);
  return (
    <TasksClient
      dict={dict}
      members={memberOptions}
      currentMemberId={memberIdByUserId.get(userId) ?? null}
      tasks={tasks}
      now={now}
      timeZone={timeZone}
      locale={locale}
      emptyAction={tasks.length === 0 ? addTaskDialog(memberOptions, dict) : undefined}
    />
  );
}

export default async function TasksPage() {
  const [{ household, userId }, dict, locale] = await Promise.all([requireHousehold(), getDictionary(), getLocale()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageTitle>{dict.tasks.title}</PageTitle>
          <p className="text-sm text-muted-foreground">{dict.tasks.subtitle}</p>
        </div>
        <Suspense
          fallback={
            <PrimaryAction>
              <div className="h-9 w-28 animate-pulse rounded-md bg-muted max-sm:h-12 max-sm:rounded-full" aria-hidden="true" />
            </PrimaryAction>
          }
        >
          <AddTaskButton householdId={household.id} dict={dict.tasks} />
        </Suspense>
      </div>
      <Suspense fallback={<TasksListSkeleton label={dict.common.loading} />}>
        <TasksSection householdId={household.id} userId={userId} dict={dict.tasks} locale={locale} />
      </Suspense>
    </div>
  );
}
