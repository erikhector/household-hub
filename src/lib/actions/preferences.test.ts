import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, userUpdateMock, requireUserIdMock, loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  authMock: vi.fn(),
  userUpdateMock: vi.fn(),
  requireUserIdMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: userUpdateMock } } }));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock } }));

import { setInventoryViewPrefsAction, setThemeAction } from "./preferences";

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

  // Fire-and-forget persistence: a failed write must never reach the caller.
  it("logs a database failure instead of throwing", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const failure = new Error("db down");
    userUpdateMock.mockRejectedValueOnce(failure);
    await expect(setThemeAction("dark")).resolves.toBeUndefined();
    expect(loggerErrorMock).toHaveBeenCalledWith("Failed to persist theme preference", { error: failure });
  });
});

describe("setInventoryViewPrefsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const prefs = { sort: "name" } as never;

  it("saves the prefs on the session user's own account", async () => {
    requireUserIdMock.mockResolvedValue("u1");
    await setInventoryViewPrefsAction(prefs);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { inventoryViewPrefs: prefs },
    });
  });

  it("logs a database failure instead of throwing", async () => {
    requireUserIdMock.mockResolvedValue("u1");
    const failure = new Error("db down");
    userUpdateMock.mockRejectedValueOnce(failure);
    await expect(setInventoryViewPrefsAction(prefs)).resolves.toBeUndefined();
    expect(loggerErrorMock).toHaveBeenCalledWith("Failed to persist inventory view preferences", {
      error: failure,
    });
  });
});
