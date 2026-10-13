import { describe, expect, it, vi } from "vitest";
import { isDroppedConnectionError, runWithReadRetry } from "@/lib/db-retry";

const dropped = () => new Error("Connection terminated unexpectedly");

describe("isDroppedConnectionError", () => {
  it("matches the pg message, directly or in the cause chain", () => {
    expect(isDroppedConnectionError(dropped())).toBe(true);
    expect(
      isDroppedConnectionError(new Error("wrapped", { cause: dropped() })),
    ).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isDroppedConnectionError(new Error("syntax error"))).toBe(false);
    expect(isDroppedConnectionError(null)).toBe(false);
  });
});

describe("runWithReadRetry", () => {
  it("retries a read once and returns the second result", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(dropped())
      .mockResolvedValueOnce([1]);
    await expect(runWithReadRetry("findMany", run)).resolves.toEqual([1]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry", async () => {
    const run = vi.fn().mockRejectedValue(dropped());
    await expect(runWithReadRetry("findFirst", run)).rejects.toThrow(
      "Connection terminated",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    "create",
    "update",
    "updateMany",
    "delete",
    "upsert",
    "$executeRaw",
  ])("does not retry the write %s", async (operation) => {
    const run = vi.fn().mockRejectedValue(dropped());
    await expect(runWithReadRetry(operation, run)).rejects.toThrow(
      "Connection terminated",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry a read that failed for another reason", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(runWithReadRetry("findMany", run)).rejects.toThrow("boom");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
