import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn(),
}));

import { getQueuedTicks, replayQueuedTicks, setQueuedTicks } from "@/lib/shopping/offline-tick-queue-store";
import type { QueuedEntry } from "@/lib/shopping/offline-tick-queue";

// The store reads window.localStorage; the node test environment has none, and
// every access is wrapped, so a bare window is enough (memory is the source of
// truth).
vi.stubGlobal("window", { localStorage: undefined, addEventListener: vi.fn(), removeEventListener: vi.fn() });

describe("replayQueuedTicks", () => {
  beforeEach(() => {
    setQueuedTicks([
      { itemId: "a", purchased: true },
      { itemId: "b", purchased: true },
    ]);
  });

  it("keeps the queue when the request never arrives, and drains it on the next pass", async () => {
    const onFailed = vi.fn();
    const replay = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue({});

    // A dead zone: the first request fails, nothing is settled, nothing lost.
    expect(await replayQueuedTicks(replay, onFailed)).toBe(false);
    expect(getQueuedTicks()).toHaveLength(2);

    // The timed retry: the connection works, both go in order.
    expect(await replayQueuedTicks(replay, onFailed)).toBe(true);
    expect(getQueuedTicks()).toHaveLength(0);
    expect(replay.mock.calls.map(([tick]) => tick.itemId)).toEqual(["a", "a", "b"]);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("drops an entry the server answered with an error and reports it", async () => {
    const onFailed = vi.fn();
    const replay = vi.fn().mockResolvedValueOnce({ error: "gone" }).mockResolvedValue({});
    expect(await replayQueuedTicks(replay, onFailed)).toBe(true);
    expect(getQueuedTicks()).toHaveLength(0);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("replays adds in their place among the ticks, and drops a refused add naming it", async () => {
    const milk = { kind: "add" as const, key: "k1", listId: "list-1", row: { name: "Milk", quantity: 1 } };
    const eggs = { kind: "add" as const, key: "k2", listId: "list-1", row: { name: "Eggs", quantity: 6 } };
    setQueuedTicks([{ itemId: "a", purchased: true }, milk, eggs]);
    const onFailed = vi.fn();
    // Milk's list was completed meanwhile: the server refuses it.
    const replay = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ error: "This list can't be edited right now" })
      .mockResolvedValue({});

    expect(await replayQueuedTicks(replay, onFailed)).toBe(true);
    expect(replay.mock.calls.map(([entry]) => entry)).toEqual([{ itemId: "a", purchased: true }, milk, eggs]);
    expect(getQueuedTicks()).toHaveLength(0);
    expect(onFailed).toHaveBeenCalledExactlyOnceWith(milk, "This list can't be edited right now");
  });

  it("sends a row queued while the pass was running in that same pass", async () => {
    const late = { kind: "add" as const, key: "late", listId: "list-1", row: { name: "Milk", quantity: 1 } };
    const replay = vi.fn(async (entry: QueuedEntry) => {
      // Typed while the first save was on its way.
      if ("itemId" in entry && entry.itemId === "a") setQueuedTicks([...getQueuedTicks(), late]);
      return {};
    });
    expect(await replayQueuedTicks(replay, vi.fn())).toBe(true);
    expect(replay.mock.calls.map(([entry]) => entry)).toEqual([
      { itemId: "a", purchased: true },
      { itemId: "b", purchased: true },
      late,
    ]);
    expect(getQueuedTicks()).toHaveLength(0);
  });
});
