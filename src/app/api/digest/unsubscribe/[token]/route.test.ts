// Tests the weekly digest's List-Unsubscribe endpoint (GAP-27): POST is the
// RFC 8058 one-click unsubscribe and acts on the signed token alone; GET
// must never change anything (link scanners prefetch it) and only redirects
// to the confirmation page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDigestUnsubscribeToken } from "@/lib/digest-unsubscribe-token";

const { userUpdateManyMock } = vi.hoisted(() => ({ userUpdateManyMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { updateMany: userUpdateManyMock } } }));

const { GET, POST } = await import("@/app/api/digest/unsubscribe/[token]/route");

const ORIGINAL_ENV = { ...process.env };
const URL_BASE = "https://app.example.com/api/digest/unsubscribe";

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  process.env.AUTH_SECRET = "auth-secret";
  userUpdateManyMock.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("POST (one-click)", () => {
  it("turns the digest off for the token's user", async () => {
    const token = createDigestUnsubscribeToken("user-1", "auth-secret");

    const response = await POST(new Request(`${URL_BASE}/${token}`, { method: "POST" }), ctx(token));

    expect(response.status).toBe(200);
    expect(userUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { weeklyDigestEnabled: false },
    });
  });

  it("rejects a forged token without touching the database", async () => {
    const token = createDigestUnsubscribeToken("user-1", "someone-elses-secret");

    const response = await POST(new Request(`${URL_BASE}/${token}`, { method: "POST" }), ctx(token));

    expect(response.status).toBe(400);
    expect(userUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("redirects to the confirmation page and changes nothing", async () => {
    const token = createDigestUnsubscribeToken("user-1", "auth-secret");

    const response = await GET(new Request(`${URL_BASE}/${token}`), ctx(token));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://app.example.com/unsubscribe/${token}`);
    expect(userUpdateManyMock).not.toHaveBeenCalled();
  });
});
