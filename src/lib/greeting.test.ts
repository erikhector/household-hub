import { describe, expect, it } from "vitest";
import { firstName, greetingKey } from "./greeting";

describe("greetingKey", () => {
  it("buckets the local hour", () => {
    expect(greetingKey(0)).toBe("morning");
    expect(greetingKey(11)).toBe("morning");
    expect(greetingKey(12)).toBe("afternoon");
    expect(greetingKey(17)).toBe("afternoon");
    expect(greetingKey(18)).toBe("evening");
    expect(greetingKey(23)).toBe("evening");
  });
});

describe("firstName", () => {
  it("takes the first word", () => {
    expect(firstName("Åsa Lindström")).toBe("Åsa");
    expect(firstName("  Åsa   Maria Lindström ")).toBe("Åsa");
  });
  it("keeps a single name and survives an empty one", () => {
    expect(firstName("Åsa")).toBe("Åsa");
    expect(firstName("   ")).toBe("");
  });
});
