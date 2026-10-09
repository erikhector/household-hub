// UX-12: the visualViewport wiring behind `--kb-inset` (keyboard-inset.ts).
// The hook itself needs a DOM, which the node-environment suite deliberately
// doesn't have (vitest.config.ts), so this drives the same `watchKeyboardInset`
// the hook calls with a fake viewport: dispatching its events must write the
// inset, and cleanup must detach and clear it.
import { describe, expect, it, vi } from "vitest";
import { keyboardInsetPx, watchKeyboardInset } from "./keyboard-inset";

function fakeViewport() {
  const listeners = new Map<string, Set<() => void>>();
  // Mutable, like the real VisualViewport whose height/offsetTop change as
  // the keyboard opens or the user pinch-zooms.
  const viewport = {
    height: 800,
    offsetTop: 0,
    addEventListener: (type: "resize" | "scroll", listener: () => void) => {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(listener);
    },
    removeEventListener: (type: "resize" | "scroll", listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    dispatch: (type: "resize" | "scroll") => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return viewport;
}

describe("keyboardInsetPx", () => {
  it("is the gap between the layout and visual viewports", () => {
    expect(keyboardInsetPx(800, 500)).toBe(300);
  });

  it("is zero when the keyboard is closed", () => {
    expect(keyboardInsetPx(800, 800)).toBe(0);
  });

  it("clamps a taller visual viewport to zero instead of pushing the sheet down", () => {
    expect(keyboardInsetPx(800, 900)).toBe(0);
  });

  it("subtracts the pinch-zoom pan offset", () => {
    expect(keyboardInsetPx(800, 500, 20)).toBe(280);
  });
});

describe("watchKeyboardInset", () => {
  function setup() {
    const viewport = fakeViewport();
    const setInset = vi.fn();
    const clearInset = vi.fn();
    const cleanup = watchKeyboardInset({
      visualViewport: viewport,
      innerHeight: () => 800,
      setInset,
      clearInset,
    });
    return { viewport, setInset, clearInset, cleanup };
  }

  it("writes the current inset immediately, before any event", () => {
    const viewport = fakeViewport();
    viewport.height = 500;
    const setInset = vi.fn();
    watchKeyboardInset({ visualViewport: viewport, innerHeight: () => 800, setInset, clearInset: () => {} });
    expect(setInset).toHaveBeenCalledTimes(1);
    expect(setInset).toHaveBeenCalledWith(300);
  });

  it("updates the inset when the keyboard opens (visualViewport resize)", () => {
    const { viewport, setInset } = setup();
    expect(setInset).toHaveBeenLastCalledWith(0);
    viewport.height = 460;
    viewport.dispatch("resize");
    expect(setInset).toHaveBeenLastCalledWith(340);
  });

  it("updates the inset on pinch-zoom pans (visualViewport scroll)", () => {
    const { viewport, setInset } = setup();
    viewport.height = 460;
    viewport.offsetTop = 20;
    viewport.dispatch("scroll");
    expect(setInset).toHaveBeenLastCalledWith(320);
  });

  it("writes zero again when the keyboard closes", () => {
    const { viewport, setInset } = setup();
    viewport.height = 460;
    viewport.dispatch("resize");
    viewport.height = 800;
    viewport.dispatch("resize");
    expect(setInset).toHaveBeenLastCalledWith(0);
  });

  it("clears the variable on cleanup", () => {
    const { clearInset, cleanup } = setup();
    cleanup();
    expect(clearInset).toHaveBeenCalledTimes(1);
  });

  it("detaches both listeners on cleanup", () => {
    const { viewport, setInset, cleanup } = setup();
    cleanup();
    const calls = setInset.mock.calls.length;
    viewport.height = 400;
    viewport.dispatch("resize");
    viewport.dispatch("scroll");
    expect(setInset.mock.calls.length).toBe(calls);
  });

  it("is a no-op without a visualViewport", () => {
    const setInset = vi.fn();
    const clearInset = vi.fn();
    const cleanup = watchKeyboardInset({
      visualViewport: null,
      innerHeight: () => 800,
      setInset,
      clearInset,
    });
    cleanup();
    expect(setInset).not.toHaveBeenCalled();
    expect(clearInset).not.toHaveBeenCalled();
  });
});
