// Tests lookupBarcodeAction's pre-network guards: the household-session
// requirement and the barcode-format validation that short-circuits before
// ever calling Open Food Facts, plus the response mapping (with `fetch`
// stubbed) now that the product's category tags are used too (AUTO-2).
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock } = vi.hoisted(() => ({ requireHouseholdMock: vi.fn() }));

vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en) };
});

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

  // AUTO-2: the category tags Open Food Facts already sends back are mapped
  // to an auto-category instead of being thrown away.
  it("maps the product's Open Food Facts category tags to a localized category", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 1,
        product: { product_name: "Mellanmjölk 1,5%", categories_tags: ["en:dairies", "en:milks"] },
      }),
    });

    expect(await lookupBarcodeAction("7310865004703")).toEqual({ name: "Mellanmjölk 1,5%", category: "Dairy & eggs" });
  });

  it("returns a null category when the tags don't map to anything", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: "Mystery", categories_tags: "not-an-array" } }),
    });

    expect(await lookupBarcodeAction("7310865004703")).toEqual({ name: "Mystery", category: null });
  });
});
