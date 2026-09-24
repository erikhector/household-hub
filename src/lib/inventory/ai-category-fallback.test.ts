// AUTO-2b(a) — the optional AI fallback tier. Covers: no key configured
// (never calls the network or the rate limiter), rate-limited (never calls
// the network), a successful Gemini call resolving names to categories, and
// a hallucinated/invalid category being clamped away rather than trusted.
// checkRateLimit is mocked (see @/lib/rate-limit) and `fetch` is stubbed —
// no real network call, no database — following the convention in
// src/lib/actions/barcode.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const { checkRateLimitMock } = vi.hoisted(() => ({ checkRateLimitMock: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
// Silences the module's own warn/error logging so test output stays clean —
// every failure path here is deliberately exercised, not a real bug.
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { resolveCategoriesWithAiFallback, isAiCategoryFallbackConfigured } = await import(
  "@/lib/inventory/ai-category-fallback"
);

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function geminiResponse(categories: string[]) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ categories }) }] } }],
    }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("isAiCategoryFallbackConfigured", () => {
  it("is false with neither GEMINI_API_KEY nor ANTHROPIC_API_KEY set", () => {
    expect(isAiCategoryFallbackConfigured()).toBe(false);
  });

  it("is true once either key is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    expect(isAiCategoryFallbackConfigured()).toBe(true);
  });
});

describe("resolveCategoriesWithAiFallback", () => {
  it("returns an empty map and never touches the network or the rate limiter when no key is configured", async () => {
    const result = await resolveCategoriesWithAiFallback("household-1", ["Cumin"]);

    expect(result.size).toBe(0);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty map and never calls the network when the household is rate-limited", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    checkRateLimitMock.mockResolvedValue(false);

    const result = await resolveCategoriesWithAiFallback("household-1", ["Cumin"]);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves names to categories via the mocked provider call, batched in one request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    checkRateLimitMock.mockResolvedValue(true);
    fetchMock.mockResolvedValueOnce(geminiResponse(["pantry", "cleaning"]));

    const result = await resolveCategoriesWithAiFallback("household-1", ["Ground Cumin", "Dish Soap"]);

    expect(result.get("Ground Cumin")).toBe("pantry");
    expect(result.get("Dish Soap")).toBe("cleaning");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only the bare names are sent — nothing else about the household.
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toBe(JSON.stringify(["Ground Cumin", "Dish Soap"]));
  });

  it("clamps a hallucinated category to unresolved instead of writing something outside AUTO_CATEGORY_KEYS", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    checkRateLimitMock.mockResolvedValue(true);
    // "electronics" isn't one of AUTO_CATEGORY_KEYS — a hallucination.
    fetchMock.mockResolvedValueOnce(geminiResponse(["dairy", "electronics"]));

    const result = await resolveCategoriesWithAiFallback("household-1", ["Milk", "Phone Charger"]);

    expect(result.get("Milk")).toBe("dairy");
    expect(result.has("Phone Charger")).toBe(false);
  });

  it("treats the model's own \"unknown\" answer the same as no match", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    checkRateLimitMock.mockResolvedValue(true);
    fetchMock.mockResolvedValueOnce(geminiResponse(["unknown"]));

    const result = await resolveCategoriesWithAiFallback("household-1", ["AA batteries"]);

    expect(result.size).toBe(0);
  });

  it("falls back to Anthropic when Gemini's call fails and both keys are set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    checkRateLimitMock.mockResolvedValue(true);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: { message: "overloaded" } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: "tool_use", name: "report_categories", input: { categories: ["produce"] } }] }),
      });

    const result = await resolveCategoriesWithAiFallback("household-1", ["Banana"]);

    expect(result.get("Banana")).toBe("produce");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty map (never throws) when every configured provider fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    checkRateLimitMock.mockResolvedValue(true);
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(resolveCategoriesWithAiFallback("household-1", ["Milk"])).resolves.toEqual(new Map());
  });

  it("returns an empty map for a blank/whitespace-only name list without calling anything", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await resolveCategoriesWithAiFallback("household-1", ["   ", ""]);

    expect(result.size).toBe(0);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });
});
