// Tests requireHousehold()'s cookie-fallback logic (src/lib/session.ts):
// resolve the active household from the `active_household` cookie, falling
// back to the caller's first membership when the cookie is missing or
// doesn't match any of their households. Also covers the zero-membership
// path and requireUserWithoutHousehold, the no-household page's guard. All I/O (auth, Prisma, cookies,
// redirect) is mocked so this never touches a real session or database —
// see REQUIREMENTS.md's "Testing" section.
//
// Also covers SCALE-H: both requireHousehold() and requireUserId() reject a
// session whose JWT predates the user's last password change, sending it to
// /session-expired (not /login — see src/lib/session-revocation.ts for why).
import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock, findUniqueMock, countMock, cookiesGetMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
  countMock: vi.fn(),
  cookiesGetMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({
  // requireHousehold reads memberships through the User row (one query for
  // them and passwordChangedAt); requireUserWithoutHousehold counts them.
  prisma: { user: { findUnique: findUniqueMock }, householdMember: { count: countMock } },
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookiesGetMock })),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const { requireHousehold, requireUserId, requireUserWithoutHousehold, NO_HOUSEHOLD_PATH } = await import(
  "@/lib/session"
);

function membership(householdId: string, role: "OWNER" | "CONTRIBUTOR" = "OWNER") {
  return {
    householdId,
    role,
    household: { id: householdId, name: `Household ${householdId}` },
  };
}

// The User row as requireHousehold's query returns it.
function userRow(
  memberships: ReturnType<typeof membership>[],
  passwordChangedAt: Date | null = null
) {
  return { passwordChangedAt, memberships };
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
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  // Not /login: proxy.ts sends any request with a session away from /login
  // back to /dashboard, so that redirect looped forever.
  it("redirects to the no-household page, not /login, when the user has no household memberships", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(userRow([]));

    await expect(requireHousehold()).rejects.toThrow("REDIRECT:/no-household");
    expect(NO_HOUSEHOLD_PATH).toBe("/no-household");
    expect(redirectMock).not.toHaveBeenCalledWith("/login");
  });

  it("uses the household matching the active_household cookie", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1"), membership("h2")]));
    cookiesGetMock.mockReturnValue({ value: "h2" });

    const result = await requireHousehold();

    expect(result.household.id).toBe("h2");
    expect(result.households.map((h) => h.id)).toEqual(["h1", "h2"]);
  });

  it("falls back to the first membership when the cookie is missing", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1"), membership("h2")]));
    cookiesGetMock.mockReturnValue(undefined);

    const result = await requireHousehold();

    expect(result.household.id).toBe("h1");
  });

  it("falls back to the first membership when the cookie doesn't match any membership", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1"), membership("h2")]));
    cookiesGetMock.mockReturnValue({ value: "some-stale-household-id" });

    const result = await requireHousehold();

    expect(result.household.id).toBe("h1");
  });

  it("returns the caller's role for the active household", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1", "CONTRIBUTOR")]));
    cookiesGetMock.mockReturnValue(undefined);

    const result = await requireHousehold();

    expect(result.role).toBe("CONTRIBUTOR");
    expect(result.userId).toBe("user-1");
  });
});

// Password changed at T; a token stamped at sign-in with T-1h predates it,
// one stamped with T itself was issued under the current password.
const CHANGED_AT = new Date("2026-09-01T12:00:00.000Z");
const BEFORE = CHANGED_AT.getTime() - 60 * 60 * 1000;

describe("requireHousehold — password-change revocation (SCALE-H)", () => {
  it("rejects a session issued before the password change", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", pwdChangedAt: BEFORE } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1")], CHANGED_AT));

    await expect(requireHousehold()).rejects.toThrow("REDIRECT:/session-expired");
  });

  it("rejects a session whose token recorded no change yet (null claim)", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", pwdChangedAt: null } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1")], CHANGED_AT));

    await expect(requireHousehold()).rejects.toThrow("REDIRECT:/session-expired");
  });

  it("rejects a pre-SCALE-H token with no claim once the password has changed", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1")], CHANGED_AT));

    await expect(requireHousehold()).rejects.toThrow("REDIRECT:/session-expired");
  });

  it("accepts a session issued after (at) the password change", async () => {
    authMock.mockResolvedValue({
      user: { id: "user-1", pwdChangedAt: CHANGED_AT.getTime() },
    });
    findUniqueMock.mockResolvedValue(userRow([membership("h1")], CHANGED_AT));
    cookiesGetMock.mockReturnValue(undefined);

    const result = await requireHousehold();

    expect(result.household.id).toBe("h1");
  });

  it("accepts any session when the password has never changed", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", pwdChangedAt: BEFORE } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1")], null));
    cookiesGetMock.mockReturnValue(undefined);

    const result = await requireHousehold();

    expect(result.household.id).toBe("h1");
  });

  it("accepts a legacy token with no claim when the password has never changed", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(userRow([membership("h1")], null));
    cookiesGetMock.mockReturnValue(undefined);

    const result = await requireHousehold();

    expect(result.household.id).toBe("h1");
  });

  it("rejects a session for a user that no longer exists", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(null);

    await expect(requireHousehold()).rejects.toThrow("REDIRECT:/session-expired");
  });
});

describe("requireUserId", () => {
  it("redirects to /login when there is no session user", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireUserId()).rejects.toThrow("REDIRECT:/login");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects a session issued before the password change", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", pwdChangedAt: BEFORE } });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: CHANGED_AT });

    await expect(requireUserId()).rejects.toThrow("REDIRECT:/session-expired");
  });

  it("accepts a session issued after (at) the password change", async () => {
    authMock.mockResolvedValue({
      user: { id: "user-1", pwdChangedAt: CHANGED_AT.getTime() },
    });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: CHANGED_AT });

    await expect(requireUserId()).resolves.toBe("user-1");
  });

  it("accepts any session when the password has never changed", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", pwdChangedAt: BEFORE } });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: null });

    await expect(requireUserId()).resolves.toBe("user-1");
  });

  it("accepts a legacy token with no claim when the password has never changed", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: null });

    await expect(requireUserId()).resolves.toBe("user-1");
  });

  it("rejects a pre-SCALE-H token with no claim once the password has changed", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: CHANGED_AT });

    await expect(requireUserId()).rejects.toThrow("REDIRECT:/session-expired");
  });
});

describe("requireUserWithoutHousehold", () => {
  it("redirects to /login when there is no session user", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireUserWithoutHousehold()).rejects.toThrow("REDIRECT:/login");
    expect(countMock).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when the user does have a household", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: null });
    countMock.mockResolvedValue(1);

    await expect(requireUserWithoutHousehold()).rejects.toThrow("REDIRECT:/dashboard");
    expect(countMock).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("returns the user id when the user has no household memberships", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: null });
    countMock.mockResolvedValue(0);

    await expect(requireUserWithoutHousehold()).resolves.toBe("user-1");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
