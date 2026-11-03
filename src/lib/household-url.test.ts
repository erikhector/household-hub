import { describe, expect, it } from "vitest";
import { householdHref, parseHouseholdTab } from "@/lib/household-url";

describe("parseHouseholdTab", () => {
  it("accepts the three tabs", () => {
    expect(parseHouseholdTab("members")).toBe("members");
    expect(parseHouseholdTab("notes")).toBe("notes");
    expect(parseHouseholdTab("settings")).toBe("settings");
  });
  it("falls back to Members for anything else", () => {
    expect(parseHouseholdTab(null)).toBe("members");
    expect(parseHouseholdTab(undefined)).toBe("members");
    expect(parseHouseholdTab("bogus")).toBe("members");
    expect(parseHouseholdTab(["notes", "settings"])).toBe("notes");
  });
});

describe("householdHref", () => {
  it("leaves the default tab out of the URL", () => {
    expect(householdHref()).toBe("/dashboard/household");
    expect(householdHref("notes")).toBe("/dashboard/household?tab=notes");
    expect(householdHref("settings")).toBe("/dashboard/household?tab=settings");
  });
});
