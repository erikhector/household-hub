import { describe, expect, it } from "vitest";
import { normalizeSearchTerm, transactionMatchesSearch } from "./budget-transaction-search";

const row = { description: "Clas Ohlson", categoryName: "Hem", amount: 340.5 };

describe("transactionMatchesSearch", () => {
  it("matches everything for an empty or blank term", () => {
    expect(transactionMatchesSearch(row, "")).toBe(true);
    expect(transactionMatchesSearch(row, "   ")).toBe(true);
  });

  it("matches a case-insensitive substring of the description", () => {
    expect(transactionMatchesSearch(row, "ohl")).toBe(true);
    expect(transactionMatchesSearch(row, "CLAS")).toBe(true);
    expect(transactionMatchesSearch(row, "ikea")).toBe(false);
  });

  it("matches the category name", () => {
    expect(transactionMatchesSearch(row, "hem")).toBe(true);
    expect(transactionMatchesSearch({ ...row, description: null }, "he")).toBe(true);
  });

  it("matches the amount with a comma or a dot", () => {
    expect(transactionMatchesSearch(row, "340,50")).toBe(true);
    expect(transactionMatchesSearch(row, "340.50")).toBe(true);
    expect(transactionMatchesSearch(row, "340,5")).toBe(true);
    expect(transactionMatchesSearch({ ...row, amount: 340 }, "340")).toBe(true);
    expect(transactionMatchesSearch({ ...row, amount: 340 }, "340,00")).toBe(true);
  });

  it("compares amounts as numbers, not text", () => {
    expect(transactionMatchesSearch(row, "340")).toBe(false);
    expect(transactionMatchesSearch(row, "34")).toBe(false);
    expect(transactionMatchesSearch({ ...row, amount: 0.1 + 0.2 }, "0,30")).toBe(true);
  });

  it("still finds a number written in the description", () => {
    expect(transactionMatchesSearch({ ...row, description: "Hyra 340 extra" }, "340")).toBe(true);
  });

  it("ignores accents and case on both sides", () => {
    expect(transactionMatchesSearch({ ...row, description: "Café Örebro" }, "cafe")).toBe(true);
    expect(transactionMatchesSearch({ ...row, description: "Cafe orebro" }, "CAFÉ ÖREBRO")).toBe(true);
  });

  it("does not read a mixed term as an amount", () => {
    expect(transactionMatchesSearch(row, "340 kr")).toBe(false);
    expect(transactionMatchesSearch(row, "3,4,5")).toBe(false);
  });
});

describe("normalizeSearchTerm", () => {
  it("trims and tolerates missing values", () => {
    expect(normalizeSearchTerm("  milk ")).toBe("milk");
    expect(normalizeSearchTerm(null)).toBe("");
    expect(normalizeSearchTerm(undefined)).toBe("");
  });
});
