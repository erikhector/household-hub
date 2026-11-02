// Tests the recipe-discovery Server Actions: tenancy (both queries scoped by
// the session household, redirect from requireHousehold propagates), input
// cleaning, the expiring flag and the error paths. Prisma, session and i18n
// are mocked, so no database is touched. See REQUIREMENTS.md's "Testing".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, inventoryFindMany, recipeFindMany, checkRateLimitMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  inventoryFindMany: vi.fn(),
  recipeFindMany: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
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
    mealPlanning: {
      discover: {
        errorLoad: "load-failed",
        errorNotFound: "not-found",
        ideasNotConfigured: "not-configured",
        ideasRateLimited: "rate",
        ideasBusy: "busy",
        ideasFailed: "failed",
        ideasNone: "none",
      },
    },
  }),
}));

import { RECIPE_CATALOG } from "@/lib/recipe-catalog/data";
import { getCatalogRecipeAction, searchRecipeCatalogAction, suggestRecipeIdeasAction } from "./discover-actions";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.resetAllMocks();
  requireHouseholdMock.mockResolvedValue({ household: { id: "h1" } });
  inventoryFindMany.mockResolvedValue([]);
  recipeFindMany.mockResolvedValue([]);
  checkRateLimitMock.mockResolvedValue(true);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

  it("treats a missing or non-object input as no query and no filter", async () => {
    for (const input of [null, undefined, "vegan", 3]) {
      const res = await searchRecipeCatalogAction(input as unknown as { query: string; tags: string[] });
      expect(res.results?.length).toBeGreaterThan(0);
    }
  });

  it("caps the query at 100 characters rather than rejecting it", async () => {
    const name = RECIPE_CATALOG[0].name.sv;
    // Past the cap only padding is cut, so the recipe is still found.
    const res = await searchRecipeCatalogAction({ query: name + " ".repeat(200) + "zzz", tags: [] });
    expect(res.results!.some((r) => r.id === RECIPE_CATALOG[0].id)).toBe(true);
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
    expect(inventoryFindMany).not.toHaveBeenCalled();
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

  it("returns errorNotFound, flagged notFound, for an unknown, non-string or oversized id", async () => {
    for (const id of ["nope", 7, "x".repeat(101), null, undefined, { id: "x" }]) {
      expect(await getCatalogRecipeAction(id as unknown as string)).toEqual({ error: "not-found", notFound: true });
    }
    expect(inventoryFindMany).not.toHaveBeenCalled();
  });

  it("returns errorLoad when the inventory query throws", async () => {
    inventoryFindMany.mockRejectedValue(new Error("db down"));
    expect(await getCatalogRecipeAction(RECIPE_CATALOG[0].id)).toEqual({ error: "load-failed" });
  });
});

function geminiReply(answer: unknown) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
    { status: 200 },
  );
}

const IDEA = {
  name: "Pasta med tomat",
  servings: 4,
  ingredients: [{ name: "pasta", quantity: 400, unit: "g" }],
  instructions: ["Koka."],
  tags: [],
};

describe("suggestRecipeIdeasAction", () => {
  it("ideas: requires a household", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("redirect"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(suggestRecipeIdeasAction({ tags: [] })).rejects.toThrow("redirect");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ideas: not configured without a key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await suggestRecipeIdeasAction({ tags: [] })).toEqual({ error: "not-configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ideas: rate limited per household", async () => {
    checkRateLimitMock.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await suggestRecipeIdeasAction({ tags: [] })).toEqual({ error: "rate" });
    expect(checkRateLimitMock).toHaveBeenCalledWith("recipe-ideas:h1", 20, 3600000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ideas: a pantry load failure is ideasFailed", async () => {
    inventoryFindMany.mockRejectedValue(new Error("db"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await suggestRecipeIdeasAction({ tags: [] })).toEqual({ error: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ideas: busy and failed map to their errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 503 })));
    expect(await suggestRecipeIdeasAction({ tags: [] })).toEqual({ error: "busy" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })));
    expect(await suggestRecipeIdeasAction({ tags: [] })).toEqual({ error: "failed" });
  });

  it("ideas: zero valid ideas returns ideasNone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply({ recipes: [{ ...IDEA, ingredients: [] }] })));
    expect(await suggestRecipeIdeasAction({ tags: [] })).toEqual({ error: "none" });
  });

  it("ideas: returns mapped ideas and sends names only", async () => {
    inventoryFindMany.mockResolvedValue([{ name: "pasta", quantity: 777, expiresAt: null }]);
    const fetchMock = vi.fn(async () => geminiReply({ recipes: [IDEA] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await suggestRecipeIdeasAction({ tags: ["vegan", "bogus"] });
    expect(res.error).toBeUndefined();
    expect(res.ideas).toHaveLength(1);
    expect(res.ideas![0].name).toBe("Pasta med tomat");
    const body = String((fetchMock.mock.calls[0] as unknown[])[1] ? ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body : "");
    expect(body).toContain("pasta");
    expect(body).not.toContain("777");
  });
});
