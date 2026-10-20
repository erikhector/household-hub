import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTickFeedback, TICK_MS, TICK_VIBRATE_MS } from "./tick-feedback";

function stubEnv(reduced: boolean, vibrate: ((ms: number) => boolean) | null) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal("navigator", vibrate ? { vibrate } : {});
}

describe("startTickFeedback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("vibrates 10 ms, shows the fill, and only then runs", () => {
    const vibrate = vi.fn(() => true);
    stubEnv(false, vibrate);
    const run = vi.fn();
    const filling = vi.fn();
    startTickFeedback(run, filling);
    expect(vibrate).toHaveBeenCalledWith(TICK_VIBRATE_MS);
    expect(filling).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TICK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledOnce();
  });

  it("under reduced motion runs at once, skips the fill, still vibrates", () => {
    const vibrate = vi.fn(() => true);
    stubEnv(true, vibrate);
    const run = vi.fn();
    const filling = vi.fn();
    startTickFeedback(run, filling);
    expect(vibrate).toHaveBeenCalledWith(TICK_VIBRATE_MS);
    expect(filling).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });

  it("works without a vibration API", () => {
    stubEnv(false, null);
    const run = vi.fn();
    startTickFeedback(run);
    vi.advanceTimersByTime(TICK_MS);
    expect(run).toHaveBeenCalledOnce();
  });
});
