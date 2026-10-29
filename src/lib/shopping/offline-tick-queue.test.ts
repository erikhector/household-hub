import { describe, expect, it } from "vitest";
import { dropTick, NO_QUEUED_TICKS, parseQueue, queuedPurchased, queueTick } from "@/lib/shopping/offline-tick-queue";

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
