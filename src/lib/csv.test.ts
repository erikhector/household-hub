import { describe, expect, it } from "vitest";
import { buildCsv, csvResponse, parseCsv } from "@/lib/csv";

describe("buildCsv", () => {
  it("joins header and rows with commas and CRLF line endings", () => {
    const csv = buildCsv(
      ["Name", "Quantity"],
      [
        ["Milk", 2],
        ["Eggs", 12],
      ],
    );
    expect(csv).toBe("Name,Quantity\r\nMilk,2\r\nEggs,12\r\n");
  });

  it("quotes fields containing a comma", () => {
    const csv = buildCsv(["Description"], [["Rent, utilities"]]);
    expect(csv).toBe('Description\r\n"Rent, utilities"\r\n');
  });

  it("quotes and doubles internal quotes", () => {
    const csv = buildCsv(["Name"], [['12" pizza']]);
    expect(csv).toBe('Name\r\n"12"" pizza"\r\n');
  });

  it("quotes fields containing a newline", () => {
    const csv = buildCsv(["Notes"], [["line one\nline two"]]);
    expect(csv).toBe('Notes\r\n"line one\nline two"\r\n');
  });

  it("leaves plain fields unquoted", () => {
    const csv = buildCsv(["Name", "Category"], [["Flour", "Baking"]]);
    expect(csv).toBe("Name,Category\r\nFlour,Baking\r\n");
  });

  it("does not localize decimal separators, keeping the file parseable in any locale", () => {
    const csv = buildCsv(["Amount"], [[12.5]]);
    expect(csv).toBe("Amount\r\n12.5\r\n");
  });

  it("guards a string cell starting with '=' against formula injection", () => {
    const csv = buildCsv(["Name"], [['=HYPERLINK("https://evil.example","click")']]);
    expect(csv).toBe('Name\r\n"\'=HYPERLINK(""https://evil.example"",""click"")"\r\n');
  });

  it("guards string cells starting with +, -, @, tab, or CR", () => {
    const csv = buildCsv(
      ["Name"],
      [["+1+1"], ["-2+3"], ["@SUM(A1:A9)"], ["\tcmd"], ["\rcmd"]],
    );
    const rows = csv.trim().split("\r\n").slice(1);
    expect(rows).toEqual([
      "'+1+1",
      "'-2+3",
      "'@SUM(A1:A9)",
      "'\tcmd",
      '"\'\rcmd"',
    ]);
  });

  it("does not guard a plain negative number cell", () => {
    const csv = buildCsv(["Amount"], [[-5]]);
    expect(csv).toBe("Amount\r\n-5\r\n");
  });

  it("does not mangle an ordinary string that merely contains a hyphen", () => {
    const csv = buildCsv(["Name"], [["Sugar-free syrup"]]);
    expect(csv).toBe("Name\r\nSugar-free syrup\r\n");
  });
});

describe("parseCsv", () => {
  it("parses a simple header and rows with CRLF line endings", () => {
    expect(parseCsv("Name,Quantity\r\nMilk,2\r\nEggs,12\r\n")).toEqual([
      ["Name", "Quantity"],
      ["Milk", "2"],
      ["Eggs", "12"],
    ]);
  });

  it("parses bare LF line endings", () => {
    expect(parseCsv("Name,Quantity\nMilk,2\nEggs,12")).toEqual([
      ["Name", "Quantity"],
      ["Milk", "2"],
      ["Eggs", "12"],
    ]);
  });

  it("un-quotes a field containing a comma", () => {
    expect(parseCsv('Description\r\n"Rent, utilities"\r\n')).toEqual([
      ["Description"],
      ["Rent, utilities"],
    ]);
  });

  it("un-doubles an escaped quote inside a quoted field", () => {
    expect(parseCsv('Name\r\n"12"" pizza"\r\n')).toEqual([["Name"], ['12" pizza']]);
  });

  it("keeps a newline inside a quoted field as part of the value", () => {
    expect(parseCsv('Notes\r\n"line one\nline two"\r\n')).toEqual([
      ["Notes"],
      ["line one\nline two"],
    ]);
  });

  it("round-trips through buildCsv", () => {
    const csv = buildCsv(
      ["Name", "Category"],
      [
        ["Flour", "Baking"],
        ['12" pizza', "Frozen, ready meals"],
      ],
    );
    expect(parseCsv(csv)).toEqual([
      ["Name", "Category"],
      ["Flour", "Baking"],
      ['12" pizza', "Frozen, ready meals"],
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseCsv("Name,Quantity\nMilk,2")).toEqual([
      ["Name", "Quantity"],
      ["Milk", "2"],
    ]);
  });
});

describe("csvResponse", () => {
  it("sets Content-Type and a Content-Disposition attachment header with the filename", async () => {
    const response = csvResponse("a,b\r\n1,2\r\n", "test-export.csv");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="test-export.csv"',
    );
    expect(await response.text()).toBe("a,b\r\n1,2\r\n");
  });
});
