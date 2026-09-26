// Pure function, no mocking needed. See the doc comment on isSessionRevoked
// (src/lib/session-revocation.ts) for why each branch exists — src/lib/
// session.ts and src/app/session-expired/route.ts both call through this
// one comparison so they can never disagree about what "revoked" means.
import { describe, expect, it } from "vitest";
import { isSessionRevoked, SESSION_EXPIRED_LOGIN_PATH, SESSION_EXPIRED_PATH } from "@/lib/session-revocation";

describe("isSessionRevoked", () => {
  it("revokes when the user row no longer exists", () => {
    expect(isSessionRevoked(null, 1700000000000)).toBe(true);
    expect(isSessionRevoked(null, null)).toBe(true);
  });

  it("never revokes a user whose password has not changed since the column was added", () => {
    expect(isSessionRevoked({ passwordChangedAt: null }, null)).toBe(false);
    expect(isSessionRevoked({ passwordChangedAt: null }, 1700000000000)).toBe(false);
  });

  it("revokes a token issued before SCALE-H (no claim at all) once the password has changed", () => {
    expect(isSessionRevoked({ passwordChangedAt: new Date("2026-01-01") }, null)).toBe(true);
    expect(isSessionRevoked({ passwordChangedAt: new Date("2026-01-01") }, undefined)).toBe(true);
  });

  it("does not revoke a token stamped with exactly the current passwordChangedAt", () => {
    const changedAt = new Date("2026-01-01T12:00:00.000Z");
    expect(isSessionRevoked({ passwordChangedAt: changedAt }, changedAt.getTime())).toBe(false);
  });

  it("revokes a token stamped with an older passwordChangedAt than the row now has", () => {
    const oldChange = new Date("2026-01-01T12:00:00.000Z").getTime();
    const newChange = new Date("2026-02-01T12:00:00.000Z");
    expect(isSessionRevoked({ passwordChangedAt: newChange }, oldChange)).toBe(true);
  });

  it("does not revoke a token stamped after the row's current value (should not happen, but not a revocation)", () => {
    const rowChange = new Date("2026-01-01T12:00:00.000Z");
    const futureToken = new Date("2026-02-01T12:00:00.000Z").getTime();
    expect(isSessionRevoked({ passwordChangedAt: rowChange }, futureToken)).toBe(false);
  });

  it("exposes the redirect paths session.ts and the sign-out route agree on", () => {
    expect(SESSION_EXPIRED_PATH).toBe("/session-expired");
    expect(SESSION_EXPIRED_LOGIN_PATH).toBe("/login?expired=password");
  });
});
