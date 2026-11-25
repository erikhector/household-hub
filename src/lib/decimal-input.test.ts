import { describe, expect, it } from "vitest";
import { DECIMAL_PATTERN, normalizeDecimal, parseDecimal } from "./decimal-input";

describe("normalizeDecimal", () => {
  it("turns a decimal comma into a dot", () => {
    expect(normalizeDecimal("12,5")).toBe("12.5");
  });

  it("leaves a dot decimal as it is", () => {
    expect(normalizeDecimal("12.5")).toBe("12.5");
  });

  it("drops surrounding whitespace", () => {
    expect(normalizeDecimal(" 12,50 ")).toBe("12.50");
  });

  it("drops spaces between thousands, including sv-SE's no-break spaces", () => {
    expect(normalizeDecimal("1 234,5")).toBe("1234.5");
    expect(normalizeDecimal("1 234,5")).toBe("1234.5");
    expect(normalizeDecimal("1 234,5")).toBe("1234.5");
  });

  it("keeps an empty field empty, so each schema's own empty rule applies", () => {
    expect(normalizeDecimal("")).toBe("");
    expect(normalizeDecimal("   ")).toBe("");
  });

  it("passes a non-string through unchanged", () => {
    expect(normalizeDecimal(null)).toBeNull();
    expect(normalizeDecimal(undefined)).toBeUndefined();
    expect(normalizeDecimal(3)).toBe(3);
  });

  it("never guesses a thousands separator: mixed or repeated separators are not a number", () => {
    expect(normalizeDecimal("1,234.5")).toBeNaN();
    expect(normalizeDecimal("1.234,5")).toBeNaN();
    expect(normalizeDecimal("1,2,3")).toBeNaN();
  });

  it("reads a lone comma group as decimals, as a Swedish user means it", () => {
    expect(normalizeDecimal("1,234")).toBe("1.234");
  });

  it("rejects text and the hex/exponent forms Number would accept", () => {
    expect(normalizeDecimal("abc")).toBeNaN();
    expect(normalizeDecimal("0x10")).toBeNaN();
    expect(normalizeDecimal("1e3")).toBeNaN();
    expect(normalizeDecimal(",")).toBeNaN();
  });

  it("keeps a minus sign so a schema's own 'can't be negative' message applies", () => {
    expect(normalizeDecimal("-2,5")).toBe("-2.5");
  });

  it("accepts a leading or trailing separator", () => {
    expect(normalizeDecimal(",5")).toBe(".5");
    expect(normalizeDecimal("12,")).toBe("12.");
  });
});

describe("parseDecimal", () => {
  it.each([
    ["12,5", 12.5],
    ["12.5", 12.5],
    [" 12,50 ", 12.5],
    ["1 234,5", 1234.5],
    ["0,25", 0.25],
  ])("reads %j as %d", (typed, expected) => {
    expect(parseDecimal(typed)).toBe(expected);
  });

  it("is NaN for an empty field, unlike Number('')", () => {
    expect(parseDecimal("")).toBeNaN();
    expect(parseDecimal("  ")).toBeNaN();
  });

  it("is NaN for text", () => {
    expect(parseDecimal("abc")).toBeNaN();
  });
});

describe("DECIMAL_PATTERN", () => {
  // Browsers anchor `pattern` and compile it with the `v` flag.
  const re = new RegExp(`^(?:${DECIMAL_PATTERN})$`, "v");

  it.each(["12", "12,5", "12.5", "1 234,50", ",5", "0.25"])("accepts %j", (typed) => {
    expect(re.test(typed)).toBe(true);
  });

  it.each(["abc", "1,2,3", "1,234.5", "-5", ",", "1e3"])("rejects %j", (typed) => {
    expect(re.test(typed)).toBe(false);
  });
});
