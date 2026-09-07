import { describe, expect, it } from "vitest";
import { detectReceiptCurrency, parseReceiptText } from "./receipt-parsing";

describe("parseReceiptText", () => {
  it("parses a simple Swedish grocery receipt, skipping boilerplate lines", () => {
    const text = [
      "ICA KVANTUM BÄCKEBOL",
      "Kvitto",
      "Mjölk 3%                      15,90",
      "Bröd Pågen                    32,50",
      "Kaffe Zoega                   69,00",
      "SUMMA                        117,40",
      "Varav moms                    11,74",
      "Kort                         117,40",
      "Tack för ditt köp!",
    ].join("\n");

    const lines = parseReceiptText(text);

    expect(lines).toEqual([
      { rawLine: "Mjölk 3%                      15,90", name: "Mjölk 3%", quantity: 1, price: 15.9 },
      { rawLine: "Bröd Pågen                    32,50", name: "Bröd Pågen", quantity: 1, price: 32.5 },
      { rawLine: "Kaffe Zoega                   69,00", name: "Kaffe Zoega", quantity: 1, price: 69 },
    ]);
  });

  it("parses an English receipt with dot decimals", () => {
    const text = ["Milk 1L                  1.99", "Bread                    2.50", "TOTAL 4.49"].join(
      "\n",
    );

    const lines = parseReceiptText(text);

    expect(lines).toEqual([
      { rawLine: "Milk 1L                  1.99", name: "Milk 1L", quantity: 1, price: 1.99 },
      { rawLine: "Bread                    2.50", name: "Bread", quantity: 1, price: 2.5 },
    ]);
  });

  it("extracts a leading quantity like '2 x Item'", () => {
    const lines = parseReceiptText("2 x Coca-Cola                 25.00");
    expect(lines).toEqual([
      {
        rawLine: "2 x Coca-Cola                 25.00",
        name: "Coca-Cola",
        quantity: 2,
        price: 25,
      },
    ]);
  });

  it("parses a thousands-separated amount", () => {
    const lines = parseReceiptText("Champagne                  1 234,50");
    expect(lines[0]).toMatchObject({ name: "Champagne", price: 1234.5 });
  });

  it("strips a leading article/PLU number from the item name", () => {
    const lines = parseReceiptText("7311041052452 Mjölk 3%        15,90");
    expect(lines).toEqual([
      { rawLine: "7311041052452 Mjölk 3%        15,90", name: "Mjölk 3%", quantity: 1, price: 15.9 },
    ]);
  });

  it("strips a trailing barcode from the item name", () => {
    const lines = parseReceiptText("Bröd Pågen 7311041052452       32,50");
    expect(lines).toEqual([
      { rawLine: "Bröd Pågen 7311041052452       32,50", name: "Bröd Pågen", quantity: 1, price: 32.5 },
    ]);
  });

  it("leaves a short leading number alone since it's likely a bare quantity", () => {
    const lines = parseReceiptText("2 Bananer                     10,00");
    expect(lines[0]).toMatchObject({ name: "2 Bananer" });
  });

  it("ignores a line with no confidently-parseable trailing price", () => {
    const lines = parseReceiptText("7311041052452\nRandom note without a price");
    expect(lines).toEqual([]);
  });

  it("ignores blank lines", () => {
    const lines = parseReceiptText("\n\nMjölk 3%   15,90\n\n");
    expect(lines).toHaveLength(1);
  });

  it("drops a currency token trailing the price", () => {
    const lines = parseReceiptText("Bananer                       19,90 kr");
    expect(lines[0]).toMatchObject({ name: "Bananer", price: 19.9 });
  });

  it("returns an empty list for text with only boilerplate", () => {
    const text = ["SUMMA 100,00", "Moms 25,00", "Kort 100,00"].join("\n");
    expect(parseReceiptText(text)).toEqual([]);
  });
});

describe("detectReceiptCurrency", () => {
  it("detects SEK from repeated 'kr' tokens", () => {
    const text = "Mjölk 15,90 kr\nBröd 32,50 kr\nSUMMA 48,40 kr";
    expect(detectReceiptCurrency(text, "USD")).toBe("SEK");
  });

  it("detects EUR from the euro symbol", () => {
    const text = "Milch 1,99€\nBrot 2,50€";
    expect(detectReceiptCurrency(text, "SEK")).toBe("EUR");
  });

  it("falls back when no currency token appears anywhere", () => {
    const text = "Milk 1.99\nBread 2.50";
    expect(detectReceiptCurrency(text, "SEK")).toBe("SEK");
  });

  it("picks the most frequent currency when tokens for multiple appear", () => {
    // A stray '$' inside a promo line shouldn't outweigh three real 'kr' lines.
    const text = "Mjölk 15,90 kr\nBröd 32,50 kr\nKaffe 69,00 kr\nSpara $ idag!";
    expect(detectReceiptCurrency(text, "USD")).toBe("SEK");
  });
});
