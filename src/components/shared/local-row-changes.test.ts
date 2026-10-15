// Tests the pure halves of src/components/shared/local-row-changes.ts: how
// a list shows the ticks and deletes made on this device before the server
// has answered, and how each save's answer settles its own mark (UX-33).
import { describe, expect, it, vi } from "vitest";
import {
  applyLocalRowChanges,
  dropSettledRowChanges,
  settleDelete,
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

describe("settleDelete", () => {
  const failed = "Couldn't save that.";

  it("settles a delete that saved as ok and hands back its result", async () => {
    const settle = vi.fn();
    await expect(settleDelete(settle, Promise.resolve({}), failed)).resolves.toEqual({});
    expect(settle).toHaveBeenCalledWith(true);
  });

  it("brings the row back when the action answers with an error", async () => {
    const settle = vi.fn();
    await expect(settleDelete(settle, Promise.resolve({ error: "Not found" }), failed)).resolves.toEqual({
      error: "Not found",
    });
    expect(settle).toHaveBeenCalledWith(false);
  });

  it("brings the row back when the request never arrives, as an error to toast", async () => {
    const settle = vi.fn();
    await expect(settleDelete(settle, Promise.reject(new TypeError("Failed to fetch")), failed)).resolves.toEqual({
      error: failed,
    });
    expect(settle).toHaveBeenCalledWith(false);
  });

  it("re-throws Next's redirect signal, after bringing the row back", async () => {
    const settle = vi.fn();
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    await expect(settleDelete(settle, Promise.reject(redirect), failed)).rejects.toBe(redirect);
    expect(settle).toHaveBeenCalledWith(false);
  });
});
