import { describe, expect, it, vi } from "vitest";

const { isRouterSignal } = vi.hoisted(() => ({
  isRouterSignal: (error: unknown) => error instanceof Error && error.message === "NEXT_REDIRECT",
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (isRouterSignal(error)) throw error;
  },
}));

import { guardFormAction } from "./guard-form-action";

type State = { error?: string; field?: "email" };

describe("guardFormAction", () => {
  it("passes the action's own result through, errors included", async () => {
    const action = vi.fn(async (): Promise<State> => ({ error: "Email taken", field: "email" }));
    const guarded = guardFormAction(action, "Check your connection");
    const formData = new FormData();
    await expect(guarded({}, formData)).resolves.toEqual({ error: "Email taken", field: "email" });
    expect(action).toHaveBeenCalledWith({}, formData);
  });

  it("turns a request that never arrives into the request-failed error", async () => {
    const guarded = guardFormAction<State>(async () => {
      throw new TypeError("Failed to fetch");
    }, "Check your connection");
    // The last attempt's field marker doesn't carry over: this error isn't about a field.
    await expect(guarded({ error: "Email taken", field: "email" }, new FormData())).resolves.toEqual({
      error: "Check your connection",
      requestFailed: true,
    });
  });

  it("re-throws Next's redirect signal so a successful login still navigates", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    const guarded = guardFormAction<State>(async () => {
      throw redirect;
    }, "Check your connection");
    await expect(guarded({}, new FormData())).rejects.toBe(redirect);
  });
});
