import { describe, expect, it } from "vitest";
import {
  findSubstitutionKey,
  SUBSTITUTION_KEYS,
  SUBSTITUTION_NAMES,
} from "./substitutions";
import { normalizeItemName } from "@/lib/item-matching";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

describe("findSubstitutionKey", () => {
  it("matches English and Swedish names to the same key", () => {
    expect(findSubstitutionKey("Buttermilk")).toBe("buttermilk");
    expect(findSubstitutionKey("kärnmjölk")).toBe("buttermilk");
    expect(findSubstitutionKey("Sour cream")).toBe("sourCream");
    expect(findSubstitutionKey("Gräddfil")).toBe("sourCream");
    expect(findSubstitutionKey("Vitlöksklyfta")).toBe("garlic");
  });

  it("ignores case, punctuation and accents-as-typed variants", () => {
    expect(findSubstitutionKey("  CRÈME FRAÎCHE ")).toBe("cremeFraiche");
    expect(findSubstitutionKey("Creme fraiche")).toBe("cremeFraiche");
    expect(findSubstitutionKey("Self-raising flour")).toBe("selfRaisingFlour");
  });

  it("de-pluralizes an English head noun", () => {
    expect(findSubstitutionKey("Eggs")).toBe("egg");
    expect(findSubstitutionKey("shallots")).toBe("shallot");
    expect(findSubstitutionKey("garlic cloves")).toBe("garlic");
  });

  it("requires the whole name to match, so a related product gets no wrong hint", () => {
    // Each of these contains a listed name but is a different ingredient —
    // a swap meant for the listed one would be a wrong instruction.
    expect(findSubstitutionKey("chocolate milk")).toBeNull();
    expect(findSubstitutionKey("egg noodles")).toBeNull();
    expect(findSubstitutionKey("peanut butter")).toBeNull();
    expect(findSubstitutionKey("jordnötssmör")).toBeNull();
    expect(findSubstitutionKey("vitlökspulver")).toBeNull();
  });

  it("returns null for unknown or blank names", () => {
    expect(findSubstitutionKey("saffron")).toBeNull();
    expect(findSubstitutionKey("")).toBeNull();
    expect(findSubstitutionKey("!!!")).toBeNull();
  });
});

describe("substitution table", () => {
  it("lists every name under exactly one key", () => {
    const seen = new Map<string, string>();
    for (const key of SUBSTITUTION_KEYS) {
      for (const name of SUBSTITUTION_NAMES[key]) {
        const normalized = normalizeItemName(name);
        expect(seen.get(normalized), `"${name}" is listed under both ${seen.get(normalized)} and ${key}`).toBeUndefined();
        seen.set(normalized, key);
      }
    }
  });

  it("finds every listed name via its own key", () => {
    for (const key of SUBSTITUTION_KEYS) {
      for (const name of SUBSTITUTION_NAMES[key]) {
        expect(findSubstitutionKey(name)).toBe(key);
      }
    }
  });

  it("has hint text for every key, and only those keys, in both locales", () => {
    const keys = [...SUBSTITUTION_KEYS].sort();
    expect(Object.keys(en.mealPlanning.substitutions).sort()).toEqual(keys);
    expect(Object.keys(sv.mealPlanning.substitutions).sort()).toEqual(keys);
    for (const key of SUBSTITUTION_KEYS) {
      expect(en.mealPlanning.substitutions[key].trim()).not.toBe("");
      expect(sv.mealPlanning.substitutions[key].trim()).not.toBe("");
    }
  });

  it("uses a hint template with the {substitute} placeholder in both locales", () => {
    expect(en.mealPlanning.missingIngredientSubstitutionHint).toContain("{substitute}");
    expect(sv.mealPlanning.missingIngredientSubstitutionHint).toContain("{substitute}");
  });
});
