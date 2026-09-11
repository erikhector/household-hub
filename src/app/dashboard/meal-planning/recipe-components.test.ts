// See src/app/dashboard/meal-planning/recipe-actions.test.ts for the mocking
// convention this mirrors: prisma is mocked, no database is touched.
import { describe, expect, it, vi } from "vitest";

const { recipeComponentFindManyMock } = vi.hoisted(() => ({
  recipeComponentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { recipeComponent: { findMany: recipeComponentFindManyMock } },
}));

const { getDescendantRecipeIds, wouldCreateCycle } = await import(
  "@/app/dashboard/meal-planning/recipe-components"
);

// A tiny in-memory "contains" graph — recipeComponentFindManyMock resolves
// each BFS layer from `edges` the way prisma.recipeComponent.findMany would.
function mockGraph(edges: Record<string, string[]>) {
  recipeComponentFindManyMock.mockImplementation(
    async ({ where }: { where: { parentRecipeId: { in: string[] } } }) => {
      const componentRecipeIds = where.parentRecipeId.in.flatMap((id) => edges[id] ?? []);
      return componentRecipeIds.map((componentRecipeId) => ({ componentRecipeId }));
    },
  );
}

describe("getDescendantRecipeIds", () => {
  it("includes the starting recipe itself", async () => {
    mockGraph({});
    const result = await getDescendantRecipeIds("lasagna");
    expect(result).toEqual(new Set(["lasagna"]));
  });

  it("follows direct components", async () => {
    mockGraph({ lasagna: ["bolognese", "bechamel"] });
    const result = await getDescendantRecipeIds("lasagna");
    expect(result).toEqual(new Set(["lasagna", "bolognese", "bechamel"]));
  });

  it("follows transitive components several levels deep", async () => {
    mockGraph({
      lasagna: ["bolognese"],
      bolognese: ["tomato-sauce"],
      "tomato-sauce": ["tomato-base"],
    });
    const result = await getDescendantRecipeIds("lasagna");
    expect(result).toEqual(new Set(["lasagna", "bolognese", "tomato-sauce", "tomato-base"]));
  });

  it("does not loop forever if a cycle already exists in the data", async () => {
    mockGraph({ a: ["b"], b: ["a"] });
    const result = await getDescendantRecipeIds("a");
    expect(result).toEqual(new Set(["a", "b"]));
  });
});

describe("wouldCreateCycle", () => {
  it("rejects a direct self-reference", async () => {
    mockGraph({});
    expect(await wouldCreateCycle("lasagna", "lasagna")).toBe(true);
  });

  it("rejects adding a component that already (transitively) contains the parent", async () => {
    // bolognese already contains lasagna somehow — adding bolognese as
    // lasagna's component would close the loop.
    mockGraph({ bolognese: ["lasagna"] });
    expect(await wouldCreateCycle("lasagna", "bolognese")).toBe(true);
  });

  it("allows adding an unrelated recipe as a component", async () => {
    mockGraph({ bolognese: ["tomato-sauce"] });
    expect(await wouldCreateCycle("lasagna", "bolognese")).toBe(false);
  });

  it("allows reusing the same sub-recipe in two different parents (a diamond, not a cycle)", async () => {
    mockGraph({ bolognese: [], bechamel: [] });
    expect(await wouldCreateCycle("lasagna", "bolognese")).toBe(false);
    expect(await wouldCreateCycle("moussaka", "bolognese")).toBe(false);
  });
});
