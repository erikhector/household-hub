// GAP-38: round-robin ("take turns") rotation for recurring household tasks.
// The whole feature is "whose turn is it" — deliberately no counts, scores or
// streaks (see REQUIREMENTS.md, "Household tasks"). This file is the one
// place the "who's next" rule lives, so the toggle action (which advances the
// assignee on completion) and the tasks page (which shows "Next: …") can
// never disagree about it.
//
// `rotation` is HouseholdTask.rotationMemberIds as stored. It has no FK (see
// the schema comment), so it can still hold ids of members who have since
// left the household; `activeMemberIds` is the household's current member
// ids and anyone not in it is skipped.

/** Fewest members a rotation can have — one person "taking turns" is just an assignee. */
export const MIN_ROTATION_MEMBERS = 2;
/** Upper bound on a rotation's length, so a forged request can't store an arbitrary array. */
export const MAX_ROTATION_MEMBERS = 20;

/**
 * A task only rotates when it repeats and has at least two people taking
 * turns. The actions never store anything else, but this is also the
 * read-side check (toggle, tasks page), so a hand-edited row can't make a
 * one-off task rotate.
 */
export function isRotating(task: { recurrenceIntervalDays: number | null; rotationMemberIds: readonly string[] }): boolean {
  return task.recurrenceIntervalDays !== null && task.rotationMemberIds.length >= MIN_ROTATION_MEMBERS;
}

/**
 * Who gets the task after `currentAssigneeId` has had their turn.
 *
 * - Walks forward from the current assignee's slot, wrapping around, and
 *   returns the first member who is still in the household. A departed
 *   member's slot still counts as a position (so the member after them is
 *   next), they just never get picked.
 * - Current assignee not in the rotation at all (unassigned, or someone
 *   picked by hand): the rotation starts from its first active member.
 * - Only one active member left: it's always their turn.
 * - Nobody active in the rotation (empty list, or everyone left): the
 *   assignee stays as it is if they're still a member, otherwise null.
 */
export function nextAssigneeInRotation({
  rotation,
  currentAssigneeId,
  activeMemberIds,
}: {
  rotation: readonly string[];
  currentAssigneeId: string | null;
  activeMemberIds: Iterable<string>;
}): string | null {
  const active = new Set(activeMemberIds);
  const isActive = (id: string) => active.has(id);

  if (!rotation.some(isActive)) {
    return currentAssigneeId !== null && isActive(currentAssigneeId) ? currentAssigneeId : null;
  }

  const currentIndex = currentAssigneeId === null ? -1 : rotation.indexOf(currentAssigneeId);
  if (currentIndex === -1) {
    return rotation.find(isActive) ?? null;
  }

  for (let step = 1; step <= rotation.length; step++) {
    const candidate = rotation[(currentIndex + step) % rotation.length];
    if (isActive(candidate)) return candidate;
  }
  // Unreachable: the some(isActive) check above guarantees a hit within one lap.
  return null;
}

/**
 * The rotation as it should be offered for editing: current members only,
 * each once, in stored order. Used to seed the edit dialog so saving a task
 * quietly drops anyone who has left the household.
 */
export function activeRotationMembers(rotation: readonly string[], activeMemberIds: Iterable<string>): string[] {
  const active = new Set(activeMemberIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of rotation) {
    if (active.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
