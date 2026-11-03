// parseShareSplitFormData's own validation messages (MAINT-7): each comes
// back in the request's language, not as English text a caller has to map.
// Prisma and the dictionary are mocked, so no database or request is needed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sv } from "@/lib/i18n/dictionaries/sv";

const { memberFindManyMock, getDictionaryMock } = vi.hoisted(() => ({
  memberFindManyMock: vi.fn(),
  getDictionaryMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { householdMember: { findMany: memberFindManyMock } } }));
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: getDictionaryMock }));

import { parseShareSplitFormData } from "./share-split-form";

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  }
  return fd;
}

const MISMATCH = "shares don't add up";

beforeEach(() => {
  vi.clearAllMocks();
  getDictionaryMock.mockRejectedValue(new Error("no request"));
});

describe("parseShareSplitFormData", () => {
  it("returns null when splitting wasn't requested", async () => {
    expect(await parseShareSplitFormData(form({}), "h1", 100, MISMATCH)).toBeNull();
  });

  it("answers an invalid split in English by default", async () => {
    const r = await parseShareSplitFormData(form({ splitEnabled: "on" }), "h1", 100, MISMATCH);
    expect(r).toEqual({ error: "Invalid split" });
  });

  it("answers in Swedish when the request's language is Swedish", async () => {
    getDictionaryMock.mockResolvedValue(sv);
    const r = await parseShareSplitFormData(
      form({ splitEnabled: "on", splitMemberId: ["m1"], splitAmount: ["-1"] }),
      "h1",
      100,
      MISMATCH,
    );
    expect(r).toEqual({ error: sv.errors.splitAmountNegative });
  });

  it("refuses a member from another household", async () => {
    memberFindManyMock.mockResolvedValue([]);
    const r = await parseShareSplitFormData(
      form({ splitEnabled: "on", splitMemberId: ["mX"], splitAmount: ["100"] }),
      "h1",
      100,
      MISMATCH,
    );
    expect(r).toEqual({ error: "One of the selected members no longer belongs to this household" });
    expect(memberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["mX"] }, householdId: "h1" } }),
    );
  });

  it("uses the caller's message when the shares don't add up", async () => {
    memberFindManyMock.mockResolvedValue([{ id: "m1" }]);
    const r = await parseShareSplitFormData(
      form({ splitEnabled: "on", splitMemberId: ["m1"], splitAmount: ["50"] }),
      "h1",
      100,
      MISMATCH,
    );
    expect(r).toEqual({ error: MISMATCH });
  });

  it("returns the shares when they add up", async () => {
    memberFindManyMock.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    const r = await parseShareSplitFormData(
      form({ splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: ["60", "40"] }),
      "h1",
      100,
      MISMATCH,
    );
    expect(r).toEqual([
      { householdMemberId: "m1", amountOwed: 60 },
      { householdMemberId: "m2", amountOwed: 40 },
    ]);
  });
});
