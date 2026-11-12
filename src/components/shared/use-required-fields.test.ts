import { describe, expect, it } from "vitest";
import { findMissingFields, type RequiredRule } from "@/components/shared/use-required-fields";

const rules: RequiredRule[] = [
  { name: "name", id: "f-name", message: "Enter a name" },
  { name: "amount", id: "f-amount", message: "Enter an amount", numeric: true },
];

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("findMissingFields", () => {
  it("returns nothing when every field is filled", () => {
    expect(findMissingFields(form({ name: "Rent", amount: "12.5" }), rules)).toEqual([]);
  });

  it("flags empty and whitespace-only fields, in rule order", () => {
    const missing = findMissingFields(form({ name: "   ", amount: "" }), rules);
    expect(missing.map((rule) => rule.id)).toEqual(["f-name", "f-amount"]);
  });

  it("flags a field that isn't in the form at all (an unchecked radio group)", () => {
    expect(findMissingFields(form({ name: "Rent" }), rules).map((rule) => rule.name)).toEqual(["amount"]);
  });

  it("treats a non-numeric value in a numeric field as missing, but not in a text field", () => {
    expect(findMissingFields(form({ name: "abc", amount: "abc" }), rules).map((rule) => rule.name)).toEqual(["amount"]);
  });
});
