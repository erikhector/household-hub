// MAINT-8 — the shared Gemini -> Gemini fallback model -> Anthropic chain.
// `fetch` is stubbed (no network); the logger is silenced since every
// failure path here is exercised on purpose. Covers: how the attempt list is
// built from the environment, the happy path on both providers, the busy
// fallback (and when it must NOT fall through), the shared deadline (too
// little budget left, and the abort firing mid-request), and the "any"
// fallback mode the best-effort category call uses.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  excerptForLog: (text: string) => text,
}));

const { MIN_ATTEMPT_BUDGET_MS, resolveAttempts, runProviderChain } = await import("@/lib/ai/provider-chain");
type ChainRequest = Parameters<typeof runProviderChain<{ items: string[] }>>[1];

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const schema = z.object({ items: z.array(z.string()) });

function request(overrides: Partial<ChainRequest> = {}): ChainRequest {
  return {
    feature: "Test feature",
    systemPrompt: "system",
    userText: "user",
    geminiSchema: { type: "OBJECT" },
    anthropicTool: { name: "report", description: "d", input_schema: { type: "object" } },
    anthropicMaxTokens: 512,
    schema,
    timeoutMs: 50_000,
    fallbackOn: "busy",
    failureLevel: "error",
    ...overrides,
  };
}

const geminiOk = (items: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] }),
});
const anthropicOk = (items: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ content: [{ type: "tool_use", name: "report", input: { items } }] }),
});
const failure = (status: number) => ({ ok: false, status, json: async () => ({ error: { message: "nope" } }) });

function bothKeys() {
  vi.stubEnv("GEMINI_API_KEY", "g-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveAttempts", () => {
  const options = { anthropicModel: "claude-x", geminiFallbackModel: true };

  it("is empty with no key configured", () => {
    expect(resolveAttempts(options)).toEqual([]);
  });

  it("orders Gemini primary, Gemini fallback, then Anthropic", () => {
    bothKeys();
    expect(resolveAttempts(options).map((a) => a.label)).toEqual([
      "gemini:gemini-flash-latest",
      "gemini:gemini-flash-lite-latest",
      "anthropic",
    ]);
  });

  it("skips the Gemini fallback when it resolves to the primary model", () => {
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_MODEL", "pinned");
    vi.stubEnv("GEMINI_FALLBACK_MODEL", "pinned");
    expect(resolveAttempts(options).map((a) => a.label)).toEqual(["gemini:pinned"]);
  });

  it("omits the Gemini fallback model when the caller opts out", () => {
    bothKeys();
    expect(resolveAttempts({ ...options, geminiFallbackModel: false }).map((a) => a.label)).toEqual([
      "gemini:gemini-flash-latest",
      "anthropic",
    ]);
  });

  it("uses Anthropic alone when only its key is set, with the caller's model", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
    expect(resolveAttempts(options)).toEqual([
      { label: "anthropic", kind: "anthropic", apiKey: "a-key", model: "claude-x" },
    ]);
  });
});

describe("runProviderChain", () => {
  it("returns the first Gemini success and sends the image + schema", async () => {
    bothKeys();
    fetchMock.mockResolvedValueOnce(geminiOk(["a"]));
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

    const result = await runProviderChain(
      attempts,
      request({ image: { mediaType: "image/png", base64Data: "AAA" } }),
    );

    expect(result).toEqual({ ok: true, data: { items: ["a"] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("g-key");
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/png", data: "AAA" } },
      { text: "user" },
    ]);
    expect(body.generationConfig.responseSchema).toEqual({ type: "OBJECT" });
  });

  it("calls Anthropic with forced tool use, and a bare string when there is no image", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
    fetchMock.mockResolvedValueOnce(anthropicOk(["b"]));
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

    const result = await runProviderChain(attempts, request());

    expect(result).toEqual({ ok: true, data: { items: ["b"] } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("a-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-x");
    expect(body.max_tokens).toBe(512);
    expect(body.tool_choice).toEqual({ type: "tool", name: "report" });
    expect(body.messages[0].content).toBe("user");
  });

  it.each([429, 503, 529])("falls back through the whole chain on a busy %i", async (status) => {
    bothKeys();
    fetchMock
      .mockResolvedValueOnce(failure(status))
      .mockResolvedValueOnce(failure(status))
      .mockResolvedValueOnce(anthropicOk(["c"]));
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

    const result = await runProviderChain(attempts, request());

    expect(result).toEqual({ ok: true, data: { items: ["c"] } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent",
      "https://api.anthropic.com/v1/messages",
    ]);
  });

  it("reports provider_busy when the last attempt is also busy", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    fetchMock.mockResolvedValue(failure(503));
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: false });

    expect(await runProviderChain(attempts, request())).toEqual({ ok: false, error: "provider_busy" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back on a real failure (400)", async () => {
    bothKeys();
    fetchMock.mockResolvedValueOnce(failure(400));
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

    expect(await runProviderChain(attempts, request())).toEqual({ ok: false, error: "analysis_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-JSON text", { candidates: [{ content: { parts: [{ text: "not json" }] } }] }],
    ["an unexpected shape", { candidates: [{ content: { parts: [{ text: '{"items":"x"}' }] } }] }],
    ["no text at all", { candidates: [] }],
  ])("treats %s as analysis_failed without falling back", async (_name, payload) => {
    bothKeys();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

    expect(await runProviderChain(attempts, request())).toEqual({ ok: false, error: "analysis_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an Anthropic reply without the tool call as analysis_failed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "hi" }] }),
    });
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

    expect(await runProviderChain(attempts, request())).toEqual({ ok: false, error: "analysis_failed" });
  });

  it("reports analysis_failed for an unexpected network error", async () => {
    bothKeys();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

    expect(await runProviderChain(attempts, request())).toEqual({ ok: false, error: "analysis_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("deadline", () => {
    it("does not start another attempt when less than the minimum budget is left", async () => {
      bothKeys();
      fetchMock.mockResolvedValue(failure(503));
      const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

      const result = await runProviderChain(attempts, request({ timeoutMs: MIN_ATTEMPT_BUDGET_MS - 1_000 }));

      expect(result).toEqual({ ok: false, error: "provider_busy" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reports provider_busy, not a raw AbortError, when the timeout fires mid-request", async () => {
      bothKeys();
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );
      const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: true });

      const result = await runProviderChain(attempts, request({ timeoutMs: 20 }));

      expect(result).toEqual({ ok: false, error: "provider_busy" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallbackOn: "any"', () => {
    it("moves on to the next provider after any failure, even a 400 or a bad shape", async () => {
      bothKeys();
      fetchMock.mockResolvedValueOnce(failure(400)).mockResolvedValueOnce(anthropicOk(["d"]));
      const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: false });

      const result = await runProviderChain(attempts, request({ fallbackOn: "any", failureLevel: "warn" }));

      expect(result).toEqual({ ok: true, data: { items: ["d"] } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("moves on after a thrown network error and fails once every attempt has", async () => {
      bothKeys();
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const attempts = resolveAttempts({ anthropicModel: "claude-x", geminiFallbackModel: false });

      const result = await runProviderChain(attempts, request({ fallbackOn: "any", failureLevel: "warn" }));

      expect(result).toEqual({ ok: false, error: "analysis_failed" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
