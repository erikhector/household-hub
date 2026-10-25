// Tests src/lib/actions/locale.ts: only known locales are accepted, the cookie
// is set for anonymous callers too, and the account is updated only when
// signed in (a DB failure is logged, never thrown).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieSetMock, authMock, userUpdateMock, loggerErrorMock, revalidatePathMock } = vi.hoisted(() => ({
  cookieSetMock: vi.fn(),
  authMock: vi.fn(),
  userUpdateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSetMock }) }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: userUpdateMock } } }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock } }));

import { setLocaleAction } from "./locale";

describe("setLocaleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores a locale that is not supported", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    await setLocaleAction("fr");
    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("sets the cookie but skips the database for an anonymous visitor", async () => {
    authMock.mockResolvedValue(null);
    await setLocaleAction("sv");
    expect(cookieSetMock).toHaveBeenCalledWith("locale", "sv", { maxAge: 60 * 60 * 24 * 365, path: "/" });
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });

  it("also saves the locale on the signed-in user's own account", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    await setLocaleAction("sv");
    expect(cookieSetMock).toHaveBeenCalledTimes(1);
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "u1" }, data: { locale: "sv" } });
  });

  it("logs a database failure instead of throwing, and still revalidates", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const failure = new Error("db down");
    userUpdateMock.mockRejectedValueOnce(failure);
    await expect(setLocaleAction("en")).resolves.toBeUndefined();
    expect(loggerErrorMock).toHaveBeenCalledWith("Failed to persist locale preference", { error: failure });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });
});
