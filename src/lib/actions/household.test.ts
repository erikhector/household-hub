// Tests the module-private Zod schemas in src/lib/actions/household.ts
// (createHouseholdSchema / joinSignupSchema) indirectly through the
// exported Server Actions, since the schemas themselves aren't exported.
// All I/O (Prisma, requireHousehold, next-auth, next/headers, next/cache,
// next/navigation) is mocked — no database is touched. See REQUIREMENTS.md's
// "Testing" section.
import { afterEach, describe, expect, it, vi } from "vitest";

// The real "next-auth" package's index imports "next/server", which Vitest's
// Node environment can't resolve outside a Next.js build — mock it with a
// minimal stand-in (see the identical note in src/lib/actions/auth.test.ts).
class AuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError }));

const {
  householdCreateMock,
  userFindUniqueMock,
  invitationFindUniqueMock,
  transactionMock,
  requireHouseholdMock,
  cookieSetMock,
  redirectMock,
  revalidatePathMock,
  signInMock,
} = vi.hoisted(() => ({
  householdCreateMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
    user: { create: vi.fn(async () => ({ id: "new-user" })) },
    householdMember: { create: vi.fn(async () => ({})) },
    invitation: { update: vi.fn(async () => ({})) },
  })),
  requireHouseholdMock: vi.fn(),
  cookieSetMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  revalidatePathMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    household: { create: householdCreateMock },
    user: { findUnique: userFindUniqueMock },
    invitation: { findUnique: invitationFindUniqueMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({
  ACTIVE_HOUSEHOLD_COOKIE: "active_household",
  requireHousehold: requireHouseholdMock,
}));
vi.mock("@/lib/auth", () => ({ signIn: signInMock }));
// src/lib/email.ts imports "server-only", which Vitest's Node environment
// can't resolve outside a Next.js build (same class of issue as the
// next-auth mock above) — stub it since these tests don't exercise
// sendInviteEmailAction.
vi.mock("@/lib/email", () => ({ sendHouseholdInviteEmail: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSetMock })),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { createHouseholdAction, joinViaInviteSignupAction } = await import(
  "@/lib/actions/household"
);

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

describe("createHouseholdAction validation (createHouseholdSchema)", () => {
  it("rejects an empty name", async () => {
    requireHouseholdMock.mockResolvedValue({ userId: "user-1" });

    const result = await createHouseholdAction({}, formData({ name: "  " }));

    expect(result.error).toBe("Household name is required");
    expect(householdCreateMock).not.toHaveBeenCalled();
  });

  it("creates the household, sets the active cookie, and redirects on valid input", async () => {
    requireHouseholdMock.mockResolvedValue({ userId: "user-1" });
    householdCreateMock.mockResolvedValue({ id: "new-household" });

    await expect(
      createHouseholdAction({}, formData({ name: "Beach House" })),
    ).rejects.toThrow("REDIRECT:/dashboard");

    expect(householdCreateMock).toHaveBeenCalledWith({
      data: {
        name: "Beach House",
        members: { create: { userId: "user-1", role: "OWNER" } },
      },
    });
    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "new-household",
      expect.objectContaining({ path: "/" }),
    );
  });
});

describe("joinViaInviteSignupAction validation (joinSignupSchema)", () => {
  const validInput = {
    token: "invite-token",
    displayName: "Erik",
    email: "erik@example.com",
    password: "supersecret",
  };

  it("rejects a missing token", async () => {
    const result = await joinViaInviteSignupAction({}, formData({ ...validInput, token: "" }));
    expect(result.error).toBeDefined();
    expect(invitationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects a missing display name", async () => {
    const result = await joinViaInviteSignupAction(
      {},
      formData({ ...validInput, displayName: "" }),
    );
    expect(result.error).toBe("Name is required");
  });

  it("rejects an invalid email", async () => {
    const result = await joinViaInviteSignupAction(
      {},
      formData({ ...validInput, email: "not-an-email" }),
    );
    expect(result.error).toBe("Enter a valid email");
  });

  it("rejects a short password", async () => {
    const result = await joinViaInviteSignupAction(
      {},
      formData({ ...validInput, password: "short" }),
    );
    expect(result.error).toBe("Password must be at least 8 characters");
  });

  it("rejects an invalid or expired invite token once validation passes", async () => {
    invitationFindUniqueMock.mockResolvedValue(null);

    const result = await joinViaInviteSignupAction({}, formData(validInput));

    expect(result.error).toBe("This invite link is invalid or has expired");
  });

  it("joins the household and signs in for a valid invite", async () => {
    invitationFindUniqueMock.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      household: { name: "The Hectors" },
    });
    userFindUniqueMock.mockResolvedValue(null);
    // In the real app, next-auth's signIn() performs the redirect itself
    // (via redirectTo) once sign-in succeeds — it doesn't throw in that
    // case, so the mock resolving normally is the "success" path here.
    signInMock.mockResolvedValue(undefined);

    const result = await joinViaInviteSignupAction({}, formData(validInput));

    expect(result).toEqual({});
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "household-1",
      expect.objectContaining({ path: "/" }),
    );
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: validInput.email,
      password: validInput.password,
      redirectTo: "/dashboard",
    });
  });
});
