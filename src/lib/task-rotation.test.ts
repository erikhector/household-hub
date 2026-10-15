import { describe, expect, it } from "vitest";
import { activeRotationMembers, isRotating, nextAssigneeInRotation, withLocalCompletion } from "@/lib/task-rotation";

const everyone = ["anna", "bo", "cleo"];

describe("nextAssigneeInRotation", () => {
  it("advances to the next member in order", () => {
    expect(nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: "anna", activeMemberIds: everyone })).toBe(
      "bo",
    );
    expect(nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: "bo", activeMemberIds: everyone })).toBe(
      "cleo",
    );
  });

  it("wraps around from the last member to the first", () => {
    expect(nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: "cleo", activeMemberIds: everyone })).toBe(
      "anna",
    );
  });

  it("starts from the first member when the current assignee isn't in the rotation", () => {
    expect(
      nextAssigneeInRotation({ rotation: ["bo", "cleo"], currentAssigneeId: "anna", activeMemberIds: everyone }),
    ).toBe("bo");
  });

  it("starts from the first member when the task is unassigned", () => {
    expect(nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: null, activeMemberIds: everyone })).toBe(
      "anna",
    );
  });

  it("skips a member who has left the household", () => {
    expect(
      nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: "anna", activeMemberIds: ["anna", "cleo"] }),
    ).toBe("cleo");
  });

  it("skips departed members when wrapping around", () => {
    expect(
      nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: "cleo", activeMemberIds: ["bo", "cleo"] }),
    ).toBe("bo");
  });

  it("uses a departed current assignee's slot to find who comes after them", () => {
    expect(
      nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: "bo", activeMemberIds: ["anna", "cleo"] }),
    ).toBe("cleo");
  });

  it("starts from the first active member when a departed member is first in line", () => {
    expect(
      nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: null, activeMemberIds: ["bo", "cleo"] }),
    ).toBe("bo");
  });

  it("keeps the only remaining active member on the task", () => {
    expect(
      nextAssigneeInRotation({ rotation: everyone, currentAssigneeId: "bo", activeMemberIds: ["bo"] }),
    ).toBe("bo");
  });

  it("returns the one member of a one-member rotation", () => {
    expect(
      nextAssigneeInRotation({ rotation: ["bo"], currentAssigneeId: "anna", activeMemberIds: everyone }),
    ).toBe("bo");
  });

  it("leaves the assignee alone for an empty rotation", () => {
    expect(nextAssigneeInRotation({ rotation: [], currentAssigneeId: "anna", activeMemberIds: everyone })).toBe(
      "anna",
    );
    expect(nextAssigneeInRotation({ rotation: [], currentAssigneeId: null, activeMemberIds: everyone })).toBeNull();
  });

  it("returns null when everyone in the rotation has left and so has the assignee", () => {
    expect(
      nextAssigneeInRotation({ rotation: ["bo", "cleo"], currentAssigneeId: "bo", activeMemberIds: ["anna"] }),
    ).toBeNull();
  });
});

describe("activeRotationMembers", () => {
  it("drops departed members and duplicates, keeping order", () => {
    expect(activeRotationMembers(["cleo", "bo", "anna", "cleo"], ["anna", "cleo"])).toEqual(["cleo", "anna"]);
  });
});

describe("isRotating", () => {
  it("needs both a repeat and at least two people", () => {
    expect(isRotating({ recurrenceIntervalDays: 7, rotationMemberIds: ["a", "b"] })).toBe(true);
    expect(isRotating({ recurrenceIntervalDays: null, rotationMemberIds: ["a", "b"] })).toBe(false);
    expect(isRotating({ recurrenceIntervalDays: 7, rotationMemberIds: ["a"] })).toBe(false);
    expect(isRotating({ recurrenceIntervalDays: 7, rotationMemberIds: [] })).toBe(false);
  });
});

describe("withLocalCompletion", () => {
  const now = new Date("2026-10-14T10:00:00.000Z");
  const task = {
    completed: false,
    completedAt: null as Date | null,
    completedByMemberId: "bo" as string | null,
    assignedToMemberId: "anna" as string | null,
    recurrenceIntervalDays: null as number | null,
    rotationMemberIds: [] as string[],
    nextInRotationMemberId: null as string | null,
  };

  it("records who completed it and when", () => {
    expect(withLocalCompletion(task, true, "cleo", now)).toEqual({
      ...task,
      completed: true,
      completedAt: now,
      completedByMemberId: "cleo",
    });
  });

  it("passes a rotating task on to whoever is next", () => {
    const rotating = { ...task, recurrenceIntervalDays: 7, rotationMemberIds: everyone, nextInRotationMemberId: "bo" };
    expect(withLocalCompletion(rotating, true, "anna", now)).toMatchObject({ assignedToMemberId: "bo", nextInRotationMemberId: "bo" });
  });

  it("reopens by clearing only completedAt, keeping last done by", () => {
    const done = { ...task, completed: true, completedAt: now, completedByMemberId: "cleo" };
    expect(withLocalCompletion(done, false, "anna", now)).toEqual({ ...done, completed: false, completedAt: null });
  });
});
