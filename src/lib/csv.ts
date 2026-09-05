// Minimal CSV string-building helper — no library needed for this shape of
// data (see REQUIREMENTS.md's "Data export (CSV)" subsection). Numbers are
// deliberately NOT run through Intl.NumberFormat here: several locales this
// app supports (e.g. Swedish) use a comma as the decimal separator, which
// would collide with CSV's own comma delimiter. Plain `.` decimals keep the
// file parseable by any spreadsheet tool regardless of the viewer's locale.

/** Escapes a single CSV field per RFC 4180: wraps in quotes (doubling any
 * internal quotes) whenever the value contains a comma, quote, or newline. */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Builds a full CSV document (CRLF line endings per RFC 4180) from a header
 * row plus data rows. Every cell is stringified and escaped. */
export function buildCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((row) =>
    row.map((cell) => escapeCsvField(String(cell))).join(","),
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
