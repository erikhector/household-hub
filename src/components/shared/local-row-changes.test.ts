// Tests applyLocalRowChanges (src/components/shared/local-row-changes.ts):
// how a list shows the ticks and deletes made on this device before the
// server has answered (UX-33).
import { describe, expect, it } from "vitest";
import { applyLocalRowChanges, type LocalRowChange } from "@/components/shared/local-row-changes";

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
