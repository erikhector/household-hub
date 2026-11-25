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

// UX-30: shares are free text. Money with more than two decimals ("1,200",
// twelve hundred to an English-locale user) is a format error, never 1.2.
describe("typed shares (UX-30)", () => {
  it.each(["abc", "1.234,5", "1e3", "1,200"])("turns down a share of %j as a format error", async (share) => {
    const r = await parseShareSplitFormData(
      form({ splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: [share, "0"] }),
      "h1",
      1200,
      MISMATCH,
    );
    expect(r).toEqual({
      error: "Write the amount with at most two decimals and no thousands separator, like 1200 or 1200.50",
    });
    expect(memberFindManyMock).not.toHaveBeenCalled();
  });

  it("turns down a negative share", async () => {
    const r = await parseShareSplitFormData(
      form({ splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: ["-12,5", "25"] }),
      "h1",
      12.5,
      MISMATCH,
    );
    expect(r).toEqual({ error: "Each split amount must be zero or more" });
  });

  it("reads 12,5, 12,50 and 1 200,50", async () => {
    memberFindManyMock.mockResolvedValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
    const r = await parseShareSplitFormData(
      form({ splitEnabled: "on", splitMemberId: ["m1", "m2", "m3"], splitAmount: ["12,5", "12,50", "1 200,50"] }),
      "h1",
      1225.5,
      MISMATCH,
    );
    expect(r).toEqual([
      { householdMemberId: "m1", amountOwed: 12.5 },
      { householdMemberId: "m2", amountOwed: 12.5 },
      { householdMemberId: "m3", amountOwed: 1200.5 },
    ]);
  });
});
