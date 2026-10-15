import { describe, expect, it, vi } from "vitest";
import { createDeferredDelete } from "./deferred-delete";

describe("createDeferredDelete", () => {
  it("runs the delete once when committed, however many times commit is called", async () => {
    const run = vi.fn(async () => true);
    const restore = vi.fn();
    const pending = createDeferredDelete({ run, restore });
    pending.commit();
    pending.commit();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(restore).not.toHaveBeenCalled();
  });

  it("restores the row and never deletes after an undo", () => {
    const run = vi.fn(async () => true);
    const restore = vi.fn();
    const pending = createDeferredDelete({ run, restore });
    pending.undo();
    // The toast closing after the Undo click calls commit too; it must no-op.
    pending.commit();
    expect(run).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("ignores an undo that comes after the delete went out", () => {
    const run = vi.fn(async () => true);
    const restore = vi.fn();
    const pending = createDeferredDelete({ run, restore });
    pending.commit();
    pending.undo();
    expect(restore).not.toHaveBeenCalled();
  });

  it("brings the row back when the server refuses the delete", async () => {
    const restore = vi.fn();
    const pending = createDeferredDelete({ run: async () => false, restore });
    pending.commit();
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  });
});
