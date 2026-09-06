import { describe, expect, it } from "vitest";
import { findInventoryMatches, itemNameSimilarity, normalizeItemName } from "./item-matching";

describe("normalizeItemName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeItemName("  Whole   Milk  ")).toBe("whole milk");
  });

  it("strips punctuation", () => {
    expect(normalizeItemName("Ketchup (Heinz)!")).toBe("ketchup heinz");
  });
});

describe("itemNameSimilarity", () => {
  it("scores 1 for names that only differ by case/whitespace/punctuation", () => {
    expect(itemNameSimilarity("Tomato", "tomato")).toBe(1);
    expect(itemNameSimilarity("  Whole Milk", "whole   milk ")).toBe(1);
    expect(itemNameSimilarity("Ketchup!", "ketchup")).toBe(1);
  });

  it("scores a plural/singular near-miss high but below an exact match", () => {
    const score = itemNameSimilarity("Tomatoes", "tomato");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it("scores unrelated names low", () => {
    expect(itemNameSimilarity("Tomato", "Paper towels")).toBeLessThan(0.3);
  });
});

describe("findInventoryMatches", () => {
  const candidates = [
    { id: "1", name: "Tomato" },
    { id: "2", name: "Tomato sauce" },
    { id: "3", name: "Paper towels" },
  ];

  it("returns an empty array when there are no candidates", () => {
    expect(findInventoryMatches("Milk", [])).toEqual([]);
  });

  it("excludes candidates below the score threshold", () => {
    const matches = findInventoryMatches("Tomatoes", candidates, { minScore: 0.9 });
    expect(matches).toEqual([]);
  });

  it("sorts matches best-first and caps at the limit", () => {
    const matches = findInventoryMatches("Tomatoes", candidates, { limit: 1, minScore: 0.3 });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("1");
    expect(matches[0].score).toBeLessThan(1);
  });

  it("gives an exact normalized match a score of 1", () => {
    const matches = findInventoryMatches("tomato", candidates);
    expect(matches[0]).toMatchObject({ id: "1", score: 1 });
  });
});
