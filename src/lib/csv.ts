// Minimal CSV string-building helper — no library needed for this shape of
// data (see REQUIREMENTS.md's "Data export (CSV)" subsection). Numbers are
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
