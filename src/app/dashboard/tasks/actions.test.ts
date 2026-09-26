// Tests the module-private Zod schema plus every IDOR guard in
// src/app/dashboard/tasks/actions.ts, indirectly through the exported Server
// Actions. All I/O (Prisma, requireHousehold, next/cache) is mocked — no
// database is touched. Same convention as src/lib/actions/household.test.ts
// and src/app/dashboard/shopping-list/actions.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  householdTaskCreateMock,
  householdTaskFindFirstMock,
  householdTaskUpdateMock,
  householdTaskUpdateManyMock,
  householdTaskDeleteManyMock,
  householdMemberFindFirstMock,
  householdMemberFindManyMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  householdTaskCreateMock: vi.fn(),
  householdTaskFindFirstMock: vi.fn(),
  householdTaskUpdateMock: vi.fn(),
  householdTaskUpdateManyMock: vi.fn(),
  householdTaskDeleteManyMock: vi.fn(),
  householdMemberFindFirstMock: vi.fn(),
  householdMemberFindManyMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    householdTask: {
      create: householdTaskCreateMock,
      findFirst: householdTaskFindFirstMock,
      update: householdTaskUpdateMock,
      updateMany: householdTaskUpdateManyMock,
      deleteMany: householdTaskDeleteManyMock,
    },
    householdMember: { findFirst: householdMemberFindFirstMock, findMany: householdMemberFindManyMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { createTaskAction, updateTaskAction, toggleTaskCompletedAction, deleteTaskAction } = await import(
  "@/app/dashboard/tasks/actions"
);

const household = { id: "household-1", name: "The Hectors" };

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

// The rotation fields toggleTaskCompletedAction selects, for a task that
// doesn't take turns.
const notRotating = { assignedToMemberId: null, rotationMemberIds: [], rotationPreviousAssigneeId: null };

afterEach(() => {
  vi.clearAllMocks();
});

describe("createTaskAction", () => {
  it("rejects an empty title", async () => {
    requireHouseholdMock.mockResolvedValue({ household });

    const result = await createTaskAction({}, formData({ title: "  " }));

    expect(result.error).toBe("Title is required");
    expect(householdTaskCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a title over 120 characters", async () => {
    requireHouseholdMock.mockResolvedValue({ household });

    const result = await createTaskAction({}, formData({ title: "x".repeat(121) }));

    expect(result.error).toBe("Title must be 120 characters or fewer");
    expect(householdTaskCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an assignedToMemberId that belongs to a different household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    // Scoped findFirst: a member row actually belonging to another
    // household would never match household-1 and resolves to null.
    householdMemberFindFirstMock.mockResolvedValue(null);

    const result = await createTaskAction(
      {},
      formData({ title: "Take out the bins", assignedToMemberId: "member-in-other-household" }),
    );

    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { id: "member-in-other-household", householdId: "household-1" },
      select: { id: true },
    });
    expect(result.error).toBe("Member not found");
    expect(householdTaskCreateMock).not.toHaveBeenCalled();
  });

  it("creates an unassigned task on the happy path", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskCreateMock.mockResolvedValue({ id: "task-1" });

    const result = await createTaskAction({}, formData({ title: "Water the plants" }));

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).not.toHaveBeenCalled();
    expect(householdTaskCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        title: "Water the plants",
        assignedToMemberId: null,
        recurrenceIntervalDays: null,
        rotationMemberIds: [],
        rotationPreviousAssigneeId: null,
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/tasks");
  });

  it("creates an assigned task when the member is validated", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-2" });
    householdTaskCreateMock.mockResolvedValue({ id: "task-1" });

    const result = await createTaskAction(
      {},
      formData({ title: "Run the dishwasher", assignedToMemberId: "member-2" }),
    );

    expect(result.error).toBeUndefined();
    expect(householdTaskCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        title: "Run the dishwasher",
        assignedToMemberId: "member-2",
        recurrenceIntervalDays: null,
        rotationMemberIds: [],
        rotationPreviousAssigneeId: null,
      },
    });
  });

  it("creates a recurring task with a validated interval", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskCreateMock.mockResolvedValue({ id: "task-1" });

    const result = await createTaskAction(
      {},
      formData({ title: "Laundry", recurrenceIntervalDays: "3" }),
    );

    expect(result.error).toBeUndefined();
    expect(householdTaskCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        title: "Laundry",
        assignedToMemberId: null,
        recurrenceIntervalDays: 3,
        rotationMemberIds: [],
        rotationPreviousAssigneeId: null,
      },
    });
  });

  it("rejects a recurrence interval outside the 1-90 day range", async () => {
    requireHouseholdMock.mockResolvedValue({ household });

    const result = await createTaskAction(
      {},
      formData({ title: "Laundry", recurrenceIntervalDays: "0" }),
    );

    expect(result.error).toBe("Repeat interval must be at least 1 day");
    expect(householdTaskCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateTaskAction", () => {
  it("rejects a task id that belongs to a different household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue(null);

    const result = await updateTaskAction("task-in-other-household", {
      assignedToMemberId: null,
      recurrenceIntervalDays: null,
      rotationMemberIds: [],
    });

    expect(householdTaskFindFirstMock).toHaveBeenCalledWith({
      where: { id: "task-in-other-household", householdId: "household-1" },
      select: { id: true },
    });
    expect(result.error).toBe("Task not found");
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an assignedToMemberId that belongs to a different household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1" });
    householdMemberFindFirstMock.mockResolvedValue(null);

    const result = await updateTaskAction("task-1", {
      assignedToMemberId: "member-in-other-household",
      recurrenceIntervalDays: null,
      rotationMemberIds: [],
    });

    expect(result.error).toBe("Member not found");
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
  });

  it("reassigns a task and sets its recurrence on the happy path", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1" });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-2" });

    const result = await updateTaskAction("task-1", {
      assignedToMemberId: "member-2",
      recurrenceIntervalDays: 3,
      rotationMemberIds: [],
    });

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        assignedToMemberId: "member-2",
        recurrenceIntervalDays: 3,
        rotationMemberIds: [],
        rotationPreviousAssigneeId: null,
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/tasks");
  });

  it("clears the assignee and recurrence when both are set to null", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1" });

    const result = await updateTaskAction("task-1", {
      assignedToMemberId: null,
      recurrenceIntervalDays: null,
      rotationMemberIds: [],
    });

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).not.toHaveBeenCalled();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        assignedToMemberId: null,
        recurrenceIntervalDays: null,
        rotationMemberIds: [],
        rotationPreviousAssigneeId: null,
      },
    });
  });
});

describe("toggleTaskCompletedAction", () => {
  it("rejects a task id that belongs to a different household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue(null);

    const result = await toggleTaskCompletedAction("task-in-other-household");

    expect(householdTaskFindFirstMock).toHaveBeenCalledWith({
      where: { id: "task-in-other-household", householdId: "household-1" },
      select: {
        id: true,
        completedAt: true,
        recurrenceIntervalDays: true,
        assignedToMemberId: true,
        rotationMemberIds: true,
        rotationPreviousAssigneeId: true,
      },
    });
    expect(result.error).toBe("Task not found");
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
  });

  it("completes an open task, attributing it to the caller's own member id", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({ ...notRotating, id: "task-1", completedAt: null, recurrenceIntervalDays: null });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", userId: "user-1" },
      select: { id: true },
    });
    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt: null },
      data: { completedAt: expect.any(Date), completedByMemberId: "member-1" },
    });
  });

  it("re-opens a completed, non-recurring task, preserving completedByMemberId as 'last done by' history", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      ...notRotating,
      id: "task-1",
      completedAt: new Date(),
      recurrenceIntervalDays: null,
    });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).not.toHaveBeenCalled();
    // Only completedAt is cleared — completedByMemberId is intentionally
    // left out of the update so the previous completer's id survives the
    // toggle (there's no separate history field to move it to).
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { completedAt: null },
    });
  });

  it("re-opens a recurring task still within its interval, same as a non-recurring one", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      ...notRotating,
      id: "task-1",
      completedAt: new Date(),
      recurrenceIntervalDays: 3,
    });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { completedAt: null },
    });
  });

  it("treats a recurring task whose interval has elapsed as open, completing it again", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      ...notRotating,
      id: "task-1",
      completedAt: new Date("2020-01-01T00:00:00.000Z"),
      recurrenceIntervalDays: 3,
    });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt: new Date("2020-01-01T00:00:00.000Z") },
      data: { completedAt: expect.any(Date), completedByMemberId: "member-1" },
    });
  });
});

describe("task rotation (GAP-38)", () => {
  function rotationForm(fields: Record<string, string>, rotation: string[]) {
    const fd = formData(fields);
    for (const id of rotation) fd.append("rotationMemberIds", id);
    return fd;
  }

  it("creates a rotating task, defaulting the assignee to the first person in line", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-2" }, { id: "member-1" }]);
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-2" });

    const result = await createTaskAction(
      {},
      rotationForm({ title: "Bins", recurrenceIntervalDays: "7" }, ["member-2", "member-1"]),
    );

    expect(result.error).toBeUndefined();
    expect(householdMemberFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["member-2", "member-1"] }, householdId: "household-1" },
      select: { id: true },
    });
    expect(householdTaskCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        title: "Bins",
        assignedToMemberId: "member-2",
        recurrenceIntervalDays: 7,
        rotationMemberIds: ["member-2", "member-1"],
        rotationPreviousAssigneeId: "member-2",
      },
    });
  });

  it("rejects a rotation on a task that doesn't repeat", async () => {
    requireHouseholdMock.mockResolvedValue({ household });

    const result = await createTaskAction({}, rotationForm({ title: "Bins" }, ["member-1", "member-2"]));

    expect(result.error).toBe("Only repeating tasks can take turns");
    expect(householdTaskCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a one-person rotation", async () => {
    requireHouseholdMock.mockResolvedValue({ household });

    const result = await createTaskAction(
      {},
      rotationForm({ title: "Bins", recurrenceIntervalDays: "7" }, ["member-1"]),
    );

    expect(result.error).toBe("Pick at least two people to take turns");
    expect(householdTaskCreateMock).not.toHaveBeenCalled();
  });

  it("rejects the same person twice in a rotation", async () => {
    requireHouseholdMock.mockResolvedValue({ household });

    const result = await createTaskAction(
      {},
      rotationForm({ title: "Bins", recurrenceIntervalDays: "7" }, ["member-1", "member-1"]),
    );

    expect(result.error).toBe("Each person can only take turns once");
    expect(householdTaskCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a rotation member from another household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1" });
    // Scoped findMany: the forged id never matches household-1.
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }]);

    const result = await updateTaskAction("task-1", {
      assignedToMemberId: null,
      recurrenceIntervalDays: 7,
      rotationMemberIds: ["member-1", "member-in-other-household"],
    });

    expect(householdMemberFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["member-1", "member-in-other-household"] }, householdId: "household-1" },
      select: { id: true },
    });
    expect(result.error).toBe("Member not found");
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an assignee who isn't taking turns", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);

    const result = await updateTaskAction("task-1", {
      assignedToMemberId: "member-3",
      recurrenceIntervalDays: 7,
      rotationMemberIds: ["member-1", "member-2"],
    });

    expect(result.error).toBe("The person assigned must be one of the people taking turns");
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
  });

  it("an edit resets the undo point to the assignee it saves", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-2" });

    const result = await updateTaskAction("task-1", {
      assignedToMemberId: "member-2",
      recurrenceIntervalDays: 7,
      rotationMemberIds: ["member-1", "member-2"],
    });

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        assignedToMemberId: "member-2",
        recurrenceIntervalDays: 7,
        rotationMemberIds: ["member-1", "member-2"],
        rotationPreviousAssigneeId: "member-2",
      },
    });
  });

  it("completing a rotating task passes it to the next person and remembers who had it", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: null,
      recurrenceIntervalDays: 7,
      assignedToMemberId: "member-3",
      rotationMemberIds: ["member-1", "member-2", "member-3"],
      rotationPreviousAssigneeId: "member-2",
    });
    // The caller (member-1) completes member-3's turn.
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }, { id: "member-3" }]);

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdMemberFindManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1" },
      select: { id: true },
    });
    // Advances from the assignee (wrapping to member-1), not the completer.
    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt: null },
      data: {
        completedAt: expect.any(Date),
        completedByMemberId: "member-1",
        assignedToMemberId: "member-1",
        rotationPreviousAssigneeId: "member-3",
      },
    });
  });

  it("skips a member who has left when passing the task on", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: new Date("2020-01-01T00:00:00.000Z"),
      recurrenceIntervalDays: 7,
      assignedToMemberId: "member-1",
      rotationMemberIds: ["member-1", "member-gone", "member-3"],
      rotationPreviousAssigneeId: null,
    });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-3" }]);

    await toggleTaskCompletedAction("task-1");

    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt: new Date("2020-01-01T00:00:00.000Z") },
      data: expect.objectContaining({ assignedToMemberId: "member-3", rotationPreviousAssigneeId: "member-1" }),
    });
  });

  it("un-completing a rotating task hands the turn back instead of advancing again", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: new Date(),
      recurrenceIntervalDays: 7,
      assignedToMemberId: "member-2",
      rotationMemberIds: ["member-1", "member-2"],
      rotationPreviousAssigneeId: "member-1",
    });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { id: "member-1", householdId: "household-1" },
      select: { id: true },
    });
    expect(householdMemberFindManyMock).not.toHaveBeenCalled();
    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt: expect.any(Date) },
      data: { completedAt: null, assignedToMemberId: "member-1" },
    });
  });

  it("un-completing leaves the task unassigned if the previous person has left", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: new Date(),
      recurrenceIntervalDays: 7,
      assignedToMemberId: "member-2",
      rotationMemberIds: ["member-gone", "member-2"],
      rotationPreviousAssigneeId: "member-gone",
    });
    householdMemberFindFirstMock.mockResolvedValue(null);

    await toggleTaskCompletedAction("task-1");

    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt: expect.any(Date) },
      data: { completedAt: null, assignedToMemberId: null },
    });
  });

  it("a second completion that lost the race is a no-op success, not a second advance", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    // Both requests read the task while it was still open on member-1's turn...
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: null,
      recurrenceIntervalDays: 7,
      assignedToMemberId: "member-1",
      rotationMemberIds: ["member-1", "member-2", "member-3"],
      rotationPreviousAssigneeId: null,
    });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }, { id: "member-3" }]);
    // ...but the other one already wrote, so this conditional write matches nothing.
    householdTaskUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    // The write is guarded on the completedAt that was read, so it can
    // only ever advance member-1 -> member-2 once.
    expect(householdTaskUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt: null },
      data: expect.objectContaining({ assignedToMemberId: "member-2", rotationPreviousAssigneeId: "member-1" }),
    });
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/tasks");
  });

  it("an undo that lost the race is a no-op success", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    const completedAt = new Date();
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt,
      recurrenceIntervalDays: 7,
      assignedToMemberId: "member-2",
      rotationMemberIds: ["member-1", "member-2"],
      rotationPreviousAssigneeId: "member-1",
    });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    householdTaskUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task-1", householdId: "household-1", completedAt },
      data: { completedAt: null, assignedToMemberId: "member-1" },
    });
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
  });
});

describe("deleteTaskAction", () => {
  it("is scoped to the caller's household (never a bare id delete)", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskDeleteManyMock.mockResolvedValue({ count: 0 });

    const result = await deleteTaskAction("task-in-other-household");

    expect(householdTaskDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "task-in-other-household", householdId: "household-1" },
    });
    expect(result.error).toBeUndefined();
  });

  it("deletes a task on the happy path", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskDeleteManyMock.mockResolvedValue({ count: 1 });

    const result = await deleteTaskAction("task-1");

    expect(result.error).toBeUndefined();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/tasks");
  });
});
