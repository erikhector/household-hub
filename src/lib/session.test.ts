// Tests requireHousehold()'s cookie-fallback logic (src/lib/session.ts):
// resolve the active household from the `active_household` cookie, falling
// back to the caller's first membership when the cookie is missing or
// doesn't match any of their households. All I/O (auth, Prisma, cookies,
// redirect) is mocked so this never touches a real session or database —
// see REQUIREMENTS.md's "Testing" section.
import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock, findManyMock, cookiesGetMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findManyMock: vi.fn(),
  cookiesGetMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: { householdMember: { findMany: findManyMock } },
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookiesGetMock })),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const { requireHousehold } = await import("@/lib/session");

function membership(householdId: string, role: "OWNER" | "CONTRIBUTOR" = "OWNER") {
  return {
    householdId,
    role,
    household: { id: householdId, name: `Household ${householdId}` },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

describe("requireHousehold", () => {
  it("redirects to /login when there is no session user", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireHousehold()).rejects.toThrow("REDIRECT:/login");
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when the user has no household memberships", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findManyMock.mockResolvedValue([]);

    await expect(requireHousehold()).rejects.toThrow("REDIRECT:/login");
  });

  it("uses the household matching the active_household cookie", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findManyMock.mockResolvedValue([membership("h1"), membership("h2")]);
    cookiesGetMock.mockReturnValue({ value: "h2" });

    const result = await requireHousehold();

    expect(result.household.id).toBe("h2");
    expect(result.households.map((h) => h.id)).toEqual(["h1", "h2"]);
  });

  it("falls back to the first membership when the cookie is missing", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findManyMock.mockResolvedValue([membership("h1"), membership("h2")]);
    cookiesGetMock.mockReturnValue(undefined);

    const result = await requireHousehold();

    expect(result.household.id).toBe("h1");
  });

  it("falls back to the first membership when the cookie doesn't match any membership", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findManyMock.mockResolvedValue([membership("h1"), membership("h2")]);
    cookiesGetMock.mockReturnValue({ value: "some-stale-household-id" });

    const result = await requireHousehold();

    expect(result.household.id).toBe("h1");
  });

  it("returns the caller's role for the active household", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findManyMock.mockResolvedValue([membership("h1", "CONTRIBUTOR")]);
    cookiesGetMock.mockReturnValue(undefined);

    const result = await requireHousehold();

    expect(result.role).toBe("CONTRIBUTOR");
    expect(result.userId).toBe("user-1");
  });
});
