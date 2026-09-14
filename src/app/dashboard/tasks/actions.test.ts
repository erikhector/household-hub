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
  householdTaskDeleteManyMock,
  householdMemberFindFirstMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  householdTaskCreateMock: vi.fn(),
  householdTaskFindFirstMock: vi.fn(),
  householdTaskUpdateMock: vi.fn(),
  householdTaskDeleteManyMock: vi.fn(),
  householdMemberFindFirstMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    householdTask: {
      create: householdTaskCreateMock,
      findFirst: householdTaskFindFirstMock,
      update: householdTaskUpdateMock,
      deleteMany: householdTaskDeleteManyMock,
    },
    householdMember: { findFirst: householdMemberFindFirstMock },
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
    });

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { assignedToMemberId: "member-2", recurrenceIntervalDays: 3 },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/tasks");
  });

  it("clears the assignee and recurrence when both are set to null", async () => {
    requireHouseholdMock.mockResolvedValue({ household });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1" });

    const result = await updateTaskAction("task-1", {
      assignedToMemberId: null,
      recurrenceIntervalDays: null,
    });

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).not.toHaveBeenCalled();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { assignedToMemberId: null, recurrenceIntervalDays: null },
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
      select: { id: true, completedAt: true, recurrenceIntervalDays: true },
    });
    expect(result.error).toBe("Task not found");
    expect(householdTaskUpdateMock).not.toHaveBeenCalled();
  });

  it("completes an open task, attributing it to the caller's own member id", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({ id: "task-1", completedAt: null, recurrenceIntervalDays: null });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", userId: "user-1" },
      select: { id: true },
    });
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { completedAt: expect.any(Date), completedByMemberId: "member-1" },
    });
  });

  it("re-opens a completed, non-recurring task and clears its completedByMemberId", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: new Date(),
      recurrenceIntervalDays: null,
    });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdMemberFindFirstMock).not.toHaveBeenCalled();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { completedAt: null, completedByMemberId: null },
    });
  });

  it("re-opens a recurring task still within its interval, same as a non-recurring one", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: new Date(),
      recurrenceIntervalDays: 3,
    });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { completedAt: null, completedByMemberId: null },
    });
  });

  it("treats a recurring task whose interval has elapsed as open, completing it again", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdTaskFindFirstMock.mockResolvedValue({
      id: "task-1",
      completedAt: new Date("2020-01-01T00:00:00.000Z"),
      recurrenceIntervalDays: 3,
    });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });

    const result = await toggleTaskCompletedAction("task-1");

    expect(result.error).toBeUndefined();
    expect(householdTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { completedAt: expect.any(Date), completedByMemberId: "member-1" },
    });
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
