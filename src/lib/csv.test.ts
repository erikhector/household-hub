import { describe, expect, it } from "vitest";
import { buildCsv, csvResponse } from "@/lib/csv";

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
