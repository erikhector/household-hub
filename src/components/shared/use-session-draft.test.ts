import { describe, expect, it } from "vitest";
import { parseDraft } from "./use-session-draft";

const NAMES = ["displayName", "householdName", "email"] as const;

describe("parseDraft", () => {
  it("returns the stored values for the listed fields", () => {
    const raw = JSON.stringify({ displayName: "Ada", householdName: "Home", email: "ada@example.com" });
    expect(parseDraft(raw, NAMES)).toEqual({ displayName: "Ada", householdName: "Home", email: "ada@example.com" });
  });

  it("never hands back a field that isn't on the allowlist, such as a password", () => {
    const raw = JSON.stringify({ displayName: "Ada", password: "hunter22", confirmPassword: "hunter22" });
    expect(parseDraft(raw, NAMES)).toEqual({ displayName: "Ada" });
  });

  it("drops empty and non-string values", () => {
    const raw = JSON.stringify({ displayName: "", householdName: 42, email: null });
    expect(parseDraft(raw, NAMES)).toEqual({});
  });

  it("treats nothing stored, or something unreadable, as no draft", () => {
    expect(parseDraft(null, NAMES)).toEqual({});
    expect(parseDraft("not json", NAMES)).toEqual({});
    expect(parseDraft("null", NAMES)).toEqual({});
    expect(parseDraft('"a string"', NAMES)).toEqual({});
  });
});
