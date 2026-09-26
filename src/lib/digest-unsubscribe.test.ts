// Tests unsubscribeFromDigestByToken directly. Prisma is mocked (no
// database touched); the signature verifier is mocked too so this file
// only exercises what digest-unsubscribe.ts itself does — token
// verification has its own unit test in digest-unsubscribe-token.test.ts,
// and the two RFC 8058 entry points that call through this function have
// their own route/action tests (see route.test.ts and digest.test.ts next
// to those files).
import { afterEach, describe, expect, it, vi } from "vitest";

const { userUpdateManyMock, verifyDigestUnsubscribeTokenMock } = vi.hoisted(() => ({
  userUpdateManyMock: vi.fn(),
  verifyDigestUnsubscribeTokenMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { updateMany: userUpdateManyMock } } }));
vi.mock("@/lib/digest-unsubscribe-token", () => ({
  verifyDigestUnsubscribeToken: verifyDigestUnsubscribeTokenMock,
}));

const { unsubscribeFromDigestByToken } = await import("@/lib/digest-unsubscribe");

afterEach(() => {
  vi.clearAllMocks();
});

describe("unsubscribeFromDigestByToken", () => {
  it("returns 'invalid' and never touches the database when the token doesn't verify", async () => {
    verifyDigestUnsubscribeTokenMock.mockReturnValue(null);

    const result = await unsubscribeFromDigestByToken("garbage");

    expect(result).toBe("invalid");
    expect(userUpdateManyMock).not.toHaveBeenCalled();
  });

  it("turns the digest off for exactly the verified user id, using updateMany so a deleted account is a no-op rather than a throw", async () => {
    verifyDigestUnsubscribeTokenMock.mockReturnValue("user-1");
    userUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await unsubscribeFromDigestByToken("user-1.signature");

    expect(result).toBe("unsubscribed");
    expect(userUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { weeklyDigestEnabled: false },
    });
  });

  it("passes the raw token straight through to the verifier, whatever its type", async () => {
    verifyDigestUnsubscribeTokenMock.mockReturnValue(null);

    await unsubscribeFromDigestByToken(undefined);

    expect(verifyDigestUnsubscribeTokenMock).toHaveBeenCalledWith(undefined, process.env.AUTH_SECRET);
  });

  it("is idempotent: unsubscribing an already-unsubscribed user still reports success", async () => {
    verifyDigestUnsubscribeTokenMock.mockReturnValue("user-1");
    userUpdateManyMock.mockResolvedValue({ count: 1 });

    const first = await unsubscribeFromDigestByToken("user-1.signature");
    const second = await unsubscribeFromDigestByToken("user-1.signature");

    expect(first).toBe("unsubscribed");
    expect(second).toBe("unsubscribed");
    expect(userUpdateManyMock).toHaveBeenCalledTimes(2);
  });
});
