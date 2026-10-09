import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { passwordResetToken: { findUnique } } }));

import { isPasswordResetTokenUsable } from "./reset-token";
import { hashToken } from "./token-hash";

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe("isPasswordResetTokenUsable", () => {
  beforeEach(() => findUnique.mockReset());

  it("looks the token up by its hash, never the raw value", async () => {
    findUnique.mockResolvedValue(null);
    await isPasswordResetTokenUsable("raw-token");
    expect(findUnique.mock.calls[0][0].where).toEqual({ token: hashToken("raw-token") });
  });

  it("accepts an unused, unexpired token", async () => {
    findUnique.mockResolvedValue({ usedAt: null, expiresAt: future() });
    expect(await isPasswordResetTokenUsable("t")).toBe(true);
  });

  it.each([
    ["unknown", null],
    ["used", { usedAt: new Date(), expiresAt: future() }],
    ["expired", { usedAt: null, expiresAt: past() }],
  ])("rejects a %s token", async (_name, row) => {
    findUnique.mockResolvedValue(row);
    expect(await isPasswordResetTokenUsable("t")).toBe(false);
  });
});
