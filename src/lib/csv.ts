// Minimal CSV building + parsing helpers — no library needed for this shape
// of data (see REQUIREMENTS.md's "Data export (CSV)" subsection). Numbers are
// deliberately NOT run through Intl.NumberFormat here: several locales this
// app supports (e.g. Swedish) use a comma as the decimal separator, which
// would collide with CSV's own comma delimiter. Plain `.` decimals keep the
// file parseable by any spreadsheet tool regardless of the viewer's locale.

// Every string cell here ultimately comes from user-entered data (item
// names, categories, transaction descriptions, ...) written straight into a
// file the household will likely open in Excel/Sheets/LibreOffice. Any of
// those programs treats a cell starting with =, +, -, or @ as a formula —
// so an item named e.g. `=HYPERLINK("https://evil.example","click")` or
// `=cmd|'/c calc'!A1` would execute when the export is opened (CSV/formula
// injection, OWASP-documented). Guard by prefixing such a cell with a
// leading apostrophe, which every major spreadsheet renders as literal text
// while parsing the value as inert. Numeric cells are exempt since they're
// never attacker-supplied free text and a plain negative number (leading
// "-") must stay a plain negative number.
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

/** Escapes a single CSV field per RFC 4180: wraps in quotes (doubling any
 * internal quotes) whenever the value contains a comma, quote, or newline. */
function escapeCsvField(value: string, guardFormulas: boolean): string {
  const guarded = guardFormulas && FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Builds a full CSV document (CRLF line endings per RFC 4180) from a header
 * row plus data rows. Every cell is stringified and escaped; string cells
 * are also guarded against spreadsheet formula injection (see
 * FORMULA_TRIGGER_RE above) — numbers never need that guard. */
export function buildCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((row) =>
    row.map((cell) => escapeCsvField(String(cell), typeof cell === "string")).join(","),
  );
  return lines.join("\r\n") + "\r\n";
}

/** Parses an RFC 4180 CSV document into a grid of raw string cells (no header
 * handling, no type coercion — callers that expect a header row slice it off
 * themselves). Handles quoted fields (commas and newlines inside quotes,
 * doubled `""` as an escaped literal quote) and both CRLF and bare LF line
 * endings, since a file a user exported from Excel/Sheets/a phone app could
 * carry either. A trailing blank line (from a final CRLF/LF) is dropped so
 * callers don't have to special-case an empty last row; a genuinely empty
 * input returns `[]`. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\r") {
      // A lone CR (old Mac line endings) is vanishingly unlikely here but is
      // treated as a row break too rather than folded into the field.
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
    }
  }

  // Flush the final field/row for input that doesn't end in a line break.
  if (field !== "" || row.length > 0) {
    endRow();
  }

  // Drop a trailing wholly-empty row left by a final line ending (a row of
  // exactly one empty field is what a trailing "\r\n" or "\n" produces).
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }

  return rows;
}

/** Returns a Response streaming `csv` as a downloadable CSV file attachment. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
