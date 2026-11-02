// Tests the recipe-discovery Server Actions: tenancy (both queries scoped by
// the session household, redirect from requireHousehold propagates), input
// cleaning, the expiring flag and the error paths. Prisma, session and i18n
// are mocked, so no database is touched. See REQUIREMENTS.md's "Testing".
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, inventoryFindMany, recipeFindMany } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  inventoryFindMany: vi.fn(),
  recipeFindMany: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: { findMany: inventoryFindMany },
    recipe: { findMany: recipeFindMany },
  },
}));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getLocale: async () => "sv",
  getDictionary: async () => ({
    mealPlanning: { discover: { errorLoad: "load-failed", errorNotFound: "not-found" } },
  }),
}));

import { RECIPE_CATALOG } from "@/lib/recipe-catalog/data";
import { getCatalogRecipeAction, searchRecipeCatalogAction } from "./discover-actions";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.resetAllMocks();
  requireHouseholdMock.mockResolvedValue({ household: { id: "h1" } });
  inventoryFindMany.mockResolvedValue([]);
  recipeFindMany.mockResolvedValue([]);
});

describe("searchRecipeCatalogAction", () => {
  it("requires a household", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("redirect"));
    await expect(searchRecipeCatalogAction({ query: "", tags: [] })).rejects.toThrow("redirect");
    expect(inventoryFindMany).not.toHaveBeenCalled();
  });

  it("scopes both queries by the session household", async () => {
    await searchRecipeCatalogAction({ query: "", tags: [] });
    expect(inventoryFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
    expect(recipeFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
  });

  it("cleans input: a non-string query becomes empty and unknown tags are dropped", async () => {
    const res = await searchRecipeCatalogAction({
      query: 42 as unknown as string,
      tags: ["vegan", "bogus"],
    });
    expect(res.results?.length).toBeGreaterThan(0);
    for (const r of res.results!) expect(r.tags).toContain("vegan");
  });

  it("treats a non-array tags value as no filter", async () => {
    const res = await searchRecipeCatalogAction({ query: "", tags: "vegan" as unknown as string[] });
    expect(res.results?.length).toBeGreaterThan(0);
  });

  it("counts expired items as expiring", async () => {
    const recipe = RECIPE_CATALOG[0];
    const ingredient = recipe.ingredients[0].name.sv;
    inventoryFindMany.mockResolvedValue([
      { name: ingredient, quantity: 1, expiresAt: new Date(Date.now() - DAY) },
    ]);
    const res = await searchRecipeCatalogAction({ query: "", tags: [] });
    const hit = res.results!.find((r) => r.id === recipe.id);
    expect(hit?.expiringMatches).toContain(ingredient);
  });

  it("hides recipes the household already saved", async () => {
    recipeFindMany.mockResolvedValue([{ name: RECIPE_CATALOG[0].name.sv }]);
    const res = await searchRecipeCatalogAction({ query: "", tags: [] });
    expect(res.results!.some((r) => r.id === RECIPE_CATALOG[0].id)).toBe(false);
  });

  it("returns errorLoad when the inventory query throws", async () => {
    inventoryFindMany.mockRejectedValue(new Error("db down"));
    expect(await searchRecipeCatalogAction({ query: "", tags: [] })).toEqual({ error: "load-failed" });
  });
});

describe("getCatalogRecipeAction", () => {
  it("requires a household", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("redirect"));
    await expect(getCatalogRecipeAction(RECIPE_CATALOG[0].id)).rejects.toThrow("redirect");
  });

  it("scopes both queries by the session household", async () => {
    await getCatalogRecipeAction(RECIPE_CATALOG[0].id);
    expect(inventoryFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
    expect(recipeFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
  });

  it("returns the localized recipe and one have-flag per ingredient", async () => {
    const recipe = RECIPE_CATALOG[0];
    inventoryFindMany.mockResolvedValue([
      { name: recipe.ingredients[0].name.sv, quantity: 2, expiresAt: null },
    ]);
    const res = await getCatalogRecipeAction(recipe.id);
    expect(res.recipe?.name).toBe(recipe.name.sv);
    expect(res.haves).toHaveLength(recipe.ingredients.length);
    expect(res.haves![0]).toBe(true);
  });

  it("returns errorNotFound for an unknown, non-string or oversized id", async () => {
    for (const id of ["nope", 7, "x".repeat(101)]) {
      expect(await getCatalogRecipeAction(id as unknown as string)).toEqual({ error: "not-found" });
    }
  });

  it("returns errorLoad when the inventory query throws", async () => {
    inventoryFindMany.mockRejectedValue(new Error("db down"));
    expect(await getCatalogRecipeAction(RECIPE_CATALOG[0].id)).toEqual({ error: "load-failed" });
  });
});
