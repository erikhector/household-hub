import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastError, isRouterSignal } = vi.hoisted(() => ({
  toastError: vi.fn(),
  isRouterSignal: (error: unknown) => error instanceof Error && error.message === "NEXT_REDIRECT",
}));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (isRouterSignal(error)) throw error;
  },
}));

import { settleOptimisticAction } from "./settle-optimistic-action";

describe("settleOptimisticAction", () => {
  beforeEach(() => {
    toastError.mockReset();
  });

  it("returns the result and stays quiet when the save succeeds", async () => {
    const save = async (): Promise<{ error?: string; autoAdded?: string[] }> => ({ autoAdded: ["Milk"] });
    const result = await settleOptimisticAction(save, "Couldn't save");
    expect(result).toEqual({ autoAdded: ["Milk"] });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts the action's own error and returns null so the row rolls back", async () => {
    const result = await settleOptimisticAction(async () => ({ error: "Item not found" }), "Couldn't save");
    expect(result).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Item not found");
  });

  it("toasts the save-failed message when the request never arrives", async () => {
    const result = await settleOptimisticAction(async () => {
      throw new TypeError("Failed to fetch");
    }, "Couldn't save");
    expect(result).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Couldn't save");
  });

  it("re-throws Next's redirect signal instead of swallowing it", async () => {
    await expect(
      settleOptimisticAction(async () => {
        throw new Error("NEXT_REDIRECT");
      }, "Couldn't save"),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(toastError).not.toHaveBeenCalled();
  });
});
