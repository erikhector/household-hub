import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn(),
}));

import { getQueuedTicks, replayQueuedTicks, setQueuedTicks } from "@/lib/shopping/offline-tick-queue-store";

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
});
