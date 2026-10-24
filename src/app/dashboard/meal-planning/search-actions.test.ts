import { afterEach, describe, expect, it, vi } from "vitest";

const { searchMock, requireHouseholdMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  requireHouseholdMock: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/app/dashboard/meal-planning/meal-plan-search", () => ({
  MEAL_SEARCH_MAX_CHARS: 100,
  searchMealPlan: searchMock,
}));
const { searchMealPlanAction } = await import("./search-actions");

afterEach(() => {
  vi.clearAllMocks();
});

describe("searchMealPlanAction", () => {
  it("searches the session's household, never one the client names", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "session-household" } });
    searchMock.mockResolvedValue([]);
    await searchMealPlanAction("lasagna");
    expect(searchMock).toHaveBeenCalledWith("session-household", "lasagna");
  });

  it("caps the text and treats a non-string as an empty search", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "h1" } });
    searchMock.mockResolvedValue([]);
    await searchMealPlanAction("x".repeat(500));
    expect(searchMock.mock.calls[0][1]).toHaveLength(100);
    expect(await searchMealPlanAction(undefined as unknown as string)).toEqual([]);
    expect(searchMock).toHaveBeenCalledTimes(1);
  });
});
