// UX-106: the Tasks page's "Mine / Everyone" filter. Pure, so the rule
// ("mine" is the tasks assigned to you, nothing cleverer) is tested without
// a browser; TasksClient remembers the choice in localStorage
// (TASKS_FILTER_STORAGE_KEY in src/lib/cookie-inventory.ts).

export type TaskFilter = "mine" | "everyone";

/** Anything but a stored "mine" (nothing stored, a stale or foreign value) means everyone. */
export function parseTaskFilter(raw: string | null): TaskFilter {
  return raw === "mine" ? "mine" : "everyone";
}

/**
 * The tasks a filter shows. "Mine" is the tasks assigned to this member, open
 * or completed; unassigned tasks belong to nobody, so they only show under
 * "Everyone". Without a member id (a viewer who isn't in this household's
 * roster) there is no "mine", so every task shows.
 */
export function filterTasks<T extends { assignedToMemberId: string | null }>(
  tasks: T[],
  filter: TaskFilter,
  currentMemberId: string | null,
): T[] {
  if (filter !== "mine" || !currentMemberId) return tasks;
  return tasks.filter((t) => t.assignedToMemberId === currentMemberId);
}
