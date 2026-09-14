import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { TasksClient } from "@/components/tasks/tasks-client";
import { computeWeeklyTaskRecap } from "@/app/dashboard/tasks/weekly-recap-calc";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";

export default async function TasksPage() {
  const [{ household }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

  const [tasks, householdMembers] = await Promise.all([
    prisma.householdTask.findMany({
      where: { householdId: household.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.householdMember.findMany({
      where: { householdId: household.id },
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
  const recapGroups = computeWeeklyTaskRecap({ tasks: completedThisWeek, now });

  return (
    <TasksClient
      dict={dict.tasks}
      members={memberOptions}
      tasks={tasks.map((t) => ({
        id: t.id,
        title: t.title,
        assignedToMemberId: t.assignedToMemberId,
        completedByMemberId: t.completedByMemberId,
        completed: !isTaskOpen(t, now),
        recurrenceIntervalDays: t.recurrenceIntervalDays,
      }))}
      recapGroups={recapGroups.map((g) => ({
        memberName: g.completedByMemberId ? (memberNameById.get(g.completedByMemberId) ?? null) : null,
        titles: g.titles,
      }))}
    />
  );
}
