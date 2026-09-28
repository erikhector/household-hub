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

// Real src/lib/auth.ts's EmailNotVerifiedSignin (see its doc comment there)
// is itself an AuthError subclass — mirrored the same way as the AuthError
// stand-in above so `error instanceof EmailNotVerifiedSignin` in loginAction
// still works against the same mocked class this test constructs.
class EmailNotVerifiedSignin extends AuthError {}

// Same reasoning as EmailNotVerifiedSignin above, for src/lib/auth.ts's
// RateLimitedSignin (thrown by `authorize` when the per-email login
// throttle trips — see SEC-1). The throttle itself now lives inside
// `authorize`, which this file mocks away entirely (signInMock stands in
// for the whole sign-in flow), so the actual rate-limiting is exercised in
// src/lib/auth.test.ts, not here — this file only checks that loginAction
// maps the error to its own "too many attempts" message.
class RateLimitedSignin extends AuthError {}

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
  getLocaleMock,
  pushSubscriptionDeleteManyMock,
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
    pushSubscription: { deleteMany: vi.fn(async () => ({ count: 0 })) },
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
  getLocaleMock: vi.fn(async () => "en"),
  pushSubscriptionDeleteManyMock: vi.fn(async () => ({ count: 0 })),
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
    pushSubscription: { deleteMany: pushSubscriptionDeleteManyMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/auth", () => ({
  signIn: signInMock,
  signOut: signOutMock,
  EmailNotVerifiedSignin,
  RateLimitedSignin,
}));
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
// src/lib/i18n/get-dictionary.ts pulls in next/headers cookies() and
// @/lib/preferences (itself pulling in @/lib/auth + @/lib/prisma) — mock the
// whole module rather than those transitively, same reasoning as the
// @/lib/session mock above.
vi.mock("@/lib/i18n/get-dictionary", () => ({ getLocale: getLocaleMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const {
  signupAction,
  loginAction,
  logoutAction,
  requestPasswordResetAction,
  resetPasswordAction,
  verifyEmailAction,
  resendVerificationEmailAction,
  resendVerificationEmailForLoginAction,
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
  confirmPassword: "supersecret",
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
  getLocaleMock.mockImplementation(async () => "en");
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

  // signupAction no longer signs the new account in (see its doc comment in
  // src/lib/actions/auth.ts) — the first sign-in is hard-gated on email
  // verification (EmailNotVerifiedSignin, src/lib/auth.ts), so a session
  // handed out here would bypass that gate entirely.
  it("creates the user/household, does not sign in, and reports the pending verification", async () => {
    findUniqueMock.mockResolvedValue(null);

    const result = await signupAction({}, formData(validSignup));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(signInMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "verification-sent", email: validSignup.email });
  });

  // Regression coverage for task L: a fresh signup must also create an
  // EmailVerificationToken and email it — see EMAIL_VERIFICATION_TOKEN_TTL_MS
  // and sendVerificationEmail in src/lib/actions/auth.ts / src/lib/email.ts.
  it("creates a verification token and emails it for a new signup", async () => {
    delete process.env.APP_URL;
    findUniqueMock.mockResolvedValue(null);

    await signupAction({}, formData(validSignup));

    expect(emailVerificationTokenCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "new-user" }),
    });
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      to: validSignup.email,
      verifyUrl: "http://localhost:3000/verify-email/generated-verify-token",
      locale: "en",
    });
  });

  // Additive, not a hard dependency (see signupAction's doc comment) — the
  // account must still be created even if the verification email fails to
  // send or the token can't be created. A1: the failure is no longer
  // silently swallowed — it's surfaced via `emailError` so the UI can tell
  // the user to use "resend" instead of claiming success outright.
  it("still creates the account when sending the verification email fails", async () => {
    findUniqueMock.mockResolvedValue(null);
    emailVerificationTokenCreateMock.mockRejectedValue(new Error("db down"));

    const result = await signupAction({}, formData(validSignup));

    expect(result).toEqual({
      status: "verification-sent",
      email: validSignup.email,
      emailError: true,
    });
  });
});

describe("loginAction", () => {
  it("returns a friendly error on invalid credentials", async () => {
    signInMock.mockRejectedValue(new AuthError("CredentialsSignin"));

    const result = await loginAction({}, formData({ email: "erik@example.com", password: "x" }));

    expect(result.error).toBe("Invalid email or password");
    expect(result.unverifiedEmail).toBeUndefined();
  });

  // Regression coverage for the hard-gated signup flow: a correct password
  // on an unverified account must be reported distinctly from wrong
  // credentials, with the offer to resend (see EmailNotVerifiedSignin in
  // src/lib/auth.ts).
  it("returns the unverified-email state when the password is correct but the account isn't verified", async () => {
    signInMock.mockRejectedValue(new EmailNotVerifiedSignin());

    const result = await loginAction(
      {},
      formData({ email: "erik@example.com", password: "supersecret" }),
    );

    expect(result.unverifiedEmail).toBe("erik@example.com");
    expect(result.error).toBeTruthy();
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

  // Regression coverage for SEC-1: the per-email login throttle moved into
  // `authorize` itself (src/lib/auth.ts), so it fires on every call to
  // signIn — including the /api/auth/callback/credentials route that never
  // goes through loginAction at all — not just here. loginAction's own job
  // is now just to translate the RateLimitedSignin that `authorize` throws
  // into this friendly copy; the throttle's actual counting is covered in
  // src/lib/auth.test.ts.
  it("shows the rate-limit message when signIn reports the account is throttled", async () => {
    signInMock.mockRejectedValue(new RateLimitedSignin());

    const result = await loginAction(
      {},
      formData({ email: "victim@example.com", password: "guess11" }),
    );

    expect(result.error).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(result.unverifiedEmail).toBeUndefined();
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
    findUniqueMock.mockResolvedValue({ id: "user-1", email: "erik@example.com", locale: "en" });
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
      locale: "en",
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

  // SCALE-H: the reset must also bump passwordChangedAt in the same update,
  // or sessions issued before it (possibly an attacker's) keep working.
  it("stamps passwordChangedAt alongside the new hash, revoking older sessions", async () => {
    passwordResetTokenFindUniqueMock.mockResolvedValue({
      id: "token-row",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    const txUserUpdate = vi.fn(async () => ({}));
    transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: { update: txUserUpdate },
        passwordResetToken: {
          update: vi.fn(async () => ({})),
          deleteMany: vi.fn(async () => ({ count: 0 })),
        },
        pushSubscription: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      }),
    );
    const before = Date.now();

    await expect(resetPasswordAction({}, formData(validReset))).rejects.toThrow(
      "REDIRECT:/login?reset=success",
    );

    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: expect.any(String), passwordChangedAt: expect.any(Date) },
    });
    const [[{ data }]] = txUserUpdate.mock.calls as unknown as [
      [{ data: { passwordChangedAt: Date } }],
    ];
    expect(data.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  // SEC-5: a reset often means someone else had the account — every push
  // subscription for this user must stop receiving household pushes too,
  // not just get its session revoked.
  it("drops every push subscription for this user on a successful reset", async () => {
    passwordResetTokenFindUniqueMock.mockResolvedValue({
      id: "token-row",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    const txPushSubscriptionDeleteMany = vi.fn(async () => ({ count: 0 }));
    transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: { update: vi.fn(async () => ({})) },
        passwordResetToken: {
          update: vi.fn(async () => ({})),
          deleteMany: vi.fn(async () => ({ count: 0 })),
        },
        pushSubscription: { deleteMany: txPushSubscriptionDeleteMany },
      }),
    );

    await expect(resetPasswordAction({}, formData(validReset))).rejects.toThrow(
      "REDIRECT:/login?reset=success",
    );

    expect(txPushSubscriptionDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });
});

describe("logoutAction", () => {
  it("signs out without touching push subscriptions when no endpoint is given", async () => {
    await logoutAction();

    expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login" });
  });

  // SEC-5: logging out on a device drops that device's push subscription too,
  // scoped to the signed-in user so a stale or foreign endpoint can't be used
  // to delete someone else's row.
  it("drops only the given endpoint for the signed-in user", async () => {
    await logoutAction("https://fcm.googleapis.com/fcm/send/abc");

    expect(requireUserIdMock).toHaveBeenCalled();
    expect(pushSubscriptionDeleteManyMock).toHaveBeenCalledWith({
      where: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", userId: "user-1" },
    });
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login" });
  });

  // logoutAction is a public Server Action, so a tampered/malformed client
  // call could hand it anything, not just a string — this must degrade to
  // a plain sign-out instead of Prisma throwing on a non-string `where`.
  it("treats a non-string endpoint as absent rather than erroring", async () => {
    // @ts-expect-error deliberately calling with the wrong type
    await logoutAction({ malicious: true });

    expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login" });
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
      locale: "en",
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
      locale: "en",
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

const GENERIC_VERIFICATION_RESENT_MESSAGE =
  "If that account needs verifying, we've sent a fresh verification link. Check your inbox.";

// The signed-out counterpart to resendVerificationEmailAction above, reached
// from LoginForm once loginAction reports an unverified account. Mirrors
// requestPasswordResetAction's enumeration-safety tests: same generic
// message whether or not the account exists, is already verified, or
// sending fails.
describe("resendVerificationEmailForLoginAction", () => {
  it("returns the generic message and sends no email for an unknown address", async () => {
    findUniqueMock.mockResolvedValue(null);

    const result = await resendVerificationEmailForLoginAction(
      {},
      formData({ email: "nobody@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_VERIFICATION_RESENT_MESSAGE });
    expect(emailVerificationTokenCreateMock).not.toHaveBeenCalled();
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });

  it("returns the generic message and sends no email for an already-verified account", async () => {
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: new Date(),
    });

    const result = await resendVerificationEmailForLoginAction(
      {},
      formData({ email: "erik@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_VERIFICATION_RESENT_MESSAGE });
    expect(emailVerificationTokenCreateMock).not.toHaveBeenCalled();
  });

  it("invalidates old tokens, creates a fresh one, and emails it for an unverified account", async () => {
    delete process.env.APP_URL;
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: null,
      locale: "en",
    });

    const result = await resendVerificationEmailForLoginAction(
      {},
      formData({ email: "Erik@Example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_VERIFICATION_RESENT_MESSAGE });
    expect(emailVerificationTokenDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
    });
    expect(emailVerificationTokenCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1" }),
    });
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      to: "erik@example.com",
      verifyUrl: "http://localhost:3000/verify-email/generated-verify-token",
      locale: "en",
    });
  });

  it("still returns the generic message when sending fails", async () => {
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "erik@example.com",
      emailVerifiedAt: null,
    });
    sendVerificationEmailMock.mockResolvedValue({ error: "Email delivery isn't configured" });

    const result = await resendVerificationEmailForLoginAction(
      {},
      formData({ email: "erik@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_VERIFICATION_RESENT_MESSAGE });
  });
});

describe("resendVerificationEmailForLoginAction rate limiting", () => {
  it("blocks repeated requests for the same email after the limit, without hitting prisma again", async () => {
    findUniqueMock.mockResolvedValue(null);

    for (let i = 0; i < 3; i++) {
      await resendVerificationEmailForLoginAction({}, formData({ email: "victim@example.com" }));
    }
    findUniqueMock.mockClear();

    const result = await resendVerificationEmailForLoginAction(
      {},
      formData({ email: "victim@example.com" }),
    );

    expect(result.error).toBe("Too many attempts. Please wait a while and try again.");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("does not rate-limit a different email after another is throttled", async () => {
    findUniqueMock.mockResolvedValue(null);
    for (let i = 0; i < 3; i++) {
      await resendVerificationEmailForLoginAction({}, formData({ email: "victim@example.com" }));
    }

    const result = await resendVerificationEmailForLoginAction(
      {},
      formData({ email: "someone-else@example.com" }),
    );

    expect(result).toEqual({ message: GENERIC_VERIFICATION_RESENT_MESSAGE });
  });
});
