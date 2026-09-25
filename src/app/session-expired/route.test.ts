// Tests the /session-expired Route Handler (SCALE-H). The property that
// matters most is that it only signs out a session a password change has
// actually revoked — it's a GET, so if it signed out unconditionally any
// third-party page could log users out with an <img> tag. Auth and Prisma
// are mocked; no database or real cookie is touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authMock, signOutMock, findUniqueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  signOutMock: vi.fn(async ({ redirectTo }: { redirectTo: string }) => {
    // Auth.js's signOut throws Next's redirect from a Route Handler.
    throw new Error(`REDIRECT:${redirectTo}`);
  }),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock, signOut: signOutMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: findUniqueMock } },
}));

const { GET } = await import("@/app/session-expired/route");

const request = () => new NextRequest("http://localhost:3000/session-expired");
const CHANGED_AT = new Date("2026-09-01T12:00:00.000Z");

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /session-expired", () => {
  it("signs out a session issued before the password change and lands on /login", async () => {
    authMock.mockResolvedValue({
      user: { id: "user-1", pwdChangedAt: CHANGED_AT.getTime() - 1000 },
    });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: CHANGED_AT });

    await expect(GET(request())).rejects.toThrow("REDIRECT:/login?expired=password");
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login?expired=password" });
  });

  it("signs out a session for a user that no longer exists", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue(null);

    await expect(GET(request())).rejects.toThrow("REDIRECT:/login?expired=password");
  });

  it("leaves a still-valid session alone and sends it back to /dashboard", async () => {
    authMock.mockResolvedValue({
      user: { id: "user-1", pwdChangedAt: CHANGED_AT.getTime() },
    });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: CHANGED_AT });

    const response = await GET(request());

    expect(signOutMock).not.toHaveBeenCalled();
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("leaves a never-changed password's session alone", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    findUniqueMock.mockResolvedValue({ passwordChangedAt: null });

    const response = await GET(request());

    expect(signOutMock).not.toHaveBeenCalled();
    expect(response?.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("sends an already-signed-out visitor to /login without touching the DB", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(request());

    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
    expect(response?.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
