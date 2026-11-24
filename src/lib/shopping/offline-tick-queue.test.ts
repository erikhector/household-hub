import { describe, expect, it } from "vitest";
import {
  dropAdd,
  dropTick,
  NO_QUEUED_TICKS,
  parseQueue,
  queueAdds,
  queuedAdds,
  queuedPurchased,
  queueTick,
} from "@/lib/shopping/offline-tick-queue";

describe("queueTick", () => {
  it("adds an entry for a tick the server doesn't have yet", () => {
    expect(queueTick(NO_QUEUED_TICKS, "a", true, false)).toEqual([{ itemId: "a", purchased: true }]);
  });

  it("keeps one entry per row, the last wish winning", () => {
    const ticked = queueTick(NO_QUEUED_TICKS, "a", true, false);
    const both = queueTick(ticked, "b", true, false);
    // The server has "b" ticked; offline it's unticked, then ticked again:
    // one entry per tap would be two, last write wins leaves one.
    const unticked = queueTick(both, "b", false, true);
    expect(unticked).toEqual([
      { itemId: "a", purchased: true },
      { itemId: "b", purchased: false },
    ]);
    expect(queueTick(unticked, "b", true, true)).toEqual([{ itemId: "a", purchased: true }]);
  });

  it("drops the entry when the row is back to what the server has", () => {
    const ticked = queueTick(NO_QUEUED_TICKS, "a", true, false);
    expect(queueTick(ticked, "a", false, false)).toEqual([]);
  });
});

describe("dropTick / queuedPurchased", () => {
  const queue = [
    { itemId: "a", purchased: true },
    { itemId: "b", purchased: false },
  ];

  it("removes only the named row", () => {
    expect(dropTick(queue, "a")).toEqual([{ itemId: "b", purchased: false }]);
  });

  it("returns the same queue when the row isn't in it", () => {
    expect(dropTick(queue, "zzz")).toBe(queue);
  });

  it("reads a row's wish, undefined when it has none", () => {
    expect(queuedPurchased(queue, "b")).toBe(false);
    expect(queuedPurchased(queue, "zzz")).toBeUndefined();
  });
});

describe("parseQueue", () => {
  it("round-trips a stored queue", () => {
    const queue = [{ itemId: "a", purchased: true }];
    expect(parseQueue(JSON.stringify(queue))).toEqual(queue);
  });

  it("treats missing, broken or foreign values as empty", () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("{not json")).toEqual([]);
    expect(parseQueue('{"itemId":"a"}')).toEqual([]);
  });

  it("skips malformed and duplicate entries", () => {
    const raw = JSON.stringify([
      { itemId: "a", purchased: true },
      { itemId: "a", purchased: false },
      { itemId: 5, purchased: true },
      { itemId: "b" },
      null,
    ]);
    expect(parseQueue(raw)).toEqual([{ itemId: "a", purchased: true }]);
  });
});

describe("offline adds (UX-36b)", () => {
  let n = 0;
  const key = () => `k${++n}`;

  it("queues each typed row after what is already waiting, and ticks still work beside them", () => {
    n = 0;
    const ticked = queueTick(NO_QUEUED_TICKS, "a", true, false);
    const added = queueAdds(
      ticked,
      "list-1",
      [
        { name: "Milk", quantity: 2, unit: "l" },
        { name: "Bread", quantity: 1 },
      ],
      key,
    );
    expect(added).toEqual([
      { itemId: "a", purchased: true },
      { kind: "add", key: "k1", listId: "list-1", row: { name: "Milk", quantity: 2, unit: "l" } },
      { kind: "add", key: "k2", listId: "list-1", row: { name: "Bread", quantity: 1 } },
    ]);
    // Ticks on "a" only ever touch the tick, never an add.
    expect(queuedPurchased(added, "a")).toBe(true);
    expect(queueTick(added, "a", false, false)).toEqual(added.slice(1));
    expect(dropTick(added, "a")).toEqual(added.slice(1));
  });

  it("lists one list's adds in order and drops one by its key", () => {
    n = 0;
    const one = queueAdds(NO_QUEUED_TICKS, "list-1", [{ name: "Milk", quantity: 1 }], key);
    const queue = queueAdds(one, "list-2", [{ name: "Eggs", quantity: 6 }], key);
    expect(queuedAdds(queue, "list-1").map((add) => add.row.name)).toEqual(["Milk"]);
    expect(queuedAdds(queue, "list-3")).toEqual([]);
    expect(dropAdd(queue, "k1")).toEqual([queue[1]]);
    expect(dropAdd(queue, "zzz")).toBe(queue);
  });

  it("round-trips adds through storage, beside a tick in UX-36's shape", () => {
    const raw = JSON.stringify([
      { itemId: "a", purchased: true },
      { kind: "add", key: "k1", listId: "list-1", row: { name: "Milk", quantity: 2, unit: "l", inventoryItemId: "i" } },
    ]);
    expect(parseQueue(raw)).toEqual(JSON.parse(raw));
  });

  it("skips malformed and duplicate adds, and keeps only the known fields", () => {
    const raw = JSON.stringify([
      { kind: "add", key: "k1", listId: "list-1", row: { name: "Milk", quantity: 1, extra: "x" } },
      { kind: "add", key: "k1", listId: "list-1", row: { name: "Milk", quantity: 1 } },
      { kind: "add", key: "k2", listId: "", row: { name: "Milk", quantity: 1 } },
      { kind: "add", key: "k3", listId: "list-1", row: { name: " ", quantity: 1 } },
      { kind: "add", key: "k4", listId: "list-1", row: { name: "Milk", quantity: "2" } },
      { kind: "add", key: "k5", listId: "list-1", row: { name: "Milk", quantity: 1, unit: 3 } },
      { kind: "add", key: "k6", listId: "list-1" },
    ]);
    expect(parseQueue(raw)).toEqual([{ kind: "add", key: "k1", listId: "list-1", row: { name: "Milk", quantity: 1 } }]);
  });
});
