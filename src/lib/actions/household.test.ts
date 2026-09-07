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
  invitationFindFirstMock,
  transactionMock,
  requireHouseholdMock,
  cookieSetMock,
  headersMock,
  redirectMock,
  revalidatePathMock,
  signInMock,
  sendHouseholdInviteEmailMock,
} = vi.hoisted(() => ({
  householdCreateMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  invitationFindFirstMock: vi.fn(),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
    user: { create: vi.fn(async () => ({ id: "new-user" })) },
    householdMember: { create: vi.fn(async () => ({})) },
    invitation: { update: vi.fn(async () => ({})) },
  })),
  requireHouseholdMock: vi.fn(),
  cookieSetMock: vi.fn(),
  headersMock: vi.fn(async () => new Map()),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  revalidatePathMock: vi.fn(),
  signInMock: vi.fn(),
  sendHouseholdInviteEmailMock: vi.fn(async () => ({})),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    household: { create: householdCreateMock },
    user: { findUnique: userFindUniqueMock },
    invitation: { findUnique: invitationFindUniqueMock, findFirst: invitationFindFirstMock },
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
// next-auth mock above) — stub it out.
vi.mock("@/lib/email", () => ({ sendHouseholdInviteEmail: sendHouseholdInviteEmailMock }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSetMock })),
  headers: headersMock,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { createHouseholdAction, joinViaInviteSignupAction, sendInviteEmailAction } = await import(
  "@/lib/actions/household"
);

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  headersMock.mockImplementation(async () => new Map());
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
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

// Regression coverage for the host-header-injection fix in
// absoluteAppUrl (src/lib/actions/household.ts): the invite link mailed out
// must come from a trusted source (APP_URL), never straight from
// caller-suppliable request headers — otherwise anyone who can shape their
// own HTTP request (curl, not just a browser) could get a real, valid
// invite token mailed inside a link pointing at a domain of their choosing.
describe("sendInviteEmailAction (absoluteAppUrl trust boundary)", () => {
  const validInvitation = {
    id: "invite-1",
    token: "invite-token",
    householdId: "household-1",
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  };

  it("builds the invite URL from APP_URL when it's configured, ignoring request headers", async () => {
    process.env.APP_URL = "https://real-app.example.com/";
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1", name: "The Hectors" } });
    invitationFindFirstMock.mockResolvedValue(validInvitation);
    headersMock.mockResolvedValue(
      new Map([
        ["host", "attacker.example.com"],
        ["x-forwarded-host", "attacker.example.com"],
      ]),
    );

    await sendInviteEmailAction("invite-token", "friend@example.com");

    expect(sendHouseholdInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviteUrl: "https://real-app.example.com/join/invite-token" }),
    );
  });

  it("falls back to the Host header only when APP_URL is unset (local-dev convenience)", async () => {
    delete process.env.APP_URL;
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1", name: "The Hectors" } });
    invitationFindFirstMock.mockResolvedValue(validInvitation);
    headersMock.mockResolvedValue(new Map([["host", "localhost:3000"]]));

    await sendInviteEmailAction("invite-token", "friend@example.com");

    expect(sendHouseholdInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviteUrl: "http://localhost:3000/join/invite-token" }),
    );
  });
});
