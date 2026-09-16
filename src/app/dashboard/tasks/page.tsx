import { Suspense, cache } from "react";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, type Dictionary } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TasksClient } from "@/components/tasks/tasks-client";
import { computeWeeklyTaskRecap } from "@/app/dashboard/tasks/weekly-recap-calc";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";

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
  const memberNameById = new Map(memberOptions.map((m) => [m.id, m.displayName]));

  const now = new Date();
  const completedThisWeek = tasks
    .filter((t) => t.completedAt !== null)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())
    .map((t) => ({ title: t.title, completedAt: t.completedAt, completedByMemberId: t.completedByMemberId }));
  const recapGroups = computeWeeklyTaskRecap({ tasks: completedThisWeek, now }).map((g) => ({
    memberName: g.completedByMemberId ? (memberNameById.get(g.completedByMemberId) ?? null) : null,
    titles: g.titles,
  }));

  return {
    memberOptions,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      assignedToMemberId: t.assignedToMemberId,
      completedByMemberId: t.completedByMemberId,
      completed: !isTaskOpen(t, now),
      recurrenceIntervalDays: t.recurrenceIntervalDays,
    })),
    recapGroups,
  };
});

async function AddTaskButton({ householdId, dict }: { householdId: string; dict: Dictionary["tasks"] }) {
  const { memberOptions } = await getTasksData(householdId);
  return (
    <TaskFormDialog
      mode="create"
      members={memberOptions}
      dict={dict}
      trigger={
        <Button className="gap-1.5">
          <Plus className="size-4" />
          <span className="sr-only sm:not-sr-only">{dict.addTask}</span>
        </Button>
      }
    />
  );
}

function TasksListSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 rounded-md border bg-muted/40" />
      ))}
    </div>
  );
}

async function TasksSection({ householdId, dict }: { householdId: string; dict: Dictionary["tasks"] }) {
  const { tasks, memberOptions, recapGroups } = await getTasksData(householdId);
  return <TasksClient dict={dict} members={memberOptions} tasks={tasks} recapGroups={recapGroups} />;
}

export default async function TasksPage() {
  const [{ household }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.tasks.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.tasks.subtitle}</p>
        </div>
        <Suspense fallback={<div className="h-9 w-28 animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
          <AddTaskButton householdId={household.id} dict={dict.tasks} />
        </Suspense>
      </div>
      <Suspense fallback={<TasksListSkeleton />}>
        <TasksSection householdId={household.id} dict={dict.tasks} />
      </Suspense>
    </div>
  );
}
