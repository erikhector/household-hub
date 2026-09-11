// Tests src/app/dashboard/profile/actions.ts, with particular attention to
// updateEmailAction/updatePasswordAction's re-authentication gate (both
// require the *current password*, not just a valid session, before changing
// a security-sensitive credential — see the doc comment on
// updateEmailSchema in the source) and updatePasswordAction's forced
// sign-out afterward. All I/O (Prisma, bcrypt, requireHousehold, signOut,
// next/cache) is mocked — no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";

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
  transactionMock,
  signOutMock,
  bcryptCompareMock,
  bcryptHashMock,
  revalidatePathMock,
  toFriendlyErrorMock,
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
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({
      household: { delete: householdDeleteMock },
      householdMember: { delete: householdMemberDeleteMock },
      user: { delete: userDeleteMock },
    }),
  ),
  signOutMock: vi.fn(),
  bcryptCompareMock: vi.fn(),
  bcryptHashMock: vi.fn(async () => "hashed"),
  revalidatePathMock: vi.fn(),
  toFriendlyErrorMock: vi.fn(() => ({ error: "Something went wrong. Please try again." })),
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

const { updateProfileAction, updateEmailAction, updatePasswordAction, deleteAccountAction } =
  await import("@/app/dashboard/profile/actions");
const { Prisma } = await import("@/generated/prisma/client");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ userId: "user-1" });
  requireUserIdMock.mockResolvedValue("user-1");
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

  it("updates the email for the caller's own account once password and uniqueness both check out", async () => {
    userFindUniqueOrThrowMock.mockResolvedValue({ id: "user-1", email: "old@example.com", passwordHash: "hash" });
    bcryptCompareMock.mockResolvedValue(true);
    userFindUniqueMock.mockResolvedValue(null);
    userUpdateMock.mockResolvedValue({});

    const result = await updateEmailAction({}, formData(base));

    expect(result).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "new@example.com" },
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
      data: { passwordHash: "hashed" },
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
