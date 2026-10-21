import { describe, expect, it } from "vitest";
import { filterTasks, parseTaskFilter } from "./task-filter";

const tasks = [
  { id: "a", assignedToMemberId: "me" },
  { id: "b", assignedToMemberId: "other" },
  { id: "c", assignedToMemberId: null },
];

describe("parseTaskFilter", () => {
  it("reads a stored mine", () => {
    expect(parseTaskFilter("mine")).toBe("mine");
  });

  it("falls back to everyone for nothing stored or an unknown value", () => {
    expect(parseTaskFilter(null)).toBe("everyone");
    expect(parseTaskFilter("")).toBe("everyone");
    expect(parseTaskFilter("someone-else")).toBe("everyone");
  });
});

describe("filterTasks", () => {
  it("keeps only the tasks assigned to me under mine", () => {
    expect(filterTasks(tasks, "mine", "me").map((t) => t.id)).toEqual(["a"]);
  });

  it("shows every task, unassigned included, under everyone", () => {
    expect(filterTasks(tasks, "everyone", "me")).toEqual(tasks);
  });

  it("shows every task when the viewer has no member id", () => {
    expect(filterTasks(tasks, "mine", null)).toEqual(tasks);
  });
});
