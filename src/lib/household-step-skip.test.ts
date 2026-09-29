import { describe, expect, it, vi } from "vitest";

const { cookieGetMock } = vi.hoisted(() => ({ cookieGetMock: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

const { isHouseholdStepSkipped } = await import("@/lib/household-step-skip");

describe("isHouseholdStepSkipped", () => {
  it("is true only when this household's cookie is set to 1", async () => {
    cookieGetMock.mockReturnValue({ value: "1" });
    expect(await isHouseholdStepSkipped("household-1")).toBe(true);
    expect(cookieGetMock).toHaveBeenCalledWith("household_step_skipped_household-1");
  });

  it("is false when the cookie is absent or has another value", async () => {
    cookieGetMock.mockReturnValue(undefined);
    expect(await isHouseholdStepSkipped("household-1")).toBe(false);
    cookieGetMock.mockReturnValue({ value: "0" });
    expect(await isHouseholdStepSkipped("household-1")).toBe(false);
  });
});
