// Tests importRecipeFromPhotoAction: the tenancy check, the
// unconfigured/invalid/failed paths and the happy-path mapping. requireHousehold,
// the rate limiter, i18n and fetch are mocked — no database or network call
// is made. See REQUIREMENTS.md's "Testing".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, checkRateLimitMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: async () => ({
    mealPlanning: {
      importErrorRateLimited: "rate",
      importPhotoErrorNotConfigured: "not-configured",
      importPhotoErrorInvalid: "invalid",
      importPhotoErrorBusy: "busy",
      importPhotoErrorFailed: "failed",
      importPhotoErrorNoRecipe: "no-recipe",
    },
  }),
}));

import { importRecipeFromPhotoAction } from "./recipe-photo-actions";

const PHOTO = "data:image/jpeg;base64,aGVsbG8=";

function geminiReply(answer: unknown) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" } });
  checkRateLimitMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("importRecipeFromPhotoAction", () => {
  it("requires a household session and rate-limits per household", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply({ name: "A", ingredients: ["2 ägg"], steps: [] })));
    await importRecipeFromPhotoAction(PHOTO);
    expect(requireHouseholdMock).toHaveBeenCalledTimes(1);
    expect(checkRateLimitMock).toHaveBeenCalledWith("recipe-photo-import:household-1", 20, 60 * 60 * 1000);
  });

  it("does not run for a caller without a household", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("redirect"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(importRecipeFromPhotoAction(PHOTO)).rejects.toThrow("redirect");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers not-configured, without calling a provider, when neither key is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await importRecipeFromPhotoAction(PHOTO)).toEqual({ error: "not-configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at the rate limit", async () => {
    checkRateLimitMock.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await importRecipeFromPhotoAction(PHOTO)).toEqual({ error: "rate" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects anything but a JPEG/PNG/WebP data URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await importRecipeFromPhotoAction("https://example.com/a.jpg")).toEqual({ error: "invalid" });
    expect(await importRecipeFromPhotoAction("data:image/gif;base64,aGVsbG8=")).toEqual({ error: "invalid" });
    expect(await importRecipeFromPhotoAction(`data:image/png;base64,${"a".repeat(6_000_001)}`)).toEqual({
      error: "invalid",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a good read into the URL import's recipe shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiReply({ name: "Pannkakor", ingredients: ["2 dl vetemjöl", "3 ägg"], steps: ["Vispa.", "Stek."] }),
      ),
    );
    const result = await importRecipeFromPhotoAction(PHOTO);
    expect(result.error).toBeUndefined();
    expect(result.recipe).toMatchObject({
      name: "Pannkakor",
      instructions: "Vispa.\nStek.",
      ingredients: [
        { quantity: 2, unit: "dl", name: "vetemjöl" },
        { quantity: 3, name: "ägg" },
      ],
    });
  });

  it("reports no recipe when the photo had nothing usable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply({ name: "", ingredients: [], steps: [] })));
    expect(await importRecipeFromPhotoAction(PHOTO)).toEqual({ error: "no-recipe" });
  });

  it("reports a busy provider and a failed read distinctly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 503 })));
    expect(await importRecipeFromPhotoAction(PHOTO)).toEqual({ error: "busy" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })));
    expect(await importRecipeFromPhotoAction(PHOTO)).toEqual({ error: "failed" });
  });
});
