// Tests recipe-file-actions.ts (GAP-67). All I/O is mocked (Prisma, the
// session, i18n, the rate limiter, next/cache); the parser runs for real on
// archives built by recipe-import/zip-fixture.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  recipeFindManyMock,
  recipeCreateMock,
  inventoryItemFindManyMock,
  transactionMock,
  revalidatePathMock,
  checkRateLimitMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  recipeFindManyMock: vi.fn(),
  recipeCreateMock: vi.fn((args: unknown) => ({ __create: args })),
  inventoryItemFindManyMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  checkRateLimitMock: vi.fn(async () => true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findMany: recipeFindManyMock, create: recipeCreateMock },
    inventoryItem: { findMany: inventoryItemFindManyMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en) };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { en } from "@/lib/i18n/dictionaries/en";
import { buildPaprikaArchive } from "@/lib/recipe-import/zip-fixture";
import { importRecipesFromFileAction, previewRecipeFileAction } from "./recipe-file-actions";

const t = en.mealPlanning;

const archive = buildPaprikaArchive([
  { name: "Pancakes", ingredients: "2 dl flour\n3 eggs", directions: "Fry." },
  { name: "Soup", ingredients: "1 onion" },
  { name: "Stew", ingredients: "500 g beef" },
]);

function upload(bytes: Uint8Array, indexes: number[] = []): FormData {
  const data = new FormData();
  data.set("file", new File([bytes as BlobPart], "export.paprikarecipes"));
  for (const index of indexes) data.append("index", String(index));
  return data;
}

function setup() {
  requireHouseholdMock.mockResolvedValue({ household: { id: "h1" } });
  recipeFindManyMock.mockResolvedValue([]);
  inventoryItemFindManyMock.mockResolvedValue([]);
  transactionMock.mockResolvedValue([]);
}

afterEach(() => {
  vi.clearAllMocks();
  checkRateLimitMock.mockResolvedValue(true);
});

describe("previewRecipeFileAction", () => {
  it("lists the recipes found and flags names already in the household", async () => {
    setup();
    recipeFindManyMock.mockResolvedValue([{ name: " soup" }]);
    const result = await previewRecipeFileAction({}, upload(archive));
    expect(result.preview).toEqual({
      skipped: 0,
      recipes: [
        { index: 0, name: "Pancakes", ingredientCount: 2, exists: false },
        { index: 1, name: "Soup", ingredientCount: 1, exists: true },
        { index: 2, name: "Stew", ingredientCount: 1, exists: false },
      ],
    });
    expect(recipeFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { householdId: "h1" } }));
    expect(recipeCreateMock).not.toHaveBeenCalled();
  });

  it("is keyed on the session household and rate limited", async () => {
    setup();
    checkRateLimitMock.mockResolvedValue(false);
    const result = await previewRecipeFileAction({}, upload(archive));
    expect(result.error).toBe(t.importFileErrorRateLimited);
    expect(checkRateLimitMock).toHaveBeenCalledWith("recipe-file-import:h1", expect.any(Number), expect.any(Number));
    expect(recipeFindManyMock).not.toHaveBeenCalled();
  });

  it("answers a missing file, an unreadable file and an oversized upload with a message", async () => {
    setup();
    expect((await previewRecipeFileAction({}, new FormData())).error).toBe(t.importFileErrorNoFile);
    expect((await previewRecipeFileAction({}, upload(Buffer.from("hello")))).error).toBe(
      t.importFileErrorUnsupported,
    );
    expect((await previewRecipeFileAction({}, upload(new Uint8Array(5 * 1024 * 1024 + 1)))).error).toBe(
      t.importFileErrorTooLarge,
    );
  });
});

describe("importRecipesFromFileAction", () => {
  it("saves only the ticked recipes, scoped to the household, in one transaction", async () => {
    setup();
    const result = await importRecipesFromFileAction({}, upload(archive, [0, 2]));
    expect(result).toEqual({ imported: 2 });
    expect(recipeCreateMock).toHaveBeenCalledTimes(2);
    const first = recipeCreateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(first.data).toMatchObject({ householdId: "h1", name: "Pancakes", instructions: "Fry.", servings: 4 });
    const second = recipeCreateMock.mock.calls[1][0] as { data: Record<string, unknown> };
    expect(second.data).toMatchObject({ householdId: "h1", name: "Stew" });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("links an ingredient only to a pantry item with exactly one matching name", async () => {
    setup();
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "i-flour", name: "Flour" },
      { id: "i-egg-1", name: "Eggs" },
      { id: "i-egg-2", name: "eggs" },
    ]);
    await importRecipesFromFileAction({}, upload(archive, [0]));
    const call = recipeCreateMock.mock.calls[0][0] as {
      data: { ingredients: { create: { name: string; inventoryItemId: string | null }[] } };
    };
    expect(call.data.ingredients.create.map((row) => [row.name, row.inventoryItemId])).toEqual([
      ["flour", "i-flour"],
      ["eggs", null],
    ]);
    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { householdId: "h1" } }));
  });

  it("ignores out-of-range, non-numeric and repeated indexes", async () => {
    setup();
    const data = upload(archive, [1, 1, 7, -1]);
    data.append("index", "abc");
    expect(await importRecipesFromFileAction({}, data)).toEqual({ imported: 1 });
    expect(recipeCreateMock).toHaveBeenCalledTimes(1);
  });

  it("refuses when nothing is selected, and writes nothing", async () => {
    setup();
    const result = await importRecipesFromFileAction({}, upload(archive));
    expect(result.error).toBe(t.importFileErrorNoneSelected);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("is rate limited and writes nothing when over the limit", async () => {
    setup();
    checkRateLimitMock.mockResolvedValue(false);
    const result = await importRecipesFromFileAction({}, upload(archive, [0]));
    expect(result.error).toBe(t.importFileErrorRateLimited);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the save fails", async () => {
    setup();
    transactionMock.mockRejectedValue(new Error("boom"));
    const result = await importRecipesFromFileAction({}, upload(archive, [0]));
    expect(result.error).toBeTruthy();
    expect(result.imported).toBeUndefined();
  });
});
