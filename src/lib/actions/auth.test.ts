// Tests the module-private Zod schemas in src/lib/actions/auth.ts
// (signupSchema / implicit login validation) indirectly through the
// exported Server Actions, since the schemas themselves aren't exported.
// All I/O (Prisma, next-auth's signIn/signOut) is mocked — no database or
// real auth session is touched. See REQUIREMENTS.md's "Testing" section.
import { afterEach, describe, expect, it, vi } from "vitest";

// The real "next-auth" package's index imports "next/server", which Vitest's
// Node environment can't resolve outside a Next.js build — mock it with a
// minimal stand-in so `error instanceof AuthError` in auth.ts still works
// (both auth.ts and this test import the same mocked class).
class AuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError }));

const { findUniqueMock, transactionMock, signInMock, signOutMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
    user: { create: vi.fn(async () => ({ id: "new-user" })) },
    household: { create: vi.fn(async () => ({ id: "new-household" })) },
    householdMember: { create: vi.fn(async () => ({})) },
  })),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: findUniqueMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/auth", () => ({ signIn: signInMock, signOut: signOutMock }));

const { signupAction, loginAction } = await import("@/lib/actions/auth");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const validSignup = {
  displayName: "Erik",
  householdName: "The Hectors",
  email: "erik@example.com",
  password: "supersecret",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("signupAction validation", () => {
  it("rejects a missing display name", async () => {
    const result = await signupAction({}, formData({ ...validSignup, displayName: "" }));
    expect(result.error).toBe("Name is required");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects a missing household name", async () => {
    const result = await signupAction({}, formData({ ...validSignup, householdName: "  " }));
    expect(result.error).toBe("Household name is required");
  });

  it("rejects an invalid email", async () => {
    const result = await signupAction({}, formData({ ...validSignup, email: "not-an-email" }));
    expect(result.error).toBe("Enter a valid email");
  });

  it("rejects a password shorter than 8 characters", async () => {
    const result = await signupAction({}, formData({ ...validSignup, password: "short" }));
    expect(result.error).toBe("Password must be at least 8 characters");
  });
});

describe("signupAction behavior", () => {
  it("returns an error when the email is already registered", async () => {
    findUniqueMock.mockResolvedValue({ id: "existing-user" });

    const result = await signupAction({}, formData(validSignup));

    expect(result.error).toBe("An account with that email already exists");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates the user/household and signs in on valid input", async () => {
    findUniqueMock.mockResolvedValue(null);
    signInMock.mockResolvedValue(undefined);

    const result = await signupAction({}, formData(validSignup));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: validSignup.email,
      password: validSignup.password,
      redirectTo: "/dashboard",
    });
    expect(result).toEqual({});
  });

  it("returns a friendly error when sign-in fails after account creation", async () => {
    findUniqueMock.mockResolvedValue(null);
    signInMock.mockRejectedValue(new AuthError("CredentialsSignin"));

    const result = await signupAction({}, formData(validSignup));

    expect(result.error).toBe("Account created. Please log in.");
  });

  it("re-throws non-auth errors from sign-in", async () => {
    findUniqueMock.mockResolvedValue(null);
    signInMock.mockRejectedValue(new Error("boom"));

    await expect(signupAction({}, formData(validSignup))).rejects.toThrow("boom");
  });
});

describe("loginAction", () => {
  it("returns a friendly error on invalid credentials", async () => {
    signInMock.mockRejectedValue(new AuthError("CredentialsSignin"));

    const result = await loginAction({}, formData({ email: "erik@example.com", password: "x" }));

    expect(result.error).toBe("Invalid email or password");
  });

  it("returns no error when sign-in succeeds", async () => {
    signInMock.mockResolvedValue(undefined);

    const result = await loginAction(
      {},
      formData({ email: "erik@example.com", password: "supersecret" }),
    );

    expect(result).toEqual({});
  });
});
