// UX-12: the visualViewport wiring behind `--kb-inset` (keyboard-inset.ts).
// The hook itself needs a DOM, which the node-environment suite deliberately
// doesn't have (vitest.config.ts), so this drives the same `watchKeyboardInset`
// the hook calls with a fake viewport (plus a fake window for the
// end-of-transition signals): dispatching their events must write the
// inset, and cleanup must detach and clear it.
import { describe, expect, it, vi } from "vitest";
import { keyboardInsetPx, revealScrollDelta, watchKeyboardInset } from "./keyboard-inset";

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

function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  // The end-of-transition signals watchKeyboardInset subscribes to on the
  // real window: resize/orientationchange for layout settles, focusout for
  // keyboard dismissal.
  const target = {
    addEventListener: (type: "resize" | "orientationchange" | "focusout" | "focusin", listener: () => void) => {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(listener);
    },
    removeEventListener: (type: "resize" | "orientationchange" | "focusout" | "focusin", listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    dispatch: (type: "resize" | "orientationchange" | "focusout" | "focusin") => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return target;
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

  it("ignores a toolbar-sized gap (dynamic URL bar, no keyboard)", () => {
    expect(keyboardInsetPx(800, 744)).toBe(0);
  });

  it("ignores a gap just under the keyboard threshold", () => {
    expect(keyboardInsetPx(800, 651)).toBe(0);
  });

  it("keeps a gap at the keyboard threshold", () => {
    expect(keyboardInsetPx(800, 650)).toBe(150);
  });

  it("ignores a transient mid-animation gap (tens of px, no keyboard)", () => {
    expect(keyboardInsetPx(800, 770)).toBe(0);
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

  it("writes zero for a toolbar-sized gap on resize", () => {
    const { viewport, setInset } = setup();
    viewport.height = 744;
    viewport.dispatch("resize");
    expect(setInset).toHaveBeenLastCalledWith(0);
  });

  it("heals a stale inset on focusout when the close resize was dropped", () => {
    const viewport = fakeViewport();
    const target = fakeWindow();
    const setInset = vi.fn();
    watchKeyboardInset({ visualViewport: viewport, windowTarget: target, innerHeight: () => 800, setInset, clearInset: () => {} });
    // Keyboard opens, then closes — but the closing visualViewport resize
    // never arrives, so the last write (340) is stale while the geometry is
    // already back to full height. Blur is dismissal's reliable half: the
    // focusout recompute must overwrite the stale value with 0.
    viewport.height = 460;
    viewport.dispatch("resize");
    expect(setInset).toHaveBeenLastCalledWith(340);
    viewport.height = 800;
    target.dispatch("focusout");
    expect(setInset).toHaveBeenLastCalledWith(0);
  });

  it("heals a stale inset on window resize", () => {
    const viewport = fakeViewport();
    const target = fakeWindow();
    const setInset = vi.fn();
    watchKeyboardInset({ visualViewport: viewport, windowTarget: target, innerHeight: () => 800, setInset, clearInset: () => {} });
    viewport.height = 460;
    viewport.dispatch("resize");
    expect(setInset).toHaveBeenLastCalledWith(340);
    viewport.height = 800;
    target.dispatch("resize");
    expect(setInset).toHaveBeenLastCalledWith(0);
  });

  it("recomputes on orientationchange", () => {
    const viewport = fakeViewport();
    const target = fakeWindow();
    const setInset = vi.fn();
    watchKeyboardInset({ visualViewport: viewport, windowTarget: target, innerHeight: () => 800, setInset, clearInset: () => {} });
    viewport.height = 460;
    target.dispatch("orientationchange");
    expect(setInset).toHaveBeenLastCalledWith(340);
  });

  it("detaches the window listeners on cleanup", () => {
    const viewport = fakeViewport();
    const target = fakeWindow();
    const setInset = vi.fn();
    const cleanup = watchKeyboardInset({
      visualViewport: viewport,
      windowTarget: target,
      innerHeight: () => 800,
      setInset,
      clearInset: () => {},
    });
    cleanup();
    const calls = setInset.mock.calls.length;
    viewport.height = 400;
    target.dispatch("resize");
    target.dispatch("orientationchange");
    target.dispatch("focusout");
    expect(setInset.mock.calls.length).toBe(calls);
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

// The lift alone isn't enough: when the keyboard opens, iOS has already
// scrolled for the focused field against the un-lifted sheet, so a field
// low in the body ends up behind the keyboard or, in a tall sheet, above
// the screen. Each time the keyboard opens (or focus moves while it's up),
// the watcher asks for the focused field to be revealed again.
describe("watchKeyboardInset reveals the focused field", () => {
  function setup() {
    const viewport = fakeViewport();
    const target = fakeWindow();
    const revealFocused = vi.fn();
    watchKeyboardInset({
      visualViewport: viewport,
      windowTarget: target,
      innerHeight: () => 800,
      setInset: () => {},
      clearInset: () => {},
      revealFocused,
    });
    return { viewport, target, revealFocused };
  }

  it("does nothing while the keyboard is closed", () => {
    const { viewport, target, revealFocused } = setup();
    viewport.dispatch("resize");
    target.dispatch("focusin");
    expect(revealFocused).not.toHaveBeenCalled();
  });

  it("reveals once when the keyboard opens, not on every event after", () => {
    const { viewport, revealFocused } = setup();
    viewport.height = 460;
    viewport.dispatch("resize");
    expect(revealFocused).toHaveBeenCalledTimes(1);
    // A pinch-zoom pan or a repeat resize at the same height isn't a new
    // keyboard: re-revealing would fight the user's own scrolling.
    viewport.dispatch("resize");
    viewport.dispatch("scroll");
    expect(revealFocused).toHaveBeenCalledTimes(1);
  });

  it("reveals when the keyboard grows (suggestion bar appears)", () => {
    const { viewport, revealFocused } = setup();
    viewport.height = 460;
    viewport.dispatch("resize");
    viewport.height = 420;
    viewport.dispatch("resize");
    expect(revealFocused).toHaveBeenCalledTimes(2);
  });

  it("doesn't reveal for a pinch-zoom pan that changes offsetTop", () => {
    const { viewport, revealFocused } = setup();
    viewport.height = 460;
    viewport.offsetTop = 40;
    viewport.dispatch("resize");
    expect(revealFocused).toHaveBeenCalledTimes(1);
    // Panning back up shrinks offsetTop, so the inset grows, but the
    // keyboard didn't: a reveal here would fight the user's own scroll.
    viewport.offsetTop = 10;
    viewport.dispatch("scroll");
    viewport.offsetTop = 0;
    viewport.dispatch("scroll");
    expect(revealFocused).toHaveBeenCalledTimes(1);
  });

  it("reveals when focus moves to another field with the keyboard up", () => {
    const { viewport, target, revealFocused } = setup();
    viewport.height = 460;
    viewport.dispatch("resize");
    target.dispatch("focusin");
    expect(revealFocused).toHaveBeenCalledTimes(2);
  });

  it("reveals again after the keyboard closes and reopens", () => {
    const { viewport, revealFocused } = setup();
    viewport.height = 460;
    viewport.dispatch("resize");
    viewport.height = 800;
    viewport.dispatch("resize");
    viewport.height = 460;
    viewport.dispatch("resize");
    expect(revealFocused).toHaveBeenCalledTimes(2);
  });

  it("stops listening for focusin on cleanup", () => {
    const viewport = fakeViewport();
    const target = fakeWindow();
    const revealFocused = vi.fn();
    viewport.height = 460;
    const cleanup = watchKeyboardInset({
      visualViewport: viewport,
      windowTarget: target,
      innerHeight: () => 800,
      setInset: () => {},
      clearInset: () => {},
      revealFocused,
    });
    cleanup();
    const calls = revealFocused.mock.calls.length;
    target.dispatch("focusin");
    expect(revealFocused.mock.calls.length).toBe(calls);
  });
});

// The sheet's cap reads --kb-visible (dialog.tsx), so it holds when iOS pans
// the visual viewport down (offsetTop > 0), where 100dvh − inset would reach
// above the visible top by the pan.
describe("watchKeyboardInset writes the visible height", () => {
  it("writes the visual viewport's height while the keyboard is up, null when closed", () => {
    const viewport = fakeViewport();
    const setVisible = vi.fn();
    watchKeyboardInset({ visualViewport: viewport, innerHeight: () => 800, setInset: () => {}, clearInset: () => {}, setVisible });
    expect(setVisible).toHaveBeenLastCalledWith(null);
    viewport.height = 460;
    viewport.offsetTop = 30;
    viewport.dispatch("resize");
    expect(setVisible).toHaveBeenLastCalledWith(460);
    viewport.height = 800;
    viewport.offsetTop = 0;
    viewport.dispatch("resize");
    expect(setVisible).toHaveBeenLastCalledWith(null);
  });

  it("writes null for a toolbar-sized gap", () => {
    const viewport = fakeViewport();
    const setVisible = vi.fn();
    viewport.height = 744;
    watchKeyboardInset({ visualViewport: viewport, innerHeight: () => 800, setInset: () => {}, clearInset: () => {}, setVisible });
    expect(setVisible).toHaveBeenLastCalledWith(null);
  });
});

// The reveal's scroll: the band is the sheet body minus the sticky footer,
// so a field revealed from below must land above Save/Cancel.
describe("revealScrollDelta", () => {
  const band = { top: 100, bottom: 400 };

  it("leaves a field that's already in the band alone", () => {
    expect(revealScrollDelta({ top: 150, bottom: 190 }, band)).toBe(0);
  });

  it("scrolls a field below the band up just to its bottom edge", () => {
    expect(revealScrollDelta({ top: 420, bottom: 460 }, band)).toBe(60);
  });

  it("scrolls a field half under the band's bottom (the footer) clear of it", () => {
    expect(revealScrollDelta({ top: 380, bottom: 420 }, band)).toBe(20);
  });

  it("scrolls a field above the band down to its top edge", () => {
    expect(revealScrollDelta({ top: 40, bottom: 80 }, band)).toBe(-60);
  });

  it("lines up the top of a field taller than the band", () => {
    expect(revealScrollDelta({ top: 300, bottom: 800 }, band)).toBe(200);
  });
});
