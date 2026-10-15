import { describe, expect, it } from "vitest";
import { nextUp, shoppingProgress } from "./shopping-progress";

describe("shoppingProgress", () => {
  it("counts ticked rows over all rows", () => {
    expect(shoppingProgress([{ purchased: true }, { purchased: false }, { purchased: true }, { purchased: false }])).toEqual({
      done: 2,
      total: 4,
      fraction: 0.5,
    });
  });

  it("is 0 of 0 with an empty ring for an empty list", () => {
    expect(shoppingProgress([])).toEqual({ done: 0, total: 0, fraction: 0 });
  });

  it("is full when everything is ticked", () => {
    expect(shoppingProgress([{ purchased: true }]).fraction).toBe(1);
  });
});

describe("nextUp", () => {
  const groups = [
    { key: "auto:produce", label: "Produce", items: ["a", "b", "c", "d", "e"] },
    { key: null, label: "Other", items: ["f"] },
  ];

  it("offers the first aisle's first items and counts the rest of that aisle", () => {
    expect(nextUp(groups)).toEqual({ key: "auto:produce", label: "Produce", items: ["a", "b", "c"], more: 2 });
  });

  it("respects a custom limit", () => {
    expect(nextUp(groups, 1)?.items).toEqual(["a"]);
  });

  it("moves on to the next aisle once the first is empty", () => {
    expect(nextUp([{ ...groups[0], items: [] }, groups[1]])).toEqual({ key: null, label: "Other", items: ["f"], more: 0 });
  });

  it("is null with nothing pending", () => {
    expect(nextUp([])).toBeNull();
  });
});
