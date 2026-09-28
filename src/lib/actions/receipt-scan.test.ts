// Tests scanReceiptPhotoAction's handling of a Gemini reply that isn't
// JSON. requireHousehold, the rate limiter and fetch are mocked — no
// database or network call is made. See REQUIREMENTS.md's "Testing".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, checkRateLimitMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));

import { scanReceiptPhotoAction } from "./receipt-scan";

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

describe("scanReceiptPhotoAction", () => {
  it("logs only the length and start of a non-JSON reply, never the whole thing (SEC-11)", async () => {
    // The card and loyalty numbers sit past the first 200 characters, like
    // the payment block at the bottom of a real receipt.
    const reply = `Sure! Here is what I read off the receipt: ${"MJOLK 1,5L 14.90 ".repeat(20)}VISA **** 4242 BONUS 7350012345678`;
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply(reply)));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await scanReceiptPhotoAction(PHOTO);

    expect(result).toEqual({ error: "analysis_failed" });
    const logged = consoleError.mock.calls.map((args) => String(args[0])).join("\n");
    expect(logged).toContain("returned non-JSON text");
    expect(logged).toContain(`"length":${reply.length}`);
    expect(logged).toContain("Sure! Here is what I read off the receipt");
    expect(logged).not.toContain("4242");
    expect(logged).not.toContain("7350012345678");
  });
});
