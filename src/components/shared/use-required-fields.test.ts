import { describe, expect, it } from "vitest";
import { findFieldProblems, findMissingFields, type RequiredRule } from "@/components/shared/use-required-fields";

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

describe("findFieldProblems", () => {
  const passwordRules: RequiredRule[] = [
    {
      name: "password",
      id: "f-password",
      message: "Enter a password",
      invalid: (value) => (value.length < 8 ? "Too short" : undefined),
    },
    {
      name: "confirm",
      id: "f-confirm",
      message: "Confirm it",
      invalid: (value, data) => (value !== data.get("password") ? "No match" : undefined),
    },
  ];

  it("returns nothing when every field is filled and valid", () => {
    expect(findFieldProblems(form({ password: "long-enough", confirm: "long-enough" }), passwordRules)).toEqual([]);
  });

  it("words an empty field with the rule's own message, without running its check", () => {
    expect(findFieldProblems(form({ password: "", confirm: "" }), passwordRules)).toEqual([
      { name: "password", id: "f-password", message: "Enter a password" },
      { name: "confirm", id: "f-confirm", message: "Confirm it" },
    ]);
  });

  it("words a filled field that fails its check with the check's message, in rule order", () => {
    expect(findFieldProblems(form({ password: "short", confirm: "other" }), passwordRules)).toEqual([
      { name: "password", id: "f-password", message: "Too short" },
      { name: "confirm", id: "f-confirm", message: "No match" },
    ]);
  });

  it("gives the check the value as typed, so spaces count towards a password's length", () => {
    expect(findFieldProblems(form({ password: " pass wd ", confirm: " pass wd " }), passwordRules)).toEqual([]);
  });

  it("leaves rules without a check as plain required fields", () => {
    expect(findFieldProblems(form({ name: "Rent", amount: "x" }), rules)).toEqual([
      { name: "amount", id: "f-amount", message: "Enter an amount" },
    ]);
  });
});
