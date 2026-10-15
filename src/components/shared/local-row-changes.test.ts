// Tests the pure halves of src/components/shared/local-row-changes.ts: how
// a list shows the ticks and deletes made on this device before the server
// has answered, and how each save's answer settles its own mark (UX-33).
import { describe, expect, it } from "vitest";
import {
  applyLocalRowChanges,
  dropSettledRowChanges,
  settleLocalRowChange,
  type LocalRowChange,
} from "@/components/shared/local-row-changes";

const rows = [
  { id: "a", done: false },
  { id: "b", done: false },
  { id: "c", done: true },
];
const withDone = (row: (typeof rows)[number], done: boolean) => ({ ...row, done });

describe("applyLocalRowChanges", () => {
  it("returns the rows as they are with no changes", () => {
    expect(applyLocalRowChanges(rows, new Map(), withDone)).toEqual(rows);
  });

  it("flips a ticked or unticked row and drops a deleted one, keeping the order", () => {
    const changes = new Map<string, LocalRowChange>([
      ["a", { seq: 1, done: true }],
      ["b", { seq: 2, deleted: true }],
      ["c", { seq: 3, done: false }],
    ]);
    expect(applyLocalRowChanges(rows, changes, withDone)).toEqual([
      { id: "a", done: true },
      { id: "c", done: false },
    ]);
  });

  it("ignores a change for a row the server no longer lists", () => {
    const changes = new Map<string, LocalRowChange>([["gone", { seq: 1, done: true }]]);
    expect(applyLocalRowChanges(rows, changes, withDone)).toEqual(rows);
  });
});

describe("settleLocalRowChange", () => {
  const changes = new Map<string, LocalRowChange>([
    ["a", { seq: 1, done: true }],
    ["b", { seq: 2, deleted: true }],
  ]);

  it("drops a failed save's mark at once, leaving the others in flight", () => {
    expect(settleLocalRowChange(changes, "a", 1, false)).toEqual(new Map([["b", { seq: 2, deleted: true }]]));
  });

  it("holds a successful save's mark, settled, for the next server list", () => {
    expect(settleLocalRowChange(changes, "a", 1, true).get("a")).toEqual({ seq: 1, done: true, settled: true });
  });

  it("ignores an answer for a mark a later tap replaced", () => {
    expect(settleLocalRowChange(changes, "a", 0, false)).toBe(changes);
    expect(settleLocalRowChange(changes, "gone", 1, true)).toBe(changes);
  });
});

describe("dropSettledRowChanges", () => {
  it("keeps the marks still waiting on the server and drops the settled ones", () => {
    const changes = new Map<string, LocalRowChange>([
      ["a", { seq: 1, done: true, settled: true }],
      ["b", { seq: 2, deleted: true }],
    ]);
    expect(dropSettledRowChanges(changes)).toEqual(new Map([["b", { seq: 2, deleted: true }]]));
  });

  it("returns the same map when nothing has settled", () => {
    const changes = new Map<string, LocalRowChange>([["b", { seq: 2, deleted: true }]]);
    expect(dropSettledRowChanges(changes)).toBe(changes);
  });
});
