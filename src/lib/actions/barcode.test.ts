// Tests lookupBarcodeAction's pre-network guards: the household-session
// requirement and the barcode-format validation that short-circuits before
// ever calling Open Food Facts. The network call itself is intentionally
// left untested, matching the convention already documented in
// src/lib/recipe-import.ts ("fetchRecipeHtml is the only part that touches
// the network and isn't exercised by tests").
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock } = vi.hoisted(() => ({ requireHouseholdMock: vi.fn() }));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));

const { lookupBarcodeAction } = await import("@/lib/actions/barcode");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" } });
});
requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" } });

describe("lookupBarcodeAction", () => {
  it("requires an authenticated household session before doing anything else", async () => {
    await lookupBarcodeAction("not-a-real-barcode");
    expect(requireHouseholdMock).toHaveBeenCalled();
  });

  it("returns null without ever calling the network for a malformed barcode", async () => {
    const result = await lookupBarcodeAction("abc");

    expect(result).toEqual({ name: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
