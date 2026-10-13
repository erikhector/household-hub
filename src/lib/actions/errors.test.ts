import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

const { getDictionaryMock } = vi.hoisted(() => ({ getDictionaryMock: vi.fn() }));
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: getDictionaryMock }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { errorText, fail, toFriendlyError, v, zodFail } from "./errors";

beforeEach(() => {
  getDictionaryMock.mockReset();
  getDictionaryMock.mockResolvedValue(en);
});

describe("errorText / fail", () => {
  it("answers in the request's language", async () => {
    expect(await fail("itemNotFound")).toEqual({ error: "Item not found" });
    getDictionaryMock.mockResolvedValue(sv);
    expect(await fail("itemNotFound")).toEqual({ error: "Varan hittades inte" });
  });

  it("fills in placeholders", async () => {
    getDictionaryMock.mockResolvedValue(sv);
    expect(await errorText("tooManyItemsAtOnce", { max: 50 })).toBe(
      "Du kan uppdatera högst 50 varor åt gången",
    );
  });

  it("falls back to English when the dictionary can't be read", async () => {
    getDictionaryMock.mockRejectedValue(new Error("outside a request"));
    expect(await errorText("listNotEditable")).toBe(en.errors.listNotEditable);
  });
});

describe("zodFail", () => {
  const schema = z.object({
    name: z.string().trim().min(1, v("nameRequired")),
    other: z.string().min(3),
  });

  it("translates a schema message that is an errors key", async () => {
    getDictionaryMock.mockResolvedValue(sv);
    const parsed = schema.safeParse({ name: " ", other: "abc" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(await zodFail(parsed.error)).toEqual({ error: sv.errors.nameRequired });
  });

  it("never leaks Zod's English default text: it uses the fallback key", async () => {
    getDictionaryMock.mockResolvedValue(sv);
    const parsed = schema.safeParse({ name: "ok", other: "a" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(await zodFail(parsed.error)).toEqual({ error: sv.errors.invalidInput });
      expect(await zodFail(parsed.error, "invalidCategory")).toEqual({ error: sv.errors.invalidCategory });
    }
  });
});

describe("toFriendlyError", () => {
  it("returns the generic message in the request's language", async () => {
    getDictionaryMock.mockResolvedValue(sv);
    expect(await toFriendlyError(new Error("db down"))).toEqual({ error: sv.errors.generic });
  });
});

describe("dictionaries", () => {
  it("every errors key has text in both languages", () => {
    expect(Object.keys(sv.errors).sort()).toEqual(Object.keys(en.errors).sort());
    for (const [key, text] of Object.entries(sv.errors)) {
      expect(text, key).not.toBe("");
      // Placeholders must survive translation.
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(text), key).toEqual(placeholders(en.errors[key as keyof typeof en.errors]));
    }
  });
});
