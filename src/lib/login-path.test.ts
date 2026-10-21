import { describe, expect, it } from "vitest";
import { loginPath } from "./login-path";

describe("loginPath", () => {
  it("is the plain path without an email", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath(null)).toBe("/login");
  });

  it("encodes the email", () => {
    expect(loginPath("a+b@example.com")).toBe("/login?email=a%2Bb%40example.com");
  });

  it("keeps extra params, and works without an email", () => {
    expect(loginPath("a@example.com", { reset: "success" })).toBe(
      "/login?reset=success&email=a%40example.com",
    );
    expect(loginPath(undefined, { reset: "success" })).toBe("/login?reset=success");
  });
});
