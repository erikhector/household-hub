// Covers scheduleAiCategoryFallback (AUTO-2b(a)): the background patch a
// caller schedules once an item has already been committed as
// "Uncategorized". `after` (next/server) is mocked to just capture its
// callback so the test can await it directly instead of racing a real
// post-response hook — see AGENTS.md's Testing section for the general
// "mock every I/O boundary" convention this follows.
//
// createCategoryResolver itself is already exercised end-to-end through the
// Server Actions that use it (src/app/dashboard/inventory/actions.test.ts),
// so this file only covers the new AI-fallback half.
import { afterEach, describe, expect, it, vi } from "vitest";

const { updateManyMock, revalidatePathMock, resolveCategoriesWithAiFallbackMock, isAiCategoryFallbackConfiguredMock } =
  vi.hoisted(() => ({
    updateManyMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    resolveCategoriesWithAiFallbackMock: vi.fn(),
    isAiCategoryFallbackConfiguredMock: vi.fn(),
  }));

// Captures whatever scheduleAiCategoryFallback hands to `after()` so the
// test can await it directly, rather than actually depending on Next's
// post-response lifecycle (which doesn't exist outside a real request).
let scheduled: (() => Promise<void>) | null = null;
vi.mock("next/server", () => ({
  after: vi.fn((callback: () => Promise<void>) => {
    scheduled = callback;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { inventoryItem: { updateMany: updateManyMock } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/inventory/ai-category-fallback", () => ({
  isAiCategoryFallbackConfigured: isAiCategoryFallbackConfiguredMock,
  resolveCategoriesWithAiFallback: resolveCategoriesWithAiFallbackMock,
}));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => ({ inventory: { autoCategories: en.inventory.autoCategories } })) };
});

const { scheduleAiCategoryFallback, PLACEHOLDER_CATEGORIES } = await import("@/lib/inventory/category-resolver");

afterEach(() => {
  vi.clearAllMocks();
  scheduled = null;
});

describe("scheduleAiCategoryFallback", () => {
  it("does nothing at all — not even scheduling `after()` — when no AI key is configured", () => {
    isAiCategoryFallbackConfiguredMock.mockReturnValue(false);

    scheduleAiCategoryFallback("household-1", ["Cumin"]);

    expect(scheduled).toBeNull();
    expect(resolveCategoriesWithAiFallbackMock).not.toHaveBeenCalled();
  });

  it("does nothing for an empty name list, even when a key is configured", () => {
    isAiCategoryFallbackConfiguredMock.mockReturnValue(true);

    scheduleAiCategoryFallback("household-1", []);

    expect(scheduled).toBeNull();
  });

  it("patches every resolved item's category once the scheduled call runs, guarded to still-placeholder rows", async () => {
    isAiCategoryFallbackConfiguredMock.mockReturnValue(true);
    resolveCategoriesWithAiFallbackMock.mockResolvedValue(new Map([["Ground Cumin", "pantry"]]));
    updateManyMock.mockResolvedValue({ count: 1 });

    scheduleAiCategoryFallback("household-1", ["Ground Cumin"]);
    expect(scheduled).not.toBeNull();
    await scheduled!();

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", name: "Ground Cumin", category: { in: PLACEHOLDER_CATEGORIES } },
      data: { category: "Pantry basics" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/inventory");
  });

  it("does not revalidate when nothing actually got patched (already corrected by the time the call returns)", async () => {
    isAiCategoryFallbackConfiguredMock.mockReturnValue(true);
    resolveCategoriesWithAiFallbackMock.mockResolvedValue(new Map([["Ground Cumin", "pantry"]]));
    updateManyMock.mockResolvedValue({ count: 0 });

    scheduleAiCategoryFallback("household-1", ["Ground Cumin"]);
    await scheduled!();

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("does nothing when the AI call resolves nothing (rate-limited, unconfigured mid-flight, or every provider failed)", async () => {
    isAiCategoryFallbackConfiguredMock.mockReturnValue(true);
    resolveCategoriesWithAiFallbackMock.mockResolvedValue(new Map());

    scheduleAiCategoryFallback("household-1", ["AA batteries"]);
    await scheduled!();

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("never lets a patch failure escape — the scheduled callback resolves even when the database call rejects", async () => {
    isAiCategoryFallbackConfiguredMock.mockReturnValue(true);
    resolveCategoriesWithAiFallbackMock.mockResolvedValue(new Map([["Ground Cumin", "pantry"]]));
    updateManyMock.mockRejectedValue(new Error("db down"));

    scheduleAiCategoryFallback("household-1", ["Ground Cumin"]);

    await expect(scheduled!()).resolves.toBeUndefined();
  });
});
