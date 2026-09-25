import { describe, expect, it } from "vitest";
import {
  buildSwishPaymentUrl,
  formatSwishNumber,
  normalizeSwishNumber,
  sanitizeSwishMessage,
  swishNumbersForPayer,
  swishSupportsCurrency,
} from "./swish";

function decode(url: string) {
  const prefix = "swish://payment?data=";
  expect(url.startsWith(prefix)).toBe(true);
  return JSON.parse(decodeURIComponent(url.slice(prefix.length)));
}

describe("normalizeSwishNumber", () => {
  it.each([
    ["0701234567", "46701234567"],
    ["070-123 45 67", "46701234567"],
    ["070 123 45 67", "46701234567"],
    ["(070) 123.45.67", "46701234567"],
    ["+46701234567", "46701234567"],
    ["+46 70 123 45 67", "46701234567"],
    ["+46 (0)70 123 45 67", "46701234567"],
    ["46701234567", "46701234567"],
    ["0046701234567", "46701234567"],
    ["  0731234567  ", "46731234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeSwishNumber(input)).toBe(expected);
  });

  it.each([
    [""],
    ["   "],
    ["abc"],
    ["070123456"], // too short
    ["07012345678"], // too long
    ["081234567"], // Stockholm landline
    ["+4570123456"], // Danish
    ["+1 555 123 4567"],
    ["1231234567"], // a merchant number isn't a private Swish number
    ["070 123 45 6x"],
    ["++46701234567"],
  ])("rejects %j", (input) => {
    expect(normalizeSwishNumber(input)).toBeNull();
  });
});

describe("formatSwishNumber", () => {
  it("writes an alias the Swedish way", () => {
    expect(formatSwishNumber("46701234567")).toBe("070-123 45 67");
  });

  it("round-trips through normalizeSwishNumber", () => {
    expect(normalizeSwishNumber(formatSwishNumber("46761234567"))).toBe("46761234567");
  });

  it("leaves anything that isn't an alias alone", () => {
    expect(formatSwishNumber("12345")).toBe("12345");
  });
});

describe("sanitizeSwishMessage", () => {
  it("keeps Swedish letters and allowed punctuation", () => {
    expect(sanitizeSwishMessage("Återbetalning (Squirrel): hyra, el!")).toBe(
      "Återbetalning (Squirrel): hyra, el!",
    );
  });

  it("drops characters Swish rejects and collapses whitespace", () => {
    expect(sanitizeSwishMessage("Pizza 🍕 & <beer>   night")).toBe("Pizza beer night");
  });

  it("caps the message at 50 characters", () => {
    const result = sanitizeSwishMessage("a".repeat(80));
    expect(result).toHaveLength(50);
  });

  it("doesn't leave a trailing space after truncating", () => {
    const result = sanitizeSwishMessage(`${"a".repeat(49)} bcd`);
    expect(result).toBe("a".repeat(49));
  });
});

describe("buildSwishPaymentUrl", () => {
  it("builds a locked, pre-filled payment link", () => {
    const url = buildSwishPaymentUrl({ payee: "46701234567", amount: 149.5, message: "Settle up (Squirrel)" });
    expect(url).not.toBeNull();
    expect(decode(url!)).toEqual({
      version: 1,
      payee: { value: "46701234567", editable: false },
      amount: { value: 149.5, editable: false },
      message: { value: "Settle up (Squirrel)", editable: false },
    });
  });

  it("uses the number 1 for version, never a string", () => {
    const data = decode(buildSwishPaymentUrl({ payee: "46701234567", amount: 10, message: "x" })!);
    expect(data.version).toBe(1);
  });

  it("url-encodes the JSON so it survives as a query parameter", () => {
    const url = buildSwishPaymentUrl({ payee: "46701234567", amount: 10, message: "a b" })!;
    expect(url).not.toMatch(/[{}" ]/);
  });

  it("normalizes a locally written payee number", () => {
    const data = decode(buildSwishPaymentUrl({ payee: "070-123 45 67", amount: 10, message: "" })!);
    expect(data.payee.value).toBe("46701234567");
  });

  it("rounds the amount to two decimals", () => {
    const data = decode(buildSwishPaymentUrl({ payee: "46701234567", amount: 333.335, message: "" })!);
    expect(data.amount.value).toBe(333.34);
    const floaty = decode(buildSwishPaymentUrl({ payee: "46701234567", amount: 0.1 + 0.2, message: "" })!);
    expect(floaty.amount.value).toBe(0.3);
  });

  it("omits an empty message instead of sending a blank one", () => {
    const data = decode(buildSwishPaymentUrl({ payee: "46701234567", amount: 10, message: "🍕" })!);
    expect(data).not.toHaveProperty("message");
  });

  it("truncates a long message to 50 characters", () => {
    const data = decode(
      buildSwishPaymentUrl({ payee: "46701234567", amount: 10, message: "x".repeat(70) })!,
    );
    expect(data.message.value).toHaveLength(50);
  });

  it.each([[0], [-5], [0.004], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "returns null for amount %s",
    (amount) => {
      expect(buildSwishPaymentUrl({ payee: "46701234567", amount, message: "" })).toBeNull();
    },
  );

  it("returns null for an invalid payee", () => {
    expect(buildSwishPaymentUrl({ payee: "081234567", amount: 10, message: "" })).toBeNull();
  });
});

describe("swishSupportsCurrency", () => {
  it("only supports Swedish kronor", () => {
    expect(swishSupportsCurrency("SEK")).toBe(true);
    expect(swishSupportsCurrency("sek")).toBe(true);
    expect(swishSupportsCurrency("EUR")).toBe(false);
  });
});

describe("swishNumbersForPayer", () => {
  const members = [
    { id: "anna", swishNumber: "46701111111" },
    { id: "bo", swishNumber: "46702222222" },
    { id: "cia", swishNumber: null },
    { id: "dan", swishNumber: "46704444444" },
  ];
  const settlements = [
    { fromMemberId: "anna", toMemberId: "bo", amount: 100 },
    { fromMemberId: "anna", toMemberId: "cia", amount: 50 },
    { fromMemberId: "dan", toMemberId: "anna", amount: 75 },
  ];

  it("only returns numbers of members the payer owes, and who have one", () => {
    expect(
      swishNumbersForPayer({ settlements, payerMemberId: "anna", members, currencyCode: "SEK" }),
    ).toEqual({ bo: "46702222222" });
  });

  it("returns nothing for a member who owes nobody", () => {
    expect(
      swishNumbersForPayer({ settlements, payerMemberId: "bo", members, currencyCode: "SEK" }),
    ).toEqual({});
  });

  it("skips a zero transfer", () => {
    expect(
      swishNumbersForPayer({
        settlements: [{ fromMemberId: "anna", toMemberId: "bo", amount: 0 }],
        payerMemberId: "anna",
        members,
        currencyCode: "SEK",
      }),
    ).toEqual({});
  });

  it("returns nothing when the household's currency isn't SEK", () => {
    expect(
      swishNumbersForPayer({ settlements, payerMemberId: "anna", members, currencyCode: "EUR" }),
    ).toEqual({});
  });

  it("returns nothing without a signed-in member", () => {
    expect(
      swishNumbersForPayer({ settlements, payerMemberId: "", members, currencyCode: "SEK" }),
    ).toEqual({});
  });
});
