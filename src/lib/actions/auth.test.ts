// Tests the module-private Zod schemas in src/lib/actions/auth.ts
// (signupSchema / implicit login validation / requestPasswordResetSchema /
// resetPasswordSchema) indirectly through the exported Server Actions,
// since the schemas themselves aren't exported. All I/O (Prisma,
// next-auth's signIn/signOut, next/headers, next/navigation, email sending)
// is mocked — no database or real auth session is touched. See
// REQUIREMENTS.md's "Testing" section.
import { afterEach, describe, expect, it, vi } from "vitest";

// The real "next-auth" package's index imports "next/server", which Vitest's
// Node environment can't resolve outside a Next.js build — mock it with a
// minimal stand-in so `error instanceof AuthError` in auth.ts still works
// (both auth.ts and this test import the same mocked class).
class AuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError }));

const {
  findUniqueMock,
  transactionMock,
  signInMock,
  signOutMock,
  passwordResetTokenFindUniqueMock,
  passwordResetTokenDeleteManyMock,
  passwordResetTokenCreateMock,
  sendPasswordResetEmailMock,
  emailVerificationTokenFindUniqueMock,
  emailVerificationTokenDeleteManyMock,
  emailVerificationTokenCreateMock,
  sendVerificationEmailMock,
  requireUserIdMock,
  headersMock,
  redirectMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
    user: {
      create: vi.fn(async () => ({ id: "new-user" })),
      update: vi.fn(async () => ({})),
    },
    household: { create: vi.fn(async () => ({ id: "new-household" })) },
    householdMember: { create: vi.fn(async () => ({})) },
    passwordResetToken: {
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    emailVerificationToken: {
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  })),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
  passwordResetTokenFindUniqueMock: vi.fn(),
  passwordResetTokenDeleteManyMock: vi.fn(async () => ({ count: 0 })),
  passwordResetTokenCreateMock: vi.fn(async () => ({ id: "token-row", token: "generated-token" })),
  sendPasswordResetEmailMock: vi.fn(async () => ({})),
  emailVerificationTokenFindUniqueMock: vi.fn(),
  emailVerificationTokenDeleteManyMock: vi.fn(async () => ({ count: 0 })),
  emailVerificationTokenCreateMock: vi.fn(async () => ({
    id: "verify-token-row",
    token: "generated-verify-token",
  })),
  sendVerificationEmailMock: vi.fn(async () => ({})),
  requireUserIdMock: vi.fn(async () => "user-1"),
  headersMock: vi.fn(async () => new Map([["host", "localhost:3000"]])),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: findUniqueMock },
    passwordResetToken: {
      findUnique: passwordResetTokenFindUniqueMock,
      deleteMany: passwordResetTokenDeleteManyMock,
      create: passwordResetTokenCreateMock,
    },
    emailVerificationToken: {
      findUnique: emailVerificationTokenFindUniqueMock,
      deleteMany: emailVerificationTokenDeleteManyMock,
      create: emailVerificationTokenCreateMock,
    },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/auth", () => ({ signIn: signInMock, signOut: signOutMock }));
// src/lib/email.ts imports "server-only", which Vitest's Node environment
// can't resolve outside a Next.js build (same class of issue as the
// next-auth mock above) — stub it out.
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: sendPasswordResetEmailMock,
  sendVerificationEmail: sendVerificationEmailMock,
}));
// src/lib/session.ts's requireHousehold/requireUserId pull in next-auth's
// auth() and a real DB call — resendVerificationEmailAction only needs the
// resolved userId, so stub the whole module rather than mock those
// transitively.
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const {
  signupAction,
  loginAction,
  requestPasswordResetAction,
  resetPasswordAction,
  verifyEmailAction,
  resendVerificationEmailAction,
} = await import("@/lib/actions/auth");
const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

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

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  headersMock.mockImplementation(async () => new Map([["host", "localhost:3000"]]));
  passwordResetTokenDeleteManyMock.mockImplementation(async () => ({ count: 0 }));
  passwordResetTokenCreateMock.mockImplementation(async () => ({
    id: "token-row",
    token: "generated-token",
  }));
  sendPasswordResetEmailMock.mockImplementation(async () => ({}));
  emailVerificationTokenDeleteManyMock.mockImplementation(async () => ({ count: 0 }));
  emailVerificationTokenCreateMock.mockImplementation(async () => ({
    id: "verify-token-row",
    token: "generated-verify-token",
  }));
  sendVerificationEmailMock.mockImplementation(async () => ({}));
  requireUserIdMock.mockImplementation(async () => "user-1");
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
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

  // Regression coverage for task L: a fresh signup must also create an
  // EmailVerificationToken and email it — see EMAIL_VERIFICATION_TOKEN_TTL_MS
  // and sendVerificationEmail in src/lib/actions/auth.ts / src/lib/email.ts.
  it("creates a verification token and emails it for a new signup", async () => {
    delete process.env.APP_URL;
    findUniqueMock.mockResolvedValue(null);
    signInMock.mockResolvedValue(undefined);

    await signupAction({}, formData(validSignup));

    expect(emailVerificationTokenCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "new-user" }),
    });
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      to: validSignup.email,
      verifyUrl: "http://localhost:3000/verify-email/generated-verify-token",
    });
  });

  // Additive, not a hard dependency (see signupAction's doc comment) — the
  // account must still be created and signed into even if the verification
  // email fails to send or the token can't be created.
  it("still creates the account and signs in when sending the verification email fails", async () => {
    findUniqueMock.mockResolvedValue(null);
    signInMock.mockResolvedValue(undefined);
    emailVerificationTokenCreateMock.mockRejectedValue(new Error("db down"));

    const result = await signupAction({}, formData(validSignup));

    expect(signInMock).toHaveBeenCalled();
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

  it("normalizes email case before checking credentials", async () => {
    signInMock.mockResolvedValue(undefined);

    await loginAction({}, formData({ email: "Erik@Example.com", password: "supersecret" }));

    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ email: "erik@example.com" }),
    );
  });

  // Regression coverage for the brute-force fix: unlimited login attempts
  // used to be possible against a single account (see LOGIN_RATE_LIMIT in
  // src/lib/actions/auth.ts).
  it("rate-limits repeated attempts against the same email without ever calling signIn again", async () => {
    signInMock.mockRejectedValue(new AuthError("CredentialsSignin"));

    for (let i = 0; i < 10; i++) {
      await loginAction({}, formData({ email: "victim@example.com", password: `guess${i}` }));
    }
    signInMock.mockClear();

    const result = await loginAction(
      {},
      formData({ email: "victim@example.com", password: "guess11" }),
    );

    expect(result.error).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("does not rate-limit a different email after another account is throttled", async () => {
    signInMock.mockRejectedValue(new AuthError("CredentialsSignin"));
    for (let i = 0; i < 10; i++) {
      await loginAction({}, formData({ email: "victim@example.com", password: `guess${i}` }));
    }

    signInMock.mockResolvedValue(undefined);
    const result = await loginAction(
      {},
      formData({ email: "someone-else@example.com", password: "supersecret" }),
    );

    expect(result).toEqual({});
  });
});

describe("signupAction rate limiting", () => {
  it("blocks repeated signup attempts for the same email after the limit", async () => {
    findUniqueMock.mockResolvedValue({ id: "existing-user" });

    for (let i = 0; i < 5; i++) {
      await signupAction({}, formData(validSignup));
    }
    findUniqueMock.mockClear();

    const result = await signupAction({}, formData(validSignup));

    expect(result.error).toBe("Too many attempts. Please wait a while and try again.");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

const GENERIC_RESET_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

describe("requestPasswordResetAction validation", () => {
  it("rejects an invalid email", async () => {
    const result = await requestPasswordResetAction({}, formData({ email: "not-an-email" }));

    expect(result.error).toBe("Enter a valid email");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

// Regression coverage for the "never reveal whether an email is
// registered" constraint (see requestPasswordResetAction's doc comment in
// src/lib/actions/auth.ts) — unlike signupAction, this flow must return an
// identical response whether or not the account exists.
describe("requestPasswordResetAction behavior", () => {
  it("returns the generic message and sends no email for an unknown address", async () => {
    findUniqueMock.mockResolvedValue(null);

    const result = await requestPasswordResetAction(
      {},
      formData({ email: "nobody@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_RESET_MESSAGE });
    expect(passwordResetTokenDeleteManyMock).not.toHaveBeenCalled();
    expect(passwordResetTokenCreateMock).not.toHaveBeenCalled();
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  it("invalidates old tokens, creates a fresh one, and emails it for a known address", async () => {
    delete process.env.APP_URL;
    findUniqueMock.mockResolvedValue({ id: "user-1", email: "erik@example.com" });
    headersMock.mockResolvedValue(new Map([["host", "localhost:3000"]]));

    const result = await requestPasswordResetAction(
      {},
      formData({ email: "Erik@Example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_RESET_MESSAGE });
    expect(passwordResetTokenDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
    });
    expect(passwordResetTokenCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1" }),
    });
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith({
      to: "erik@example.com",
      resetUrl: "http://localhost:3000/reset-password/generated-token",
    });
  });

  it("still returns the generic message when email sending fails", async () => {
    findUniqueMock.mockResolvedValue({ id: "user-1", email: "erik@example.com" });
    sendPasswordResetEmailMock.mockResolvedValue({ error: "Email delivery isn't configured" });

    const result = await requestPasswordResetAction(
      {},
      formData({ email: "erik@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_RESET_MESSAGE });
  });

  it("still returns the generic message when token creation throws", async () => {
    findUniqueMock.mockResolvedValue({ id: "user-1", email: "erik@example.com" });
    passwordResetTokenCreateMock.mockRejectedValue(new Error("db down"));

    const result = await requestPasswordResetAction(
      {},
      formData({ email: "erik@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_RESET_MESSAGE });
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction rate limiting", () => {
  it("blocks repeated requests for the same email after the limit, without hitting prisma again", async () => {
    findUniqueMock.mockResolvedValue(null);

    for (let i = 0; i < 3; i++) {
      await requestPasswordResetAction({}, formData({ email: "victim@example.com" }));
    }
    findUniqueMock.mockClear();

    const result = await requestPasswordResetAction(
      {},
      formData({ email: "victim@example.com" }),
    );

    expect(result.error).toBe("Too many attempts. Please wait a while and try again.");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("does not rate-limit a different email after another is throttled", async () => {
    findUniqueMock.mockResolvedValue(null);
    for (let i = 0; i < 3; i++) {
      await requestPasswordResetAction({}, formData({ email: "victim@example.com" }));
    }

    const result = await requestPasswordResetAction(
      {},
      formData({ email: "someone-else@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_RESET_MESSAGE });
  });
});

describe("resetPasswordAction validation", () => {
  const validReset = {
    token: "reset-token",
    newPassword: "newsupersecret",
    confirmPassword: "newsupersecret",
  };

  it("rejects a password shorter than 8 characters", async () => {
    const result = await resetPasswordAction(
      {},
      formData({ ...validReset, newPassword: "short", confirmPassword: "short" }),
    );

    expect(result.error).toBe("Password must be at least 8 characters");
    expect(passwordResetTokenFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched password confirmation", async () => {
    const result = await resetPasswordAction(
      {},
      formData({ ...validReset, confirmPassword: "somethingelse" }),
    );

    expect(result.error).toBe("Passwords do not match");
  });
});

describe("resetPasswordAction behavior", () => {
  const validReset = {
    token: "reset-token",
    newPassword: "newsupersecret",
    confirmPassword: "newsupersecret",
  };

  it("rejects an unknown token", async () => {
    passwordResetTokenFindUniqueMock.mockResolvedValue(null);

    const result = await resetPasswordAction({}, formData(validReset));

    expect(result.error).toBe("This password reset link is invalid or has expired. Request a new one.");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    passwordResetTokenFindUniqueMock.mockResolvedValue({
      id: "token-row",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await resetPasswordAction({}, formData(validReset));

    expect(result.error).toBe("This password reset link is invalid or has expired. Request a new one.");
  });

  it("rejects an already-used token", async () => {
    passwordResetTokenFindUniqueMock.mockResolvedValue({
      id: "token-row",
      userId: "user-1",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    const result = await resetPasswordAction({}, formData(validReset));

    expect(result.error).toBe("This password reset link is invalid or has expired. Request a new one.");
  });

  it("updates the password, marks the token used, and redirects on a valid token", async () => {
    passwordResetTokenFindUniqueMock.mockResolvedValue({
      id: "token-row",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    await expect(resetPasswordAction({}, formData(validReset))).rejects.toThrow(
      "REDIRECT:/login?reset=success",
    );

    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});

describe("resetPasswordAction rate limiting", () => {
  it("blocks repeated attempts against the same token after the limit", async () => {
    passwordResetTokenFindUniqueMock.mockResolvedValue(null);
    const reset = { token: "guessed-token", newPassword: "newsupersecret", confirmPassword: "newsupersecret" };

    for (let i = 0; i < 10; i++) {
      await resetPasswordAction({}, formData(reset));
    }
    passwordResetTokenFindUniqueMock.mockClear();

    const result = await resetPasswordAction({}, formData(reset));

    expect(result.error).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(passwordResetTokenFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("verifyEmailAction", () => {
  const validVerify = { token: "verify-token" };

  it("rejects an unknown token", async () => {
    emailVerificationTokenFindUniqueMock.mockResolvedValue(null);

    const result = await verifyEmailAction({}, formData(validVerify));

    expect(result.error).toBe(
      "This verification link is invalid or has expired. Request a new one.",
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects an expired token for a still-unverified account", async () => {
    emailVerificationTokenFindUniqueMock.mockResolvedValue({
      id: "verify-token-row",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { emailVerifiedAt: null },
    });

    const result = await verifyEmailAction({}, formData(validVerify));

    expect(result.error).toBe(
      "This verification link is invalid or has expired. Request a new one.",
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects an already-used token for a still-unverified account", async () => {
    emailVerificationTokenFindUniqueMock.mockResolvedValue({
      id: "verify-token-row",
      userId: "user-1",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      user: { emailVerifiedAt: null },
    });

    const result = await verifyEmailAction({}, formData(validVerify));

    expect(result.error).toBe(
      "This verification link is invalid or has expired. Request a new one.",
    );
  });

  // Idempotency: the account is already verified (e.g. a second, newer link
  // was used first), so this reports success rather than an error even
  // though this particular token is itself used/expired/whatever.
  it("reports already-verified for an account that's already verified, regardless of this token's own state", async () => {
    emailVerificationTokenFindUniqueMock.mockResolvedValue({
      id: "verify-token-row",
      userId: "user-1",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
      user: { emailVerifiedAt: new Date() },
    });

    const result = await verifyEmailAction({}, formData(validVerify));

    expect(result).toEqual({ status: "alreadyVerified" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("marks the user verified and consumes the token on a valid token", async () => {
    emailVerificationTokenFindUniqueMock.mockResolvedValue({
      id: "verify-token-row",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      user: { emailVerifiedAt: null },
    });

    const result = await verifyEmailAction({}, formData(validVerify));

    expect(result).toEqual({ status: "verified" });
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});

describe("verifyEmailAction rate limiting", () => {
  it("blocks repeated attempts against the same token after the limit", async () => {
    emailVerificationTokenFindUniqueMock.mockResolvedValue(null);
    const verify = { token: "guessed-verify-token" };

    for (let i = 0; i < 10; i++) {
      await verifyEmailAction({}, formData(verify));
    }
    emailVerificationTokenFindUniqueMock.mockClear();

    const result = await verifyEmailAction({}, formData(verify));

    expect(result.error).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(emailVerificationTokenFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("resendVerificationEmailAction", () => {
  it("invalidates old tokens, creates a fresh one, and emails it", async () => {
    delete process.env.APP_URL;
    requireUserIdMock.mockResolvedValue("user-1");
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: null,
    });

    const result = await resendVerificationEmailAction({});

    expect(result).toEqual({ sent: true });
    expect(emailVerificationTokenDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
    });
    expect(emailVerificationTokenCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1" }),
    });
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      to: "erik@example.com",
      verifyUrl: "http://localhost:3000/verify-email/generated-verify-token",
    });
  });

  it("short-circuits as already sent when the account is already verified", async () => {
    requireUserIdMock.mockResolvedValue("user-1");
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: new Date(),
    });

    const result = await resendVerificationEmailAction({});

    expect(result).toEqual({ sent: true });
    expect(emailVerificationTokenCreateMock).not.toHaveBeenCalled();
  });

  it("returns an error when sending fails", async () => {
    requireUserIdMock.mockResolvedValue("user-1");
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: null,
    });
    sendVerificationEmailMock.mockResolvedValue({ error: "Email delivery isn't configured" });

    const result = await resendVerificationEmailAction({});

    expect(result.error).toBe("Couldn't send the verification email. Please try again later.");
  });
});

describe("resendVerificationEmailAction rate limiting", () => {
  it("blocks repeated requests for the same user after the limit", async () => {
    requireUserIdMock.mockResolvedValue("user-1");
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: null,
    });

    for (let i = 0; i < 3; i++) {
      await resendVerificationEmailAction({});
    }
    findUniqueMock.mockClear();

    const result = await resendVerificationEmailAction({});

    expect(result.error).toBe("Too many attempts. Please wait a while and try again.");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("does not rate-limit a different user after another is throttled", async () => {
    requireUserIdMock.mockResolvedValue("user-1");
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: null,
    });
    for (let i = 0; i < 3; i++) {
      await resendVerificationEmailAction({});
    }

    requireUserIdMock.mockResolvedValue("user-2");
    findUniqueMock.mockResolvedValue({
      id: "user-2",
      email: "someone-else@example.com",
      emailVerifiedAt: null,
    });

    const result = await resendVerificationEmailAction({});

    expect(result).toEqual({ sent: true });
  });
});
