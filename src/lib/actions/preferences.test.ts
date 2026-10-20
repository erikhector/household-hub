import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, userUpdateMock, requireUserIdMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  userUpdateMock: vi.fn(),
  requireUserIdMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: userUpdateMock } } }));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { setThemeAction } from "./preferences";

describe("setThemeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the theme on the signed-in user's own account", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    await setThemeAction("light");
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "u1" }, data: { theme: "light" } });
  });

  // Logged-out pages have a theme toggle (UX-51); a redirect to /login from
  // a server action would navigate the visitor away from the page.
  it("does nothing for a logged-out visitor, and does not redirect", async () => {
    authMock.mockResolvedValue(null);
    await setThemeAction("dark");
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(requireUserIdMock).not.toHaveBeenCalled();
  });

  it("ignores a value that is not a theme", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    await setThemeAction("purple" as never);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
