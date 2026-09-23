import { describe, expect, it } from "vitest";
import {
  AUTO_CATEGORY_KEYS,
  AUTO_CATEGORY_KEYWORDS,
  categoryKeyFromOpenFoodFactsTags,
  guessCategoryKey,
  resolveAutoCategory,
} from "@/lib/inventory/auto-category";
import { normalizeItemName } from "@/lib/item-matching";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

describe("guessCategoryKey", () => {
  it.each([
    ["Milk", "dairy"],
    ["Mjölk", "dairy"],
    ["Ägg", "dairy"],
    ["Eggs", "dairy"],
    ["Bread", "bakery"],
    ["Knäckebröd", "bakery"],
    ["Coffee", "pantry"],
    ["Pasta", "pantry"],
    ["Toilet paper", "bathroom"],
    ["Diskmedel", "cleaning"],
    ["Bananas", "produce"],
    ["Bananer", "produce"],
    ["Tomatoes", "produce"],
    ["Tomater", "produce"],
    ["Strawberries", "produce"],
    ["Gurkor", "produce"],
    ["Kanelbullar", "bakery"],
    ["Räkor", "meat"],
    ["Köttbullar", "meat"],
  ])("files %s under %s (plural and Swedish forms included)", (name, key) => {
    expect(guessCategoryKey(name)).toBe(key);
  });

  it("matches Swedish compounds by their head noun", () => {
    expect(guessCategoryKey("Kycklingfilé")).toBe("meat");
    expect(guessCategoryKey("Vispgrädde")).toBe("dairy");
    expect(guessCategoryKey("Mellanmjölk")).toBe("dairy");
    expect(guessCategoryKey("Apelsinjuice")).toBe("drinks");
    expect(guessCategoryKey("Rödlök")).toBe("produce");
    expect(guessCategoryKey("Vetemjöl")).toBe("pantry");
  });

  it("uses the last word as the head noun", () => {
    expect(guessCategoryKey("Chocolate milk")).toBe("dairy");
    expect(guessCategoryKey("Tomato soup")).toBe("pantry");
    expect(guessCategoryKey("Banana bread")).toBe("bakery");
    expect(guessCategoryKey("Arla mellanmjölk 3%")).toBe("dairy");
  });

  it("lets phrases beat their individual words", () => {
    expect(guessCategoryKey("Peanut butter")).toBe("pantry");
    expect(guessCategoryKey("Dish soap")).toBe("cleaning");
    expect(guessCategoryKey("Hand soap")).toBe("bathroom");
    expect(guessCategoryKey("Vanilla ice cream")).toBe("frozen");
    expect(guessCategoryKey("Fish sticks")).toBe("frozen");
    expect(guessCategoryKey("Krossade tomater")).toBe("pantry");
  });

  it("puts anything frozen in the freezer, whatever the noun", () => {
    expect(guessCategoryKey("Frozen peas")).toBe("frozen");
    expect(guessCategoryKey("Frysta hallon")).toBe("frozen");
  });

  it("prefers a listed exact word over a misleading suffix", () => {
    expect(guessCategoryKey("Jordnötssmör")).toBe("pantry");
    expect(guessCategoryKey("Disksvamp")).toBe("cleaning");
    expect(guessCategoryKey("Aluminium foil")).toBe("cleaning");
    expect(guessCategoryKey("Popcorn")).toBe("pantry");
  });

  it("doesn't treat two-letter words as suffixes", () => {
    // "te" (tea) must not match every word ending in -te.
    expect(guessCategoryKey("Chocolate")).toBe("pantry");
    expect(guessCategoryKey("Te")).toBe("pantry");
    expect(guessCategoryKey("Batterier")).toBeNull();
  });

  it("returns null for names it doesn't know or blank input", () => {
    expect(guessCategoryKey("AA batteries")).toBeNull();
    expect(guessCategoryKey("   ")).toBeNull();
  });
});

describe("categoryKeyFromOpenFoodFactsTags", () => {
  it("uses the most specific tag first", () => {
    expect(categoryKeyFromOpenFoodFactsTags(["en:dairies", "en:milks"])).toBe("dairy");
    expect(
      categoryKeyFromOpenFoodFactsTags(["en:plant-based-foods-and-beverages", "en:beverages", "en:coffees"]),
    ).toBe("pantry");
    expect(categoryKeyFromOpenFoodFactsTags(["en:frozen-foods", "en:frozen-pizzas"])).toBe("frozen");
  });

  it("skips the plant-based catch-all tags instead of calling everything a drink", () => {
    expect(categoryKeyFromOpenFoodFactsTags(["en:plant-based-foods-and-beverages"])).toBeNull();
    expect(
      categoryKeyFromOpenFoodFactsTags(["en:plant-based-foods-and-beverages", "en:plant-based-foods", "en:breads"]),
    ).toBe("bakery");
  });

  it("returns null for no tags", () => {
    expect(categoryKeyFromOpenFoodFactsTags([])).toBeNull();
  });
});

describe("resolveAutoCategory", () => {
  const labels = en.inventory.autoCategories;
  const placeholderCategories = [en.inventory.uncategorized, sv.inventory.uncategorized];

  it("falls back to the dictionary label with no household memory", () => {
    expect(resolveAutoCategory("Mjölk", { knownItems: [], labels, placeholderCategories })).toBe("Dairy & eggs");
  });

  it("lets household memory beat the dictionary (a user's correction sticks)", () => {
    const knownItems = [{ name: "Mjölk", category: "Kylskåp" }];
    expect(resolveAutoCategory("mjölk", { knownItems, labels, placeholderCategories })).toBe("Kylskåp");
    // A confident fuzzy match counts too — a size suffix doesn't make it a new item.
    expect(resolveAutoCategory("Mjölk 3%", { knownItems, labels, placeholderCategories })).toBe("Kylskåp");
  });

  it("ignores household items still sitting in an Uncategorized bucket, in any locale", () => {
    const knownItems = [
      { name: "Milk", category: "Uncategorized" },
      { name: "Mjölk", category: "Okategoriserat" },
    ];
    expect(resolveAutoCategory("Milk", { knownItems, labels, placeholderCategories })).toBe("Dairy & eggs");
  });

  it("doesn't borrow a category from a merely similar-looking name", () => {
    const knownItems = [{ name: "Milk chocolate", category: "Snacks" }];
    expect(resolveAutoCategory("Milk", { knownItems, labels, placeholderCategories })).toBe("Dairy & eggs");
  });

  it("returns null when neither step knows the item", () => {
    expect(resolveAutoCategory("AA batteries", { knownItems: [], labels, placeholderCategories })).toBeNull();
  });
});

describe("keyword table", () => {
  it("never lists the same word under two categories", () => {
    const seen = new Map<string, string>();
    for (const key of AUTO_CATEGORY_KEYS) {
      for (const keyword of AUTO_CATEGORY_KEYWORDS[key]) {
        const normalized = normalizeItemName(keyword);
        expect(seen.get(normalized) ?? key, `"${keyword}" is in both ${seen.get(normalized)} and ${key}`).toBe(key);
        seen.set(normalized, key);
      }
    }
  });

  it("has a label for every key in both locales", () => {
    for (const key of AUTO_CATEGORY_KEYS) {
      expect(en.inventory.autoCategories[key]).toBeTruthy();
      expect(sv.inventory.autoCategories[key]).toBeTruthy();
    }
  });

  it("reuses the starter kits' category names, so kit and auto-filed items share a group", () => {
    for (const dict of [en, sv]) {
      const kitLabels = Object.fromEntries(dict.inventory.starterKits.kits.map((kit) => [kit.id, kit.label]));
      expect(dict.inventory.autoCategories.pantry).toBe(kitLabels.pantryBasics);
      expect(dict.inventory.autoCategories.cleaning).toBe(kitLabels.cleaningSupplies);
      expect(dict.inventory.autoCategories.bathroom).toBe(kitLabels.bathroomEssentials);
    }
  });
});
