import { describe, expect, it, vi } from "vitest";

const { cookieGetMock } = vi.hoisted(() => ({ cookieGetMock: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

const { isGettingStartedDismissed, isGettingStartedCelebrated } = await import("@/lib/getting-started-dismiss");

describe("isGettingStartedDismissed", () => {
  it("is true only when this household's cookie is set to 1", async () => {
    cookieGetMock.mockReturnValue({ value: "1" });
    expect(await isGettingStartedDismissed("household-1")).toBe(true);
    expect(cookieGetMock).toHaveBeenCalledWith("getting_started_dismissed_household-1");
  });

  it("is false when the cookie is absent or has another value", async () => {
    cookieGetMock.mockReturnValue(undefined);
    expect(await isGettingStartedDismissed("household-1")).toBe(false);
    cookieGetMock.mockReturnValue({ value: "0" });
    expect(await isGettingStartedDismissed("household-1")).toBe(false);
  });
});

describe("isGettingStartedCelebrated (UX-69)", () => {
  it("is true only when this household's done cookie is set to 1", async () => {
    cookieGetMock.mockReturnValue({ value: "1" });
    expect(await isGettingStartedCelebrated("household-1")).toBe(true);
    expect(cookieGetMock).toHaveBeenCalledWith("getting_started_done_household-1");
    cookieGetMock.mockReturnValue(undefined);
    expect(await isGettingStartedCelebrated("household-1")).toBe(false);
  });
});
