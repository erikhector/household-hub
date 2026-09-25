import { describe, expect, it } from "vitest";
import { createDigestUnsubscribeToken, verifyDigestUnsubscribeToken } from "@/lib/digest-unsubscribe-token";

const SECRET = "test-auth-secret";

describe("digest unsubscribe tokens", () => {
  it("round-trips a user id", () => {
    const token = createDigestUnsubscribeToken("user-1", SECRET);
    expect(verifyDigestUnsubscribeToken(token, SECRET)).toBe("user-1");
  });

  it("is URL-safe", () => {
    const token = createDigestUnsubscribeToken("clx123abc", SECRET);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createDigestUnsubscribeToken("user-1", "other-secret");
    expect(verifyDigestUnsubscribeToken(token, SECRET)).toBeNull();
  });

  it("rejects a signature moved onto another user id", () => {
    const token = createDigestUnsubscribeToken("user-1", SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    expect(verifyDigestUnsubscribeToken(`user-2.${signature}`, SECRET)).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "no-dot", ".sig-only", "user-1.", 42, null, undefined, "x".repeat(300)]) {
      expect(verifyDigestUnsubscribeToken(bad, SECRET)).toBeNull();
    }
  });

  it("rejects everything when no secret is configured", () => {
    const token = createDigestUnsubscribeToken("user-1", SECRET);
    expect(verifyDigestUnsubscribeToken(token, undefined)).toBeNull();
    expect(verifyDigestUnsubscribeToken(token, "")).toBeNull();
  });
});
