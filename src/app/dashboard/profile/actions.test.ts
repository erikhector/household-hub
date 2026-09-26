// Tests src/app/dashboard/profile/actions.ts, with particular attention to
// updateEmailAction/updatePasswordAction's re-authentication gate (both
// require the *current password*, not just a valid session, before changing
// a security-sensitive credential — see the doc comment on
// updateEmailSchema in the source) and updatePasswordAction's forced
// sign-out afterward. All I/O (Prisma, bcrypt, requireHousehold, signOut,
// next/cache) is mocked — no database is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  requireUserIdMock,
  userUpdateMock,
  userFindUniqueMock,
  userFindUniqueOrThrowMock,
  userDeleteMock,
  householdMemberFindManyMock,
  householdMemberDeleteMock,
  householdDeleteMock,
  transactionSplitFindManyMock,
  transactionSplitUpdateMock,
  emailVerificationTokenCreateMock,
  emailVerificationTokenDeleteManyMock,
  transactionMock,
  signOutMock,
  bcryptCompareMock,
  bcryptHashMock,
  revalidatePathMock,
  toFriendlyErrorMock,
  sendVerificationEmailMock,
  headersMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  requireUserIdMock: vi.fn(),
  userUpdateMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userFindUniqueOrThrowMock: vi.fn(),
  userDeleteMock: vi.fn(),
  householdMemberFindManyMock: vi.fn(),
  householdMemberDeleteMock: vi.fn(),
  householdDeleteMock: vi.fn(),
  // settleDepartingMemberSplits' two calls (src/lib/settle-departing-member.ts,
  // called from deleteAccountAction for each CONTRIBUTOR membership) —
  // defaults to no other members' splits so tests that don't care about
  // splitting keep passing unchanged.
  transactionSplitFindManyMock: vi.fn(async () => []),
  transactionSplitUpdateMock: vi.fn(async () => ({})),
  emailVerificationTokenCreateMock: vi.fn(async () => ({ token: "generated-token" })),
  emailVerificationTokenDeleteManyMock: vi.fn(async () => ({ count: 0 })),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({
      household: { delete: householdDeleteMock },
      householdMember: { delete: householdMemberDeleteMock },
      user: { delete: userDeleteMock },
      transactionSplit: { findMany: transactionSplitFindManyMock, update: transactionSplitUpdateMock },
    }),
  ),
  signOutMock: vi.fn(),
  bcryptCompareMock: vi.fn(),
  bcryptHashMock: vi.fn(async () => "hashed"),
  revalidatePathMock: vi.fn(),
  toFriendlyErrorMock: vi.fn(() => ({ error: "Something went wrong. Please try again." })),
  sendVerificationEmailMock: vi.fn(async () => ({})),
  headersMock: vi.fn(async () => new Map([["host", "example.com"]])),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: userUpdateMock,
      findUnique: userFindUniqueMock,
      findUniqueOrThrow: userFindUniqueOrThrowMock,
      delete: userDeleteMock,
    },
    householdMember: {
      findMany: householdMemberFindManyMock,
      delete: householdMemberDeleteMock,
    },
    household: {
      delete: householdDeleteMock,
    },
    emailVerificationToken: {
      create: emailVerificationTokenCreateMock,
      deleteMany: emailVerificationTokenDeleteManyMock,
    },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({
  requireHousehold: requireHouseholdMock,
  requireUserId: requireUserIdMock,
}));
vi.mock("@/lib/auth", () => ({ signOut: signOutMock }));
vi.mock("bcryptjs", () => ({
  default: { compare: bcryptCompareMock, hash: bcryptHashMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/actions/errors", () => ({ toFriendlyError: toFriendlyErrorMock }));
// src/lib/email.ts imports "server-only", which Vitest's Node environment
// can't resolve outside a Next.js build — stub it out, same as
// src/lib/actions/auth.test.ts does.
vi.mock("@/lib/email", () => ({ sendVerificationEmail: sendVerificationEmailMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
// src/lib/i18n/get-dictionary.ts imports "server-only" (see the src/lib/email
// comment above) and reads cookies() — stub it, same as
// src/app/dashboard/inventory/actions.test.ts, returning the real English
// string so the SEC-6 rate-limit tests below assert against the actual
// dictionary text rather than a hand-typed duplicate.
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => ({ profile: { reauthRateLimited: en.profile.reauthRateLimited } })) };
});

const {
  updateProfileAction,
  updateSwishNumberAction,
  updateEmailAction,
  updatePasswordAction,
  deleteAccountAction,
} = await import("@/app/dashboard/profile/actions");
const { Prisma } = await import("@/generated/prisma/client");
// SEC-6's rate limiter is exercised for real below (not mocked, same as
// src/lib/actions/auth.test.ts) so its own dedicated describe block can
// assert the real fixed-window behavior. Every other test in this file
// reuses the same "user-1" reauth:<userId> bucket, so it must be cleared
// after every test — otherwise unrelated "wrong password" tests earlier in
// the file would themselves use up the budget and start tripping the
// limiter here instead of returning their expected error.
const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ userId: "user-1" });
  requireUserIdMock.mockResolvedValue("user-1");
  _resetRateLimitsForTests();
});
requireHouseholdMock.mockResolvedValue({ userId: "user-1" });
requireUserIdMock.mockResolvedValue("user-1");

describe("updateProfileAction", () => {
  it("rejects an empty display name", async () => {
    const result = await updateProfileAction({}, formData({ displayName: " " }));
    expect(result.error).toBe("Name is required");
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("updates only the caller's own user record", async () => {
    userUpdateMock.mockResolvedValue({});

    const result = await updateProfileAction({}, formData({ displayName: "Erik" }));

    expect(result).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { displayName: "Erik" },
    });
  });
});

describe("updateSwishNumberAction (GAP-7)", () => {
  it("stores a locally written number in Swish's alias format, on the caller's own row", async () => {
    userUpdateMock.mockResolvedValue({});

    const result = await updateSwishNumberAction({}, formData({ swishNumber: "070-123 45 67" }));

    expect(result).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { swishNumber: "46701234567" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/budget");
  });

  it("clears the number when the field is left blank", async () => {
    userUpdateMock.mockResolvedValue({});

    const result = await updateSwishNumberAction({}, formData({ swishNumber: "  " }));

    expect(result).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { swishNumber: null },
    });
  });

  it("rejects a number that isn't a Swedish mobile number", async () => {
    const result = await updateSwishNumberAction({}, formData({ swishNumber: "08-123 456 78" }));

    expect(result.error).toBe("Enter a Swedish mobile number, like 070-123 45 67");
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("ignores any user id the client tries to send", async () => {
    userUpdateMock.mockResolvedValue({});

    await updateSwishNumberAction({}, formData({ swishNumber: "0701234567", userId: "someone-else" }));

    expect(userUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }));
  });
});

describe("updateEmailAction (re-authentication gate)", () => {
  const base = { newEmail: "new@example.com", currentPassword: "correct-password" };

  it("rejects an invalid new email", async () => {
    const result = await updateEmailAction({}, formData({ ...base, newEmail: "not-an-email" }));
    expect(result.error).toBe("Enter a valid email");
    expect(userFindUniqueOrThrowMock).not.toHaveBeenCalled();
  });

  it("refuses the change when the current password is wrong — a valid session alone is not enough", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", email: "old@example.com", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(false);

    const result = await updateEmailAction({}, formData(base));

    expect(result.error).toBe("Current password is incorrect");
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects setting the same email it already is", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", email: "new@example.com", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);

    const result = await updateEmailAction({}, formData(base));

    expect(result.error).toBe("That's already your email");
  });

  it("rejects an email already registered to a different account (prevents account takeover via email swap)", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", email: "old@example.com", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);
    userFindUniqueMock.mockResolvedValue({ id: "other-user" });

    const result = await updateEmailAction({}, formData(base));

    expect(result.error).toBe("An account with that email already exists");
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("updates the email, resets verification status, and sends a fresh verification email to the new address", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({
      id: "user-1",
      email: "old@example.com",
      passwordHash: "hash",
      locale: "sv",
    });
    bcryptCompareMock.mockResolvedValue(true);
    userFindUniqueMock.mockResolvedValue(null);
    userUpdateMock.mockResolvedValue({});

    const result = await updateEmailAction({}, formData(base));

    expect(result).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "new@example.com", emailVerifiedAt: null },
    });
    // Old unused tokens (e.g. from a previous email change) are invalidated
    // first, same as resendVerificationEmailAction.
    expect(emailVerificationTokenDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
    });
    expect(emailVerificationTokenCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1" }),
    });
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      to: "new@example.com",
      verifyUrl: expect.stringContaining("/verify-email/generated-token"),
      locale: "sv",
    });
  });

  it("still succeeds when sending the verification email fails — the email change itself is not rolled back", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({
      id: "user-1",
      email: "old@example.com",
      passwordHash: "hash",
      locale: "en",
    });
    bcryptCompareMock.mockResolvedValue(true);
    userFindUniqueMock.mockResolvedValue(null);
    userUpdateMock.mockResolvedValue({});
    sendVerificationEmailMock.mockRejectedValueOnce(new Error("delivery down"));

    const result = await updateEmailAction({}, formData(base));

    expect(result).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "new@example.com", emailVerifiedAt: null },
    });
  });

  it("reports the friendly already-exists message when the update itself races into a unique-constraint violation", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", email: "old@example.com", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);
    userFindUniqueMock.mockResolvedValue(null);
    userUpdateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const result = await updateEmailAction({}, formData(base));

    expect(result.error).toBe("An account with that email already exists");
    expect(toFriendlyErrorMock).not.toHaveBeenCalled();
  });

  it("falls through to toFriendlyError for an update failure unrelated to a unique-constraint violation", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", email: "old@example.com", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);
    userFindUniqueMock.mockResolvedValue(null);
    const dbError = new Error("Connection timed out");
    userUpdateMock.mockRejectedValue(dbError);

    const result = await updateEmailAction({}, formData(base));

    expect(toFriendlyErrorMock).toHaveBeenCalledWith(dbError);
    expect(result).toEqual({ error: "Something went wrong. Please try again." });
  });
});

describe("updatePasswordAction (re-authentication gate + forced sign-out)", () => {
  const base = {
    currentPassword: "correct-password",
    newPassword: "new-password-123",
    confirmPassword: "new-password-123",
  };

  it("rejects a new password shorter than 8 characters", async () => {
    const result = await updatePasswordAction(
      {},
      formData({ ...base, newPassword: "short", confirmPassword: "short" }),
    );
    expect(result.error).toBe("Password must be at least 8 characters");
  });

  it("rejects mismatched confirmation", async () => {
    const result = await updatePasswordAction({}, formData({ ...base, confirmPassword: "different" }));
    expect(result.error).toBe("Passwords do not match");
  });

  it("refuses the change when the current password is wrong", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(false);

    const result = await updatePasswordAction({}, formData(base));

    expect(result.error).toBe("Current password is incorrect");
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("hashes the new password (bcrypt cost 12), updates only the caller's account, and forces sign-out", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", passwordHash: "old-hash" });
    bcryptCompareMock.mockResolvedValue(true);
    userUpdateMock.mockResolvedValue({});
    signOutMock.mockResolvedValue(undefined);

    await updatePasswordAction({}, formData(base));

    expect(bcryptHashMock).toHaveBeenCalledWith("new-password-123", 12);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      // passwordChangedAt revokes the user's other sessions (SCALE-H).
      data: { passwordHash: "hashed", passwordChangedAt: expect.any(Date) },
    });
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});

describe("deleteAccountAction (re-authentication gate + per-membership rules)", () => {
  const base = { currentPassword: "correct-password" };

  it("rejects an empty current password", async () => {
    const result = await deleteAccountAction({}, formData({ currentPassword: "" }));
    expect(result.error).toBe("Current password is required");
    expect(userFindUniqueOrThrowMock).not.toHaveBeenCalled();
  });

  it("refuses to delete when the current password is wrong — a valid session alone is not enough", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(false);

    const result = await deleteAccountAction({}, formData(base));

    expect(result.error).toBe("Current password is incorrect");
    expect(householdMemberFindManyMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("removes only the HouseholdMember row for a plain CONTRIBUTOR membership, then deletes the user", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);
    householdMemberFindManyMock.mockResolvedValue([
      {
        id: "membership-1",
        householdId: "household-1",
        role: "CONTRIBUTOR",
        household: { name: "The Hectors", members: [{ id: "membership-1" }, { id: "membership-2" }] },
      },
    ]);
    signOutMock.mockResolvedValue(undefined);

    const result = await deleteAccountAction({}, formData(base));

    expect(result).toEqual({});
    expect(householdDeleteMock).not.toHaveBeenCalled();
    expect(householdMemberDeleteMock).toHaveBeenCalledWith({ where: { id: "membership-1" } });
    expect(userDeleteMock).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login?deleted=success" });
  });

  it("deletes the whole household when the caller is its OWNER and only member, then deletes the user", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);
    householdMemberFindManyMock.mockResolvedValue([
      {
        id: "membership-1",
        householdId: "household-1",
        role: "OWNER",
        household: { name: "Solo House", members: [{ id: "membership-1" }] },
      },
    ]);
    signOutMock.mockResolvedValue(undefined);

    const result = await deleteAccountAction({}, formData(base));

    expect(result).toEqual({});
    expect(householdDeleteMock).toHaveBeenCalledWith({ where: { id: "household-1" } });
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
    expect(userDeleteMock).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login?deleted=success" });
  });

  it("blocks deletion when the caller is OWNER of a household with other members, without touching any data", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);
    householdMemberFindManyMock.mockResolvedValue([
      {
        id: "membership-1",
        householdId: "household-1",
        role: "OWNER",
        household: { name: "The Hectors", members: [{ id: "membership-1" }, { id: "membership-2" }] },
      },
    ]);

    const result = await deleteAccountAction({}, formData(base));

    expect(result.error).toContain("The Hectors");
    expect(transactionMock).not.toHaveBeenCalled();
    expect(householdDeleteMock).not.toHaveBeenCalled();
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
    expect(userDeleteMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });
});

// SEC-6: a hijacked/left-open session could otherwise brute-force the
// current-password re-auth check on any of these three actions with no
// limit. checkRateLimit is exercised for real here (not mocked), keyed
// only by userId, so the budget is shared *across* the three actions —
// each `it` below drives it right up to the limit with one action before
// checking that the 6th attempt, even against a *different* action, is
// refused without ever reaching bcrypt.compare.
describe("re-authentication rate limiting (SEC-6)", () => {
  const emailBase = { newEmail: "new@example.com", currentPassword: "wrong-password" };
  const passwordBase = {
    currentPassword: "wrong-password",
    newPassword: "new-password-123",
    confirmPassword: "new-password-123",
  };
  const deleteBase = { currentPassword: "wrong-password" };

  beforeEach(() => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", email: "old@example.com", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(false);
  });

  it("refuses updateEmailAction's 6th attempt without calling bcrypt.compare", async () => {
    for (let i = 0; i < 5; i++) {
      await updateEmailAction({}, formData(emailBase));
    }
    bcryptCompareMock.mockClear();

    const result = await updateEmailAction({}, formData(emailBase));

    expect(result.error).toBe("Too many attempts. Please wait 15 minutes and try again.");
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it("refuses updatePasswordAction's 6th attempt without calling bcrypt.compare", async () => {
    for (let i = 0; i < 5; i++) {
      await updatePasswordAction({}, formData(passwordBase));
    }
    bcryptCompareMock.mockClear();

    const result = await updatePasswordAction({}, formData(passwordBase));

    expect(result.error).toBe("Too many attempts. Please wait 15 minutes and try again.");
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it("refuses deleteAccountAction's 6th attempt without calling bcrypt.compare", async () => {
    for (let i = 0; i < 5; i++) {
      await deleteAccountAction({}, formData(deleteBase));
    }
    bcryptCompareMock.mockClear();

    const result = await deleteAccountAction({}, formData(deleteBase));

    expect(result.error).toBe("Too many attempts. Please wait 15 minutes and try again.");
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it("shares one budget across all three actions, so mixing them still trips the limit on the 6th attempt", async () => {
    await updateEmailAction({}, formData(emailBase));
    await updatePasswordAction({}, formData(passwordBase));
    await deleteAccountAction({}, formData(deleteBase));
    await updateEmailAction({}, formData(emailBase));
    await updatePasswordAction({}, formData(passwordBase));
    bcryptCompareMock.mockClear();

    const result = await deleteAccountAction({}, formData(deleteBase));

    expect(result.error).toBe("Too many attempts. Please wait 15 minutes and try again.");
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });
});
