// Tests the Credentials provider's `authorize` callback directly — the
// per-email login throttle (SEC-1, LOGIN_RATE_LIMIT) and email
// normalization now live here rather than in loginAction (src/lib/actions/
// auth.ts), since Auth.js's own POST /api/auth/callback/credentials route
// calls `authorize` without ever going through that action. All I/O
// (Prisma, bcryptjs, the next-auth package itself) is mocked; the only real
// module exercised is src/lib/rate-limit.ts's in-memory limiter, so these
// tests reset its buckets between runs the same way
// src/lib/actions/auth.test.ts does. See REQUIREMENTS.md's "Testing" and
// "Login rate limiting" sections.
import { afterEach, describe, expect, it, vi } from "vitest";

// Real `next-auth`'s entrypoint imports "next/server", which Vitest's Node
// environment can't resolve outside a Next.js build (same issue
// src/lib/actions/auth.test.ts's own next-auth mock works around) — stand
// in for just what src/lib/auth.ts uses: the `NextAuth` factory (captured
// below so the test can reach into the config it was called with, since
// that's the only way to get at the `authorize` closure) and the
// `CredentialsSignin` base class that EmailNotVerifiedSignin/
// RateLimitedSignin extend.
class CredentialsSignin extends Error {}

const { nextAuthMock, findUniqueMock, compareMock } = vi.hoisted(() => ({
  nextAuthMock: vi.fn(),
  findUniqueMock: vi.fn(),
  compareMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ default: nextAuthMock, CredentialsSignin }));
// The real provider factory just bundles its arguments into the object
// NextAuth's `providers` array holds — mirror that instead of importing the
// real package (which also drags in `next/server` transitively).
vi.mock("next-auth/providers/credentials", () => ({
  default: (config: unknown) => config,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: findUniqueMock } } }));
vi.mock("bcryptjs", () => ({ default: { compare: compareMock } }));

nextAuthMock.mockImplementation(() => ({
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
  auth: vi.fn(),
}));

const { EmailNotVerifiedSignin, RateLimitedSignin } = await import("@/lib/auth");
const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

// The config NextAuth() was called with — providers[0] is the object
// "next-auth/providers/credentials"'s mock above returned unchanged, so
// its `authorize` is the exact closure src/lib/auth.ts defines.
const nextAuthConfig = nextAuthMock.mock.calls[0][0] as {
  providers: Array<{ authorize: (credentials: unknown) => Promise<unknown> }>;
};
const authorize = nextAuthConfig.providers[0].authorize;

const VALID_USER = {
  id: "user-1",
  email: "erik@example.com",
  passwordHash: "hashed",
  displayName: "Erik",
  emailVerifiedAt: new Date("2024-01-01"),
  passwordChangedAt: null,
};

afterEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
});

describe("authorize", () => {
  it("trims and lowercases the email before looking up the account", async () => {
    findUniqueMock.mockResolvedValue(null);

    await authorize({ email: "  Erik@Example.com  ", password: "x" });

    expect(findUniqueMock).toHaveBeenCalledWith({ where: { email: "erik@example.com" } });
  });

  it("returns null for non-string credentials without touching Prisma or bcrypt", async () => {
    const result = await authorize({ email: undefined, password: "x" });

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("returns the user on a correct password for a verified account", async () => {
    findUniqueMock.mockResolvedValue(VALID_USER);
    compareMock.mockResolvedValue(true);

    const result = await authorize({ email: "erik@example.com", password: "supersecret" });

    expect(result).toEqual({
      id: "user-1",
      email: "erik@example.com",
      name: "Erik",
      passwordChangedAt: null,
    });
  });

  it("returns null for an unknown email", async () => {
    findUniqueMock.mockResolvedValue(null);

    const result = await authorize({ email: "nobody@example.com", password: "x" });

    expect(result).toBeNull();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("returns null for a wrong password", async () => {
    findUniqueMock.mockResolvedValue(VALID_USER);
    compareMock.mockResolvedValue(false);

    const result = await authorize({ email: "erik@example.com", password: "wrong" });

    expect(result).toBeNull();
  });

  it("throws EmailNotVerifiedSignin once the password is correct but the account is unverified", async () => {
    findUniqueMock.mockResolvedValue({ ...VALID_USER, emailVerifiedAt: null });
    compareMock.mockResolvedValue(true);

    await expect(authorize({ email: "erik@example.com", password: "supersecret" })).rejects.toBeInstanceOf(
      EmailNotVerifiedSignin,
    );
  });

  // Regression coverage for SEC-1: unlimited password guessing used to be
  // possible against POST /api/auth/callback/credentials, since only
  // loginAction (not `authorize` itself) applied the throttle — see
  // LOGIN_RATE_LIMIT in src/lib/auth.ts.
  it("refuses the 11th authorize call for the same email without calling bcrypt.compare", async () => {
    findUniqueMock.mockResolvedValue(VALID_USER);
    compareMock.mockResolvedValue(false);

    for (let i = 0; i < 10; i++) {
      await authorize({ email: "victim@example.com", password: `guess${i}` });
    }
    expect(compareMock).toHaveBeenCalledTimes(10);
    compareMock.mockClear();
    findUniqueMock.mockClear();

    await expect(
      authorize({ email: "victim@example.com", password: "guess11" }),
    ).rejects.toBeInstanceOf(RateLimitedSignin);
    expect(compareMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("rate-limits per normalized email, so case/whitespace variants share one bucket", async () => {
    findUniqueMock.mockResolvedValue(VALID_USER);
    compareMock.mockResolvedValue(false);

    // Same account, alternating spellings of its email — each must still
    // land in the single "victim@example.com" bucket.
    const spellings = ["victim@example.com", "  Victim@Example.com  ", "VICTIM@example.com"];
    for (let i = 0; i < 10; i++) {
      await authorize({ email: spellings[i % spellings.length], password: `guess${i}` });
    }

    await expect(
      authorize({ email: "VICTIM@EXAMPLE.COM", password: "guess11" }),
    ).rejects.toBeInstanceOf(RateLimitedSignin);
  });

  it("does not rate-limit a different email after another account is throttled", async () => {
    findUniqueMock.mockResolvedValue(VALID_USER);
    compareMock.mockResolvedValue(true);

    for (let i = 0; i < 10; i++) {
      await authorize({ email: "throttled@example.com", password: `guess${i}` });
    }

    const result = await authorize({ email: "erik@example.com", password: "supersecret" });

    expect(result).not.toBeNull();
  });
});
