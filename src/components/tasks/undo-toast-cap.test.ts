import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dismissMock } = vi.hoisted(() => ({ dismissMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { dismiss: dismissMock } }));

import { TASK_UNDO_TOAST_CAP_MS, capUndoToast } from "@/components/tasks/undo-toast-cap";
import { TASK_DONE_TOAST_MS, TASK_UNDO_WINDOW_MS } from "@/lib/tasks/undo-window";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("capUndoToast", () => {
  it("stops offering Undo before the server's undo window ends, but after the toast's own time", () => {
    expect(TASK_UNDO_TOAST_CAP_MS).toBeLessThan(TASK_UNDO_WINDOW_MS);
    expect(TASK_UNDO_TOAST_CAP_MS).toBeGreaterThan(TASK_DONE_TOAST_MS);
  });

  it("dismisses a toast that is still up (say, hovered) when the cap runs out", () => {
    const cap = capUndoToast();
    cap.start("toast-1");

    vi.advanceTimersByTime(TASK_UNDO_TOAST_CAP_MS - 1);
    expect(dismissMock).not.toHaveBeenCalled();
    expect(cap.closed).toBe(false);

    vi.advanceTimersByTime(1);
    expect(dismissMock).toHaveBeenCalledWith("toast-1");
    expect(cap.closed).toBe(true);
  });

  it("clears the stop when the toast closes on its own or is dismissed", () => {
    for (const handler of ["onAutoClose", "onDismiss"] as const) {
      const cap = capUndoToast();
      cap.start("toast-1");
      cap.closeHandlers[handler]();

      expect(cap.closed).toBe(true);
      vi.advanceTimersByTime(TASK_UNDO_TOAST_CAP_MS);
      expect(dismissMock).not.toHaveBeenCalled();
    }
  });
});
