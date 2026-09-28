// Tests scanShelfPhotoAction's handling of a Gemini reply that isn't JSON.
// requireHousehold, the rate limiter, Prisma and fetch are mocked — no
// database or network call is made. See REQUIREMENTS.md's "Testing".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, checkRateLimitMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { inventoryItem: { findMany: vi.fn(async () => []) } } }));

import { scanShelfPhotoAction } from "./inventory-scan";

const PHOTO = "data:image/jpeg;base64,aGVsbG8=";

function geminiReply(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
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

describe("scanShelfPhotoAction", () => {
  it("logs only the length and start of a non-JSON reply, never the whole thing (SEC-11)", async () => {
    const reply = `I can see a shelf with: ${"a jar of jam, ".repeat(20)}and a note reading TAIL-MARKER-9f3c`;
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply(reply)));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await scanShelfPhotoAction(PHOTO);

    expect(result).toEqual({ error: "analysis_failed" });
    const logged = consoleError.mock.calls.map((args) => String(args[0])).join("\n");
    expect(logged).toContain("returned non-JSON text");
    expect(logged).toContain(`"length":${reply.length}`);
    expect(logged).toContain("I can see a shelf with");
    expect(logged).not.toContain("TAIL-MARKER-9f3c");
  });
});
